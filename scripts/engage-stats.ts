import "dotenv/config";
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.NEON_DB_URL!);
const r = (await sql`
  SELECT action, COUNT(*) AS c FROM synthetic_engagements GROUP BY action ORDER BY c DESC
`) as any[];
const total = (await sql`SELECT COUNT(*)::int AS n FROM synthetic_engagements`) as any[];
console.log(`Total synthetic engagement labels: ${total[0].n}\n`);
console.log("Action distribution:");
for (const row of r) {
  const pct = ((row.c / total[0].n) * 100).toFixed(1);
  console.log(`  ${row.action.padEnd(18)} ${String(row.c).padStart(5)}  (${pct}%)`);
}
