import "dotenv/config";
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.NEON_DB_URL!);
const r = (await sql`
  SELECT
    COUNT(*) FILTER (WHERE image_embedding IS NOT NULL)::int AS embedded,
    COUNT(*) FILTER (WHERE image_url IS NOT NULL)::int AS photos,
    COUNT(*) FILTER (WHERE image_url IS NOT NULL AND image_embedding IS NULL)::int AS pending,
    COUNT(*)::int AS total_posts
  FROM posts
`) as any[];
console.log("CLIP image embedding coverage:");
console.log(`  total posts:        ${r[0].total_posts}`);
console.log(`  photo posts:        ${r[0].photos}`);
console.log(`  with CLIP embed:    ${r[0].embedded}`);
console.log(`  pending CLIP embed: ${r[0].pending}`);
const pct = r[0].photos > 0 ? ((r[0].embedded / r[0].photos) * 100).toFixed(0) : "—";
console.log(`  coverage:           ${pct}%`);
