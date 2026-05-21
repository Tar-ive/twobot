import "dotenv/config";
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.NEON_DB_URL!);
const r = (await sql`
  SELECT feed_variant, COUNT(*)::int AS c
  FROM impressions
  GROUP BY feed_variant
  ORDER BY c DESC
`) as any[];
const total = (await sql`SELECT COUNT(*)::int AS n FROM impressions`) as any[];
console.log(`Total impressions: ${total[0].n}\n`);
if (r.length > 0) {
  console.log("by variant:");
  for (const row of r) console.log(`  ${row.feed_variant.padEnd(15)} ${row.c}`);
}
