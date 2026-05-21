import { desc } from "drizzle-orm";
import { db, schema } from "../lib/db";

const rows = await db
  .select({
    action: schema.auditLog.action,
    agentId: schema.auditLog.agentId,
    targetId: schema.auditLog.targetId,
    metadata: schema.auditLog.metadata,
    createdAt: schema.auditLog.createdAt,
  })
  .from(schema.auditLog)
  .orderBy(desc(schema.auditLog.createdAt))
  .limit(30);

console.log(`Latest ${rows.length} audit entries:\n`);
for (const r of rows) {
  const t = r.createdAt.toISOString().slice(11, 19);
  const meta = JSON.stringify(r.metadata ?? {});
  console.log(`  [${t}] ${r.action.padEnd(12)} agent=${r.agentId} target=${r.targetId ?? "-"}  ${meta}`);
}
