// Run N rounds of simulated agent engagement against the live recommender.
// Half the agents see the baseline feed, half see the neural feed.
// Each simulated impression is written to `impressions` with engagement set.
//
//   npx tsx scripts/simulate.ts                      # 3 rounds, all active agents
//   npx tsx scripts/simulate.ts --rounds=5 --feedSize=15

import { and, desc, eq, isNull, ne, sql } from "drizzle-orm";
import { db, schema } from "../lib/db";
import { simulateEngagement } from "../lib/simulator";

const ROUNDS = Number(process.argv.find((a) => a.startsWith("--rounds="))?.split("=")[1] ?? 3);
const FEED_SIZE = Number(process.argv.find((a) => a.startsWith("--feedSize="))?.split("=")[1] ?? 20);
const AGENT_LIMIT = Number(process.argv.find((a) => a.startsWith("--agents="))?.split("=")[1] ?? 0); // 0 = all

function parseVec(v: unknown): number[] | null {
  if (Array.isArray(v)) return v as number[];
  if (typeof v === "string") return v.replace(/^\[|\]$/g, "").split(",").map(Number);
  return null;
}

function hashStr(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

async function withRetry<T>(fn: () => Promise<T>, label: string, max = 4): Promise<T> {
  for (let i = 0; i <= max; i++) {
    try {
      return await fn();
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      const retryable = msg.includes("fetch failed") || msg.includes("ECONN") || msg.includes("timeout");
      if (i === max || !retryable) throw e;
      const wait = 500 * Math.pow(2, i) + Math.random() * 200;
      console.warn(`  ${label} retry ${i + 1}/${max} (wait ${wait.toFixed(0)}ms): ${msg.slice(0, 80)}`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw new Error("unreachable");
}

async function generateFeed(viewerId: string, variant: "baseline" | "neural", limit: number) {
  if (variant === "neural") {
    // Two-tower kNN over item_vector
    const uvText = (
      await db.execute<{ user_vector: string | null }>(
        sql`SELECT user_vector::text FROM agents WHERE agent_id = ${viewerId} LIMIT 1`
      )
    ).rows[0]?.user_vector;
    if (!uvText) return [];
    const res = await db.execute<{
      post_id: string;
      author_id: string;
      embedding: string;
    }>(sql`
      SELECT p.post_id, p.author_id, p.embedding::text AS embedding
      FROM posts p
      WHERE p.author_id <> ${viewerId}
        AND p.parent_id IS NULL
        AND p.item_vector IS NOT NULL
      ORDER BY p.item_vector <=> ${uvText}::vector
      LIMIT ${limit}
    `);
    return res.rows;
  } else {
    // Baseline: posts by followed agents + global recent
    const followed = (
      await db
        .select({ id: schema.follows.followeeId })
        .from(schema.follows)
        .where(eq(schema.follows.followerId, viewerId))
    ).map((r) => r.id);

    const followClause = followed.length > 0
      ? sql`AND p.author_id IN ${followed}`
      : sql``;

    const res = await db.execute<{
      post_id: string;
      author_id: string;
      embedding: string;
    }>(sql`
      SELECT p.post_id, p.author_id, p.embedding::text AS embedding
      FROM posts p
      WHERE p.author_id <> ${viewerId}
        AND p.parent_id IS NULL
        AND p.embedding IS NOT NULL
        ${followClause}
      ORDER BY p.created_at DESC
      LIMIT ${limit}
    `);
    return res.rows;
  }
}

async function main() {
  console.log("== Simulation harness ==");
  console.log(`rounds=${ROUNDS}  feedSize=${FEED_SIZE}  agents=${AGENT_LIMIT || "all"}\n`);

  const allAgents = await withRetry(
    () =>
      db
        .select({
          agentId: schema.agents.agentId,
          handle: schema.agents.handle,
          personaEmbedding: schema.agents.personaEmbedding,
          persona: schema.agents.persona,
        })
        .from(schema.agents)
        .where(eq(schema.agents.isActive, true)),
    "load-agents"
  );

  const agents = AGENT_LIMIT > 0 ? allAgents.slice(0, AGENT_LIMIT) : allAgents;
  console.log(`Active agents: ${agents.length}`);
  if (agents.length === 0) {
    console.log("No agents.");
    return;
  }

  // Preload follow relationships
  const followsRows = await withRetry(
    () => db.select({ a: schema.follows.followerId, b: schema.follows.followeeId }).from(schema.follows),
    "load-follows"
  );
  const followsSet = new Set(followsRows.map((r) => `${r.a}::${r.b}`));

  let totalImpressions = 0;
  let totalEngaged = 0;

  for (let round = 1; round <= ROUNDS; round++) {
    const tRound = Date.now();
    const tally: Record<string, { impressions: number; engaged: number; actions: Record<string, number> }> = {
      baseline: { impressions: 0, engaged: 0, actions: {} },
      neural: { impressions: 0, engaged: 0, actions: {} },
    };

    for (const a of agents) {
      const hidden = parseVec(a.personaEmbedding);
      if (!hidden || hidden.length !== 1536) continue;
      const persona = a.persona as { reply_propensity?: number };
      const replyProp = persona.reply_propensity ?? 0.3;

      // Variant assignment: deterministic by agent + round, ~50/50
      const variant: "baseline" | "neural" = hashStr(`${a.agentId}-${round}`) % 2 === 0 ? "baseline" : "neural";

      const feed = await withRetry(() => generateFeed(a.agentId, variant, FEED_SIZE), `feed-${a.handle}`);

      // Insert all impressions for this feed as a single batch
      const rows: typeof schema.impressions.$inferInsert[] = [];

      for (let pos = 0; pos < feed.length; pos++) {
        const post = feed[pos];
        const postVec = parseVec(post.embedding);
        if (!postVec) continue;

        const isFollowed = followsSet.has(`${a.agentId}::${post.author_id}`);
        const sim = simulateEngagement({
          hiddenPrefVec: hidden,
          postEmbedding: postVec,
          isFollowed,
          replyPropensity: replyProp,
        });

        tally[variant].impressions++;
        tally[variant].actions[sim.action] = (tally[variant].actions[sim.action] ?? 0) + 1;
        if (sim.positive) tally[variant].engaged++;

        rows.push({
          viewerAgentId: a.agentId,
          postId: post.post_id,
          position: pos,
          feedVariant: `sim:${variant}`,
          candidateSource: variant === "neural" ? "twotower-knn" : "follow-graph",
          shownAt: new Date(),
          engagedAt: new Date(),
          engagementKind: sim.action.toLowerCase(),
          score: sim.cosine.toFixed(4),
        });
      }

      if (rows.length > 0) {
        await withRetry(() => db.insert(schema.impressions).values(rows), `insert-${a.handle}`);
      }
      // Tiny pacing to spare Neon
      await new Promise((r) => setTimeout(r, 20));
    }

    const elapsed = (Date.now() - tRound) / 1000;
    const blEng = (tally.baseline.engaged / Math.max(1, tally.baseline.impressions)) * 100;
    const nuEng = (tally.neural.engaged / Math.max(1, tally.neural.impressions)) * 100;
    const lift = nuEng - blEng;

    console.log(`\n── Round ${round} (${elapsed.toFixed(1)}s) ──`);
    console.log(
      `  baseline:  ${tally.baseline.impressions} impressions, ${tally.baseline.engaged} engaged  (${blEng.toFixed(1)}%)`
    );
    console.log(
      `  neural:    ${tally.neural.impressions} impressions, ${tally.neural.engaged} engaged  (${nuEng.toFixed(1)}%)`
    );
    console.log(`  lift:      ${lift >= 0 ? "+" : ""}${lift.toFixed(1)} pts`);

    // Action breakdown
    console.log(`  actions baseline: ${JSON.stringify(tally.baseline.actions)}`);
    console.log(`  actions neural:   ${JSON.stringify(tally.neural.actions)}`);

    totalImpressions += tally.baseline.impressions + tally.neural.impressions;
    totalEngaged += tally.baseline.engaged + tally.neural.engaged;
  }

  console.log(`\n=== SUMMARY ===`);
  console.log(`Total impressions logged: ${totalImpressions}`);
  console.log(`Total positive engagements: ${totalEngaged}`);
  console.log(`Overall engagement rate: ${((totalEngaged / totalImpressions) * 100).toFixed(1)}%`);
}

main().catch((err) => {
  console.error("FAIL:", err);
  process.exit(1);
});
