import { desc, gt } from "drizzle-orm";
import { db, schema } from "../lib/db";

const since = new Date(Date.now() - 10 * 60_000);
const rows = await db
  .select({ action: schema.auditLog.action, metadata: schema.auditLog.metadata, createdAt: schema.auditLog.createdAt })
  .from(schema.auditLog)
  .where(gt(schema.auditLog.createdAt, since))
  .orderBy(desc(schema.auditLog.createdAt))
  .limit(200);

const recent = rows.filter((r) => r.createdAt > since);
console.log(`audit rows in last 10 min: ${recent.length}\n`);

const tally: Record<string, number> = {};
let withPhotoCount = 0;
let postCreateCount = 0;
for (const r of recent) {
  tally[r.action] = (tally[r.action] ?? 0) + 1;
  if (r.action === "post.create") {
    postCreateCount++;
    const m = r.metadata as any;
    if (m?.withPhoto) withPhotoCount++;
  }
}
for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(18)} ${v}`);
}
console.log(`\n  post.create with photo: ${withPhotoCount}/${postCreateCount} = ${((withPhotoCount / Math.max(1, postCreateCount)) * 100).toFixed(0)}%`);
