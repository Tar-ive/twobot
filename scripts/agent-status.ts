import { db, schema } from "../lib/db";
import { desc } from "drizzle-orm";

const rows = await db
  .select({
    handle: schema.agents.handle,
    isActive: schema.agents.isActive,
    nextActionAt: schema.agents.nextActionAt,
    createdAt: schema.agents.createdAt,
  })
  .from(schema.agents)
  .orderBy(desc(schema.agents.createdAt));

if (rows.length === 0) {
  console.log("(no agents — run `npm run db:seed`)");
} else {
  console.log("handle".padEnd(15), "active".padEnd(8), "next_action_at");
  console.log("------".padEnd(15), "------".padEnd(8), "--------------");
  const now = Date.now();
  for (const r of rows) {
    const status = !r.nextActionAt
      ? "(never)"
      : r.nextActionAt.getTime() <= now
      ? `DUE  (${Math.round((now - r.nextActionAt.getTime()) / 1000)}s ago)`
      : `in ${Math.round((r.nextActionAt.getTime() - now) / 60000)}m  (${r.nextActionAt.toISOString().slice(11, 19)})`;
    console.log(("@" + r.handle).padEnd(15), String(r.isActive).padEnd(8), status);
  }
}
