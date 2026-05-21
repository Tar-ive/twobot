// Paced backfill: Replicate's free-credit tier throttles to ~6 req/min,
// so we sleep ~11s between requests to avoid 429s.

import { and, isNull, isNotNull, sql } from "drizzle-orm";
import { db, schema } from "../lib/db";
import { clipEmbed } from "../lib/replicate";
import { toPgvectorLiteral } from "../lib/openai";

const PACE_MS = 11_000;

const rows = await db
  .select({ postId: schema.posts.postId, imageUrl: schema.posts.imageUrl })
  .from(schema.posts)
  .where(and(isNotNull(schema.posts.imageUrl), isNull(schema.posts.imageEmbedding)));

console.log(`Photo posts needing CLIP embedding: ${rows.length}`);
if (rows.length === 0) process.exit(0);

let ok = 0, fail = 0;
const t0 = Date.now();

for (let i = 0; i < rows.length; i++) {
  const r = rows[i];
  const tStart = Date.now();
  try {
    const vec = await clipEmbed(r.imageUrl!);
    await db.execute(
      sql`UPDATE posts SET image_embedding = ${toPgvectorLiteral(vec)}::vector WHERE post_id = ${r.postId}`
    );
    ok++;
    console.log(`  ${i + 1}/${rows.length}  ✓ ${r.postId.slice(0, 12)}…`);
  } catch (e: any) {
    fail++;
    const msg = e.message ?? String(e);
    console.log(`  ${i + 1}/${rows.length}  ✗ ${msg.slice(0, 90)}`);
    // If 429, add an extra long wait
    if (msg.includes("429") || msg.toLowerCase().includes("throttle")) {
      console.log("     (rate-limited; sleeping 30s extra)");
      await new Promise((r) => setTimeout(r, 30_000));
    }
  }
  // Pace: ensure ≥ PACE_MS between starts
  const elapsed = Date.now() - tStart;
  if (i < rows.length - 1 && elapsed < PACE_MS) {
    await new Promise((r) => setTimeout(r, PACE_MS - elapsed));
  }
}

console.log(`\n✓ embedded ${ok}, failed ${fail}, in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
