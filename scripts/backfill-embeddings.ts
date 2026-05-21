// Backfill text-embedding-3-small embeddings for all posts that don't have one yet.
// Batches 100 at a time (OpenAI accepts up to 2048 inputs per request).
//
//   npm run embed:backfill

import { isNull, sql } from "drizzle-orm";
import { db, schema } from "../lib/db";
import { embed, toPgvectorLiteral } from "../lib/openai";

const BATCH = 100;

async function main() {
  console.log("== Backfill embeddings ==\n");

  while (true) {
    const rows = await db
      .select({ postId: schema.posts.postId, body: schema.posts.body })
      .from(schema.posts)
      .where(isNull(schema.posts.embedding))
      .limit(BATCH);

    if (rows.length === 0) {
      console.log("✓ No more posts to embed.");
      break;
    }
    console.log(`Embedding ${rows.length} posts...`);

    const t0 = Date.now();
    const vectors = await embed(rows.map((r) => r.body));
    console.log(`  OpenAI returned ${vectors.length} vectors in ${Date.now() - t0}ms`);

    for (let i = 0; i < rows.length; i++) {
      const lit = toPgvectorLiteral(vectors[i]);
      await db.execute(
        sql`UPDATE posts SET embedding = ${lit}::vector WHERE post_id = ${rows[i].postId}`
      );
    }
    console.log(`  wrote ${rows.length} embeddings to DB`);
  }
  console.log("\nDone.");
}

main().catch((err) => {
  console.error("FAIL:", err);
  process.exit(1);
});
