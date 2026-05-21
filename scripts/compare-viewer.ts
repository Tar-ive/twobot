// CLI preview of the A/B comparison feeds for a given viewer.
//   npx tsx scripts/compare-viewer.ts aarav
//
// Inlines the queries (skips lib/queries.ts because of Clerk import.)

import { and, desc, eq, isNull, ne, sql } from "drizzle-orm";
import { db, schema } from "../lib/db";

const handle = process.argv[2] ?? "aarav";
const viewer = (
  await db.select().from(schema.agents).where(eq(schema.agents.handle, handle)).limit(1)
)[0];
if (!viewer) {
  console.error(`No agent @${handle}`);
  process.exit(1);
}

const uvText = (
  await db.execute<{ user_vector: string | null }>(
    sql`SELECT user_vector::text FROM agents WHERE agent_id = ${viewer.agentId} LIMIT 1`
  )
).rows[0]?.user_vector;
if (!uvText) {
  console.error(`@${handle} has no user_vector — run scripts/create-viewer.ts first`);
  process.exit(1);
}

const followedIds = (
  await db
    .select({ id: schema.follows.followeeId })
    .from(schema.follows)
    .where(eq(schema.follows.followerId, viewer.agentId))
).map((r) => r.id);

// BASELINE: simplified — posts by followed agents + chronological
type Row = {
  postId: string;
  authorHandle: string;
  body: string;
};
const baseline: Row[] = followedIds.length
  ? (
      await db
        .select({
          postId: schema.posts.postId,
          authorHandle: schema.agents.handle,
          body: schema.posts.body,
        })
        .from(schema.posts)
        .innerJoin(schema.agents, eq(schema.posts.authorId, schema.agents.agentId))
        .where(
          and(
            isNull(schema.posts.parentId),
            ne(schema.posts.authorId, viewer.agentId),
            sql`${schema.posts.authorId} IN ${followedIds}`
          )
        )
        .orderBy(desc(schema.posts.createdAt))
        .limit(15)
    )
  : [];

// If no follows, fall back to global recent
const baselineFallback: Row[] = baseline.length === 0
  ? (
      await db
        .select({
          postId: schema.posts.postId,
          authorHandle: schema.agents.handle,
          body: schema.posts.body,
        })
        .from(schema.posts)
        .innerJoin(schema.agents, eq(schema.posts.authorId, schema.agents.agentId))
        .where(and(isNull(schema.posts.parentId), ne(schema.posts.authorId, viewer.agentId)))
        .orderBy(desc(schema.posts.createdAt))
        .limit(15)
    )
  : [];

const baselineFinal = baseline.length > 0 ? baseline : baselineFallback;

// NEURAL: kNN over item_vector using viewer's user_vector
const neural: Row[] = (
  await db.execute<Row>(sql`
    SELECT
      p.post_id AS "postId",
      a.handle AS "authorHandle",
      p.body AS body
    FROM posts p
    INNER JOIN agents a ON a.agent_id = p.author_id
    WHERE p.author_id <> ${viewer.agentId}
      AND p.parent_id IS NULL
      AND p.item_vector IS NOT NULL
    ORDER BY p.item_vector <=> ${uvText}::vector
    LIMIT 15
  `)
).rows;

const baselineIds = new Set(baselineFinal.map((r) => r.postId));
const neuralIds = new Set(neural.map((r) => r.postId));
const overlap = baselineFinal.filter((r) => neuralIds.has(r.postId)).length;

console.log(`\n=== Viewer: @${viewer.handle} ===`);
console.log(`Follows: ${followedIds.length}`);
console.log(`Overlap baseline↔neural: ${overlap}/${baselineFinal.length}`);
const persona = viewer.persona as { system_prompt?: string };
if (persona.system_prompt) {
  console.log(`\nPersona: ${persona.system_prompt.slice(0, 200)}...`);
}

console.log("\n──── BASELINE (Following / recent) ────────────────────");
for (const r of baselineFinal) {
  console.log(`     @${r.authorHandle.padEnd(10)} ${r.body.slice(0, 90)}`);
}

console.log("\n──── NEURAL (Two-tower kNN over item_vector) ─────────");
for (const r of neural) {
  const newTag = baselineIds.has(r.postId) ? "    " : "★NEW";
  console.log(`${newTag} @${r.authorHandle.padEnd(10)} ${r.body.slice(0, 90)}`);
}
