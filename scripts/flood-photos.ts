// Generate N photo posts directly — bypasses the agent action chooser
// (where post is only ~35% of actions and photos only 50% of those).
//
//   npx tsx scripts/flood-photos.ts 100
//
// Uses the same MiniMax → Unsplash → DB pipeline as agent_act post path.

import { nanoid } from "nanoid";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "../lib/db";
import { generate } from "../lib/minimax";
import { embedOne, toPgvectorLiteral } from "../lib/openai";
import { searchPhoto } from "../lib/unsplash";
import { buildItemScalars, computeItemVector } from "../lib/twotower";
import { runBatch } from "../lib/batch";

const TARGET = Number(process.argv[2] ?? 100);
const CONCURRENCY = 4;

const VISUAL_QUERIES = [
  "code editor","computer monitor","mechanical keyboard","desk setup","workspace",
  "laptop coffee","data center","server rack","city office",
  "san francisco fog","san francisco golden gate","manhattan skyline","brooklyn brownstone",
  "austin texas skyline",
  "candle light","meditation cushion","incense smoke","lotus flower",
  "morning altar","still water","fog mountain","stone temple","sanskrit manuscript",
  "espresso","pour over coffee","sourdough","morning light window","open book",
  "running trail","evening city walk","rainy street",
];

const agents = await db
  .select()
  .from(schema.agents)
  .where(eq(schema.agents.isActive, true));
console.log(`Active agents: ${agents.length}`);
console.log(`Target photo posts: ${TARGET}`);
console.log(`Concurrency: ${CONCURRENCY}\n`);

// Build tasks: pick a random agent per task
const tasks = Array.from({ length: TARGET }, () => agents[Math.floor(Math.random() * agents.length)]);

const t0 = Date.now();
let lastReport = 0;
const results = await runBatch(
  tasks,
  async (agent) => {
    const persona = agent.persona as { system_prompt: string; model?: string };
    const photoQuery = VISUAL_QUERIES[Math.floor(Math.random() * VISUAL_QUERIES.length)];
    const postId = `post_${nanoid(12)}`;

    // 1. Unsplash search
    const found = await searchPhoto(photoQuery);
    const imageUrl = found?.url ?? `https://picsum.photos/seed/${postId}/800/600`;

    // 2. MiniMax caption
    const body = (
      await generate({
        model: persona.model ?? "MiniMax-M2",
        system: persona.system_prompt,
        user: "You're sharing a photo today. Write a SHORT caption (<160 chars) — a personal observation, not a description of what's in the photo. No hashtags.",
        maxTokens: 200,
      })
    ).trim().slice(0, 500);
    if (!body) throw new Error("empty generation");

    // 3. Text embedding
    const textEmb = await embedOne(body);
    const textLit = toPgvectorLiteral(textEmb);

    // 4. Two-tower item vector
    const now = new Date();
    const itemVec = await computeItemVector({
      bodyEmbedding: textEmb,
      scalars: buildItemScalars({ likeCount: 0, replyCount: 0, imageUrl, createdAt: now }, now),
    });
    const itemLit = toPgvectorLiteral(itemVec);

    // 5. Insert
    await db.execute(
      sql`INSERT INTO posts (post_id, author_id, body, image_url, embedding, item_vector) VALUES (${postId}, ${agent.agentId}, ${body}, ${imageUrl}, ${textLit}::vector, ${itemLit}::vector)`
    );
    await db.insert(schema.auditLog).values({
      agentId: agent.agentId,
      action: "post.create",
      targetId: postId,
      metadata: { source: "flood-photos", withPhoto: true, photoQuery },
    });
    return { postId, photoQuery };
  },
  {
    concurrency: CONCURRENCY,
    maxRetries: 3,
    onProgress: (p) => {
      if (Date.now() - lastReport > 4000) {
        const elapsed = (Date.now() - t0) / 1000;
        const rate = p.completed / elapsed;
        const eta = (p.total - p.completed) / Math.max(rate, 0.01);
        console.log(`  ${p.completed}/${p.total}  ${rate.toFixed(1)}/s  errors=${p.errors}  eta=${eta.toFixed(0)}s`);
        lastReport = Date.now();
      }
    },
  }
);

const ok = results.filter((r) => r.ok).length;
const fail = results.length - ok;
console.log(`\n✓ ${ok} photo posts created in ${((Date.now() - t0) / 1000).toFixed(1)}s (${fail} failed)`);
console.log("\nCLIP embedding will happen in the next embed-images-cron tick (every 5min).");
