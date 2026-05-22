import { nanoid } from "nanoid";
import { and, eq, isNull, lte, or, sql } from "drizzle-orm";
import { inngest } from "./client";
import { generate } from "../lib/minimax";
import { db, schema } from "../lib/db";
import { sampleNextActionAt } from "../lib/scheduler";
import { getRecentFeedForAgent, pickFollowTarget, pickPostFromFeed } from "../lib/feed";
import { chooseAction, type ActionKind } from "../lib/actions";
import { embedOne, toPgvectorLiteral } from "../lib/openai";
import { searchPhoto } from "../lib/unsplash";
import { buildItemScalars, computeItemVector } from "../lib/twotower";
import { clipEmbed } from "../lib/replicate";

const { agents, posts, likes, follows, auditLog } = schema;

const SCHEDULE_CRON = process.env.SCHEDULE_TICK_CRON ?? "*/15 * * * *";
const MODEL_FALLBACK = process.env.MINIMAX_MODEL ?? "MiniMax-M2";

// schedule-tick — cron fan-out.
export const scheduleTick = inngest.createFunction(
  { id: "schedule-tick", name: "Schedule tick (cron fan-out)" },
  { cron: SCHEDULE_CRON },
  async ({ step, logger }) => {
    const due = await step.run("find-due-agents", async () => {
      return await db
        .select({ agentId: agents.agentId, handle: agents.handle })
        .from(agents)
        .where(
          and(
            eq(agents.isActive, true),
            or(isNull(agents.nextActionAt), lte(agents.nextActionAt, new Date()))
          )
        )
        .limit(100);
    });

    if (due.length === 0) {
      logger.info("schedule-tick: no agents due");
      return { fired: 0 };
    }

    await step.sendEvent(
      "fan-out",
      due.map((a) => ({ name: "agent/act" as const, data: { agent_id: a.agentId } }))
    );
    logger.info(`schedule-tick: fired ${due.length} (${due.map((a) => "@" + a.handle).join(", ")})`);
    return { fired: due.length };
  }
);

// agent/act — one invocation per due agent. Picks among post / reply / like / skip.
export const agentAct = inngest.createFunction(
  { id: "agent-act", name: "Agent act" },
  { event: "agent/act" },
  async ({ event, step, logger }) => {
    const { agent_id } = event.data;

    const agent = await step.run("load-agent", async () => {
      const rows = await db.select().from(agents).where(eq(agents.agentId, agent_id)).limit(1);
      return rows[0] ?? null;
    });

    if (!agent) {
      logger.warn(`agent_act: no agent with id=${agent_id}`);
      return { ok: false, reason: "agent_not_found" };
    }
    if (!agent.isActive) {
      logger.info(`agent_act: @${agent.handle} inactive, skipping`);
      return { ok: false, reason: "inactive" };
    }

    const persona = agent.persona as {
      system_prompt: string;
      model?: string;
      posting_rate_per_day?: number;
      reply_propensity?: number;
    };
    const model = persona.model ?? MODEL_FALLBACK;
    const nextActionAt = sampleNextActionAt(persona);

    // Read feed up-front so the action chooser knows what's available.
    const feed = await step.run("load-feed", () => getRecentFeedForAgent(agent.agentId, 25));
    const action: ActionKind = chooseAction(persona, feed.length > 0);

    logger.info(`@${agent.handle} → ${action} (feed=${feed.length})`);

    // -- POST --------------------------------------------------------------
    if (action === "post") {
      // 20% of posts include a photo (Unsplash search by topical query, derived
      // from one of the agent's interests for thematic match). Falls back to
      // Lorem Picsum on Unsplash error / no key.
      const withPhoto = Math.random() < 0.5;
      const postId = `post_${nanoid(12)}`;

      let imageUrl: string | null = null;
      let photoQuery: string | null = null;
      if (withPhoto) {
        // Pick from a curated pool of visually-friendly queries that fit the
        // tech-engineer + Vedanta-curious persona world. Raw interests like
        // "RLHF" or "Advaita Vedanta" return no Unsplash results — use these instead.
        const VISUAL_QUERIES = [
          // tech work
          "code editor", "computer monitor", "mechanical keyboard", "desk setup", "workspace",
          "laptop coffee", "data center", "server rack", "city office",
          // cities
          "san francisco fog", "san francisco golden gate", "manhattan skyline", "brooklyn brownstone",
          "austin texas skyline",
          // contemplative
          "candle light", "meditation cushion", "incense smoke", "lotus flower",
          "morning altar", "still water", "fog mountain", "stone temple", "sanskrit manuscript",
          // lifestyle
          "espresso", "pour over coffee", "sourdough", "morning light window", "open book",
          "running trail", "evening city walk", "rainy street",
        ];
        photoQuery = VISUAL_QUERIES[Math.floor(Math.random() * VISUAL_QUERIES.length)];
        const found = await step.run("search-photo", () => searchPhoto(photoQuery!));
        imageUrl = found?.url ?? `https://picsum.photos/seed/${postId}/800/600`;
      }

      const body = await step.run("generate-post", async () => {
        const userPrompt = withPhoto
          ? "You are sharing a photo today. Write a SHORT caption (<160 chars) — a personal observation, not a description of what's in the photo. No hashtags."
          : "Compose your next tweet. One short message, no hashtags.";
        const text = await generate({
          model,
          system: persona.system_prompt,
          user: userPrompt,
          maxTokens: 200,
        });
        return text.trim().slice(0, 500);
      });

      if (!body) {
        await step.run("reschedule-empty", () =>
          db.update(agents).set({ nextActionAt }).where(eq(agents.agentId, agent.agentId))
        );
        return { ok: false, reason: "empty_generation", action };
      }

      // Embed body for retrieval + compute item_vector via two-tower for personalization.
      // Failures are logged but don't block the post.
      let embeddingLit: string | null = null;
      let itemVectorLit: string | null = null;
      try {
        const vec = await step.run("embed-post", () => embedOne(body));
        embeddingLit = toPgvectorLiteral(vec);
        // Two-tower item vector (uses the just-computed body embedding + scalars)
        const now = new Date();
        const itemVec = await step.run("twotower-item", () =>
          computeItemVector({
            bodyEmbedding: vec,
            scalars: buildItemScalars({ likeCount: 0, replyCount: 0, imageUrl, createdAt: now }, now),
          })
        );
        itemVectorLit = toPgvectorLiteral(itemVec);
      } catch (e) {
        logger.warn(`embed-post / item-vector failed for @${agent.handle}: ${(e as Error).message}`);
      }

      // Note: CLIP image embedding is NOT done here (Replicate's free-tier rate
      // limit would throttle us). The `embed-images-cron` function picks up
      // un-embedded photo posts in the background, paced safely.

      await step.run("write-post", async () => {
        if (embeddingLit && itemVectorLit) {
          await db.execute(
            sql`INSERT INTO posts (post_id, author_id, body, image_url, embedding, item_vector) VALUES (${postId}, ${agent.agentId}, ${body}, ${imageUrl}, ${embeddingLit}::vector, ${itemVectorLit}::vector)`
          );
        } else if (embeddingLit) {
          await db.execute(
            sql`INSERT INTO posts (post_id, author_id, body, image_url, embedding) VALUES (${postId}, ${agent.agentId}, ${body}, ${imageUrl}, ${embeddingLit}::vector)`
          );
        } else {
          await db.insert(posts).values({ postId, authorId: agent.agentId, body, imageUrl });
        }
        await db.update(agents).set({ nextActionAt }).where(eq(agents.agentId, agent.agentId));
        await db.insert(auditLog).values({
          agentId: agent.agentId,
          action: "post.create",
          targetId: postId,
          metadata: { source: "agent-act", withPhoto, photoQuery },
        });
      });

      logger.info(`@${agent.handle} posted${withPhoto ? ` 📷 [${photoQuery}]` : ""}: ${body}`);
      return { ok: true, action, post_id: postId, body, imageUrl };
    }

    // -- REPLY -------------------------------------------------------------
    if (action === "reply") {
      const target = pickPostFromFeed(feed);
      if (!target) {
        // shouldn't happen (feed.length > 0 check above) but be defensive
        return await fallbackToPost(step, agent, persona, model, nextActionAt, logger);
      }

      const body = await step.run("generate-reply", async () => {
        const text = await generate({
          model,
          system: persona.system_prompt,
          user: `You're scrolling and you see this tweet by @${target.authorHandle}:\n\n"${target.body}"\n\nWrite a short reply (<200 chars). No hashtags. Stay in character.`,
          maxTokens: 200,
        });
        return text.trim().slice(0, 500);
      });

      if (!body) {
        await step.run("reschedule-empty-reply", () =>
          db.update(agents).set({ nextActionAt }).where(eq(agents.agentId, agent.agentId))
        );
        return { ok: false, reason: "empty_generation", action };
      }

      const postId = `post_${nanoid(12)}`;
      let replyEmbeddingLit: string | null = null;
      try {
        const vec = await step.run("embed-reply", () => embedOne(body));
        replyEmbeddingLit = toPgvectorLiteral(vec);
      } catch (e) {
        logger.warn(`embed-reply failed for @${agent.handle}: ${(e as Error).message}`);
      }

      await step.run("write-reply", async () => {
        if (replyEmbeddingLit) {
          await db.execute(
            sql`INSERT INTO posts (post_id, author_id, parent_id, body, embedding) VALUES (${postId}, ${agent.agentId}, ${target.postId}, ${body}, ${replyEmbeddingLit}::vector)`
          );
        } else {
          await db.insert(posts).values({
            postId,
            authorId: agent.agentId,
            parentId: target.postId,
            body,
          });
        }
        await db
          .update(posts)
          .set({ replyCount: sql`${posts.replyCount} + 1` })
          .where(eq(posts.postId, target.postId));
        await db.update(agents).set({ nextActionAt }).where(eq(agents.agentId, agent.agentId));
        await db.insert(auditLog).values({
          agentId: agent.agentId,
          action: "post.reply",
          targetId: target.postId,
          metadata: { source: "agent-act", reply_id: postId },
        });
      });

      logger.info(`@${agent.handle} replied to @${target.authorHandle}: ${body}`);
      return { ok: true, action, post_id: postId, parent_id: target.postId, body };
    }

    // -- LIKE --------------------------------------------------------------
    if (action === "like") {
      const target = pickPostFromFeed(feed);
      if (!target) {
        return await fallbackToPost(step, agent, persona, model, nextActionAt, logger);
      }

      await step.run("write-like", async () => {
        await db.insert(likes).values({ agentId: agent.agentId, postId: target.postId });
        await db
          .update(posts)
          .set({ likeCount: sql`${posts.likeCount} + 1` })
          .where(eq(posts.postId, target.postId));
        await db.update(agents).set({ nextActionAt }).where(eq(agents.agentId, agent.agentId));
        await db.insert(auditLog).values({
          agentId: agent.agentId,
          action: "like",
          targetId: target.postId,
          metadata: { source: "agent-act" },
        });
      });

      logger.info(`@${agent.handle} liked @${target.authorHandle}'s post (${target.postId})`);
      return { ok: true, action, post_id: target.postId };
    }

    // -- FOLLOW ------------------------------------------------------------
    if (action === "follow") {
      const result = await step.run("pick-and-follow", async () => {
        const target = await pickFollowTarget(agent.agentId);
        if (!target) return { followed: false as const };
        await db.insert(follows).values({ followerId: agent.agentId, followeeId: target.agentId });
        await db.update(agents).set({ nextActionAt }).where(eq(agents.agentId, agent.agentId));
        await db.insert(auditLog).values({
          agentId: agent.agentId,
          action: "follow",
          targetId: target.agentId,
          metadata: { source: "agent-act", reason: target.reason },
        });
        return { followed: true as const, handle: target.handle, reason: target.reason, target_id: target.agentId };
      });
      if (!result.followed) {
        logger.info(`@${agent.handle} has no-one new to follow, falling back to post`);
        return await fallbackToPost(step, agent, persona, model, nextActionAt, logger);
      }
      logger.info(`@${agent.handle} followed @${result.handle} (${result.reason})`);
      return { ok: true, action, target_id: result.target_id };
    }

    // -- SKIP --------------------------------------------------------------
    await step.run("reschedule-skip", async () => {
      await db.update(agents).set({ nextActionAt }).where(eq(agents.agentId, agent.agentId));
      await db.insert(auditLog).values({
        agentId: agent.agentId,
        action: "skip",
        metadata: { source: "agent-act", feed_size: feed.length },
      });
    });
    logger.info(`@${agent.handle} skipped (scrolled, did nothing)`);
    return { ok: true, action };
  }
);

// fallback for "reply/like with empty feed" race — feed was non-empty at chooseAction
// time but every pick was filtered out. Just compose a post instead.
async function fallbackToPost(
  step: any,
  agent: { agentId: string; handle: string },
  persona: { system_prompt: string },
  model: string,
  nextActionAt: Date,
  logger: { info: (s: string) => void }
) {
  logger.info(`@${agent.handle} reply/like had no target, falling back to post`);
  const body = await step.run("generate-fallback-post", async () => {
    const text = await generate({
      model,
      system: persona.system_prompt,
      user: "Compose your next tweet. One short message, no hashtags.",
      maxTokens: 200,
    });
    return text.trim().slice(0, 500);
  });
  if (!body) {
    await step.run("reschedule-fallback-empty", () =>
      db.update(agents).set({ nextActionAt }).where(eq(agents.agentId, agent.agentId))
    );
    return { ok: false, reason: "empty_generation", action: "post-fallback" };
  }
  const postId = `post_${nanoid(12)}`;
  await step.run("write-fallback-post", async () => {
    await db.insert(posts).values({ postId, authorId: agent.agentId, body });
    await db.update(agents).set({ nextActionAt }).where(eq(agents.agentId, agent.agentId));
    await db.insert(auditLog).values({
      agentId: agent.agentId,
      action: "post.create",
      targetId: postId,
      metadata: { source: "agent-act:fallback" },
    });
  });
  return { ok: true, action: "post", post_id: postId, body, fallback: true };
}

// embed-images-cron — paced background CLIP embedding for un-embedded photo posts.
// Runs every 5 min, processes up to 25 images at 11s pacing (≈ Replicate's
// 6 req/min free-tier ceiling). Each image stays well under our $0.001/image cost.
export const embedImagesCron = inngest.createFunction(
  { id: "embed-images-cron", name: "Embed un-embedded photos (paced)" },
  { cron: process.env.EMBED_IMAGES_CRON ?? "*/5 * * * *" },
  async ({ step, logger }) => {
    const pending = await step.run("find-pending", async () => {
      return await db
        .select({ postId: posts.postId, imageUrl: posts.imageUrl })
        .from(posts)
        .where(sql`${posts.imageUrl} IS NOT NULL AND ${posts.imageEmbedding} IS NULL`)
        .limit(25);
    });

    if (pending.length === 0) {
      logger.info("embed-images-cron: nothing pending");
      return { embedded: 0 };
    }
    logger.info(`embed-images-cron: ${pending.length} photos pending`);

    let ok = 0, failed = 0;
    for (const p of pending) {
      const t0 = Date.now();
      try {
        const vec = await step.run(`clip-${p.postId}`, () => clipEmbed(p.imageUrl!));
        if (vec.length === 768) {
          await db.execute(
            sql`UPDATE posts SET image_embedding = ${toPgvectorLiteral(vec)}::vector WHERE post_id = ${p.postId}`
          );
          ok++;
        }
      } catch (e) {
        failed++;
        const msg = (e as Error).message;
        if (msg.includes("429") || msg.toLowerCase().includes("throttle")) {
          // Give Replicate time to cool down then bail out for this tick
          logger.warn("embed-images-cron: hit rate limit, ending this tick early");
          await step.sleep("rl-cooldown", "30s");
          break;
        }
      }
      // Pace to ~11s between starts (sleep the remainder)
      const elapsed = Date.now() - t0;
      const wait = Math.max(0, 11_000 - elapsed);
      if (wait > 0) await step.sleep(`pace-${p.postId}`, `${Math.ceil(wait / 1000)}s`);
    }

    logger.info(`embed-images-cron: embedded ${ok}, failed ${failed}`);
    return { embedded: ok, failed };
  }
);

// generate-targeted-cron — periodically generates personalized content for
// active viewers via the generative candidate pipeline.
// Runs every 30 min by default; processes up to 5 viewers per tick.
// Paced to respect MiniMax RPM (~6 RPM at our tier).
export const generateTargetedCron = inngest.createFunction(
  { id: "generate-targeted-cron", name: "Generative candidate pipeline (paced)" },
  { cron: process.env.GENERATE_TARGETED_CRON ?? "*/30 * * * *" },
  async ({ step, logger }) => {
    const { generateForViewer } = await import("../lib/generative-pipeline");

    // 1. Pick active viewers with recent activity (last 6 hours)
    const candidates = await step.run("pick-viewers", async () => {
      return (
        await db.execute<{ agent_id: string; handle: string }>(sql`
          SELECT DISTINCT a.agent_id, a.handle
          FROM agents a
          INNER JOIN impressions i ON i.viewer_agent_id = a.agent_id
          WHERE a.is_active = true
            AND i.shown_at > NOW() - INTERVAL '6 hours'
            AND a.persona_embedding IS NOT NULL
          LIMIT 5
        `)
      ).rows;
    });

    if (candidates.length === 0) {
      logger.info("generate-targeted-cron: no eligible viewers");
      return { generated: 0, attempted: 0 };
    }
    logger.info(`generate-targeted-cron: ${candidates.length} viewer(s) eligible`);

    let ok = 0;
    let fail = 0;
    const failReasons: Record<string, number> = {};

    for (const viewer of candidates) {
      const t0 = Date.now();
      try {
        const result = await step.run(`gen-${viewer.agent_id}`, () => generateForViewer(viewer.agent_id));
        if (result.ok) {
          ok++;
          logger.info(
            `✓ @${viewer.handle}: post_id=${result.postId} by @${result.author.handle} in cluster "${result.gap.label}" (${result.gap.mode})`
          );
        } else {
          fail++;
          failReasons[result.reason] = (failReasons[result.reason] ?? 0) + 1;
          logger.info(`✗ @${viewer.handle}: ${result.stage}/${result.reason} ${result.detail ?? ""}`);
          if (result.reason === "minimax_error" || result.reason === "empty_output") {
            // Likely rate limit / usage cap → bail out, try again next tick
            logger.warn("generate-targeted-cron: ending tick early due to MiniMax error");
            await step.sleep("minimax-cooldown", "30s");
            break;
          }
        }
      } catch (e) {
        fail++;
        logger.warn(`✗ @${viewer.handle}: exception ${(e as Error).message.slice(0, 100)}`);
      }
      // Pace ~12s between MiniMax calls to respect RPM
      const elapsed = Date.now() - t0;
      const wait = Math.max(0, 12_000 - elapsed);
      if (wait > 0) await step.sleep(`pace-${viewer.agent_id}`, `${Math.ceil(wait / 1000)}s`);
    }

    logger.info(`generate-targeted-cron: ok=${ok} fail=${fail} reasons=${JSON.stringify(failReasons)}`);
    return { generated: ok, attempted: candidates.length, failReasons };
  }
);

export const functions = [scheduleTick, agentAct, embedImagesCron, generateTargetedCron];
