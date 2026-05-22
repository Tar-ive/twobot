// Compute and store user_vector for every agent + item_vector for every post.
// Idempotent — only backfills rows missing the vector.

import { isNull, sql } from "drizzle-orm";
import { db, schema } from "../lib/db";
import {
  buildItemScalars,
  buildUserScalars,
  computeItemVectorsBatch,
  computeUserVectorsBatch,
} from "../lib/twotower";
import { toPgvectorLiteral } from "../lib/openai";

const BATCH = 64;

function parseVec(v: unknown): number[] | null {
  if (Array.isArray(v)) return v as number[];
  if (typeof v === "string") {
    return v.replace(/^\[|\]$/g, "").split(",").map(Number);
  }
  return null;
}

console.log("== Backfill user_vector + item_vector ==\n");

// ---- FOLLOWER MAP ----
const fc = (await db.execute<{ id: string; c: number }>(sql`
  SELECT followee_id AS id, COUNT(*)::int AS c FROM follows GROUP BY followee_id
`)).rows;
const fcMap = new Map(fc.map((r) => [r.id, r.c]));

// ---- USER VECTORS ----
const FORCE_USERS = process.argv.includes("--force");
const usersNeed = FORCE_USERS
  ? await db.select().from(schema.agents)
  : await db.select().from(schema.agents).where(isNull(schema.agents.userVector));
console.log(`users needing vectors: ${usersNeed.length} (force=${FORCE_USERS})`);

if (usersNeed.length > 0) {

  for (let i = 0; i < usersNeed.length; i += BATCH) {
    const slice = usersNeed.slice(i, i + BATCH);
    const inputs = slice.map((u) => {
      const personaEmb = parseVec(u.personaEmbedding);
      if (!personaEmb || personaEmb.length !== 1536) {
        throw new Error(`agent ${u.agentId} missing persona_embedding`);
      }
      return {
        personaEmbedding: personaEmb,
        scalars: buildUserScalars(u.persona as any, fcMap.get(u.agentId) ?? 0),
      };
    });
    const vecs = await computeUserVectorsBatch(inputs);
    for (let j = 0; j < slice.length; j++) {
      const lit = toPgvectorLiteral(vecs[j]);
      await db.execute(
        sql`UPDATE agents SET user_vector = ${lit}::vector WHERE agent_id = ${slice[j].agentId}`
      );
    }
    console.log(`  wrote ${Math.min(i + BATCH, usersNeed.length)}/${usersNeed.length} user vectors`);
  }
}

// ---- ITEM VECTORS ----
// (recompute for ALL posts since item_tower changed)
const FORCE = process.argv.includes("--force");
const postsQuery = FORCE
  ? db.select({
      postId: schema.posts.postId,
      authorId: schema.posts.authorId,
      embedding: schema.posts.embedding,
      imageEmbedding: schema.posts.imageEmbedding,
      likeCount: schema.posts.likeCount,
      replyCount: schema.posts.replyCount,
      imageUrl: schema.posts.imageUrl,
      createdAt: schema.posts.createdAt,
    }).from(schema.posts)
  : db.select({
      postId: schema.posts.postId,
      authorId: schema.posts.authorId,
      embedding: schema.posts.embedding,
      imageEmbedding: schema.posts.imageEmbedding,
      likeCount: schema.posts.likeCount,
      replyCount: schema.posts.replyCount,
      imageUrl: schema.posts.imageUrl,
      createdAt: schema.posts.createdAt,
    }).from(schema.posts).where(isNull(schema.posts.itemVector));
const postsNeed = await postsQuery;
console.log(`\nposts needing vectors: ${postsNeed.length} (force=${FORCE})`);

if (postsNeed.length > 0) {
  const now = new Date();
  for (let i = 0; i < postsNeed.length; i += BATCH) {
    const slice = postsNeed.slice(i, i + BATCH);
    const inputs = slice.map((p) => {
      const bodyEmb = parseVec(p.embedding);
      if (!bodyEmb || bodyEmb.length !== 1536) {
        throw new Error(`post ${p.postId} missing body embedding`);
      }
      const imgEmb = parseVec(p.imageEmbedding);
      return {
        bodyEmbedding: bodyEmb,
        imageEmbedding: imgEmb && imgEmb.length === 768 ? imgEmb : null,
        scalars: buildItemScalars(p, fcMap.get(p.authorId) ?? 0, now),
      };
    });
    const vecs = await computeItemVectorsBatch(inputs);
    for (let j = 0; j < slice.length; j++) {
      const lit = toPgvectorLiteral(vecs[j]);
      await db.execute(
        sql`UPDATE posts SET item_vector = ${lit}::vector WHERE post_id = ${slice[j].postId}`
      );
    }
    console.log(`  wrote ${Math.min(i + BATCH, postsNeed.length)}/${postsNeed.length} item vectors`);
  }
}

// ---- HNSW INDEX ----
await db.execute(
  sql`CREATE INDEX IF NOT EXISTS posts_item_vector_hnsw_idx ON posts USING hnsw (item_vector vector_cosine_ops)`
);
console.log("\n✓ HNSW index on posts.item_vector ensured");

console.log("\nDone.");
