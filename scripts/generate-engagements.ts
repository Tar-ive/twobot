// Generate synthetic (agent, post) engagement labels using MiniMax-as-judge.
//
//   npm run engage:gen                      # default: 5000 labels
//   npm run engage:gen 1000                 # generate 1000 labels
//   npm run engage:gen 1000 --concurrency=20
//
// Sampling: each (agent, post) pair is unique; we won't re-label what's already labeled.
// For each agent we pick up to N random posts from other agents.

import { and, desc, eq, ne, notInArray, sql } from "drizzle-orm";
import { db, schema } from "../lib/db";
import { judgeEngagement } from "../lib/engagement-judge";
import { runBatch } from "../lib/batch";

const TARGET = Number(process.argv[2] ?? 5000);
const CONCURRENCY = Number(process.argv.find((a) => a.startsWith("--concurrency="))?.split("=")[1] ?? 6);
const POSTS_PER_AGENT = 60;

async function main() {
  console.log(`== Synthetic engagement generation ==`);
  console.log(`target: ${TARGET} labels, concurrency: ${CONCURRENCY}\n`);

  // 1. Load active agents + recent posts
  const agents = await db
    .select({ agentId: schema.agents.agentId, handle: schema.agents.handle, persona: schema.agents.persona })
    .from(schema.agents)
    .where(eq(schema.agents.isActive, true));
  console.log(`agents:  ${agents.length}`);

  const allPosts = await db
    .select({
      postId: schema.posts.postId,
      authorId: schema.posts.authorId,
      authorHandle: schema.agents.handle,
      body: schema.posts.body,
    })
    .from(schema.posts)
    .innerJoin(schema.agents, eq(schema.posts.authorId, schema.agents.agentId))
    .where(sql`${schema.posts.parentId} IS NULL`)
    .orderBy(desc(schema.posts.createdAt))
    .limit(500);
  console.log(`posts:   ${allPosts.length}`);

  // 2. Build (agent, post) pairs, excluding self-authored + already-labeled pairs.
  const existing = await db
    .select({ agentId: schema.syntheticEngagements.agentId, postId: schema.syntheticEngagements.postId })
    .from(schema.syntheticEngagements);
  const existingSet = new Set(existing.map((r) => `${r.agentId}::${r.postId}`));

  type Pair = {
    agentId: string;
    handle: string;
    persona: any;
    postId: string;
    authorHandle: string;
    body: string;
  };

  const pairs: Pair[] = [];
  for (const a of agents) {
    const candidates = allPosts.filter((p) => p.authorId !== a.agentId);
    // Random subset
    const sample = [...candidates].sort(() => Math.random() - 0.5).slice(0, POSTS_PER_AGENT);
    for (const p of sample) {
      const k = `${a.agentId}::${p.postId}`;
      if (existingSet.has(k)) continue;
      pairs.push({
        agentId: a.agentId,
        handle: a.handle,
        persona: a.persona,
        postId: p.postId,
        authorHandle: p.authorHandle,
        body: p.body,
      });
      if (pairs.length >= TARGET) break;
    }
    if (pairs.length >= TARGET) break;
  }

  console.log(`new pairs to label: ${pairs.length}\n`);
  if (pairs.length === 0) {
    console.log("Nothing to do — every (agent, post) sampled is already labeled. Increase --target or seed more posts.");
    return;
  }

  // 3. Fire in parallel via batch runner.
  const t0 = Date.now();
  let lastReport = 0;

  const results = await runBatch(
    pairs,
    async (pair) => {
      const persona = pair.persona as { system_prompt: string };
      const j = await judgeEngagement({
        personaSystemPrompt: persona.system_prompt,
        agentHandle: pair.handle,
        postAuthorHandle: pair.authorHandle,
        postBody: pair.body,
      });
      // Write immediately so partial progress survives interruption
      await db.insert(schema.syntheticEngagements).values({
        agentId: pair.agentId,
        postId: pair.postId,
        action: j.action,
        replyText: j.replyText,
        reason: j.reason,
      });
      return j.action;
    },
    {
      concurrency: CONCURRENCY,
      maxRetries: 3,
      onProgress: (p) => {
        if (Date.now() - lastReport > 3000) {
          const elapsed = (Date.now() - t0) / 1000;
          const rate = p.completed / elapsed;
          const eta = (p.total - p.completed) / Math.max(rate, 0.01);
          process.stdout.write(
            `  ${p.completed.toString().padStart(5)}/${p.total}  ${rate.toFixed(1)}/s  err=${p.errors}  eta=${eta.toFixed(0)}s\n`
          );
          lastReport = Date.now();
        }
      },
    }
  );

  const wall = (Date.now() - t0) / 1000;
  const ok = results.filter((r) => r.ok).length;
  const fail = results.filter((r) => !r.ok).length;

  // Tally action distribution
  const tally: Record<string, number> = {};
  for (const r of results) {
    if (r.ok) tally[r.value as string] = (tally[r.value as string] ?? 0) + 1;
  }

  console.log(`\n=== DONE ===`);
  console.log(`Total: ${results.length} pairs in ${wall.toFixed(1)}s  (${(results.length / wall).toFixed(1)}/sec)`);
  console.log(`Success: ${ok}   Failed: ${fail}`);
  console.log(`Action distribution:`);
  for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
    const pct = ((v / ok) * 100).toFixed(1);
    console.log(`  ${k.padEnd(18)} ${v.toString().padStart(5)}  (${pct}%)`);
  }
}

main().catch((err) => {
  console.error("FAIL:", err);
  process.exit(1);
});
