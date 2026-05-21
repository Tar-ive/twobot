// Mark all active agents as "due now" — next schedule-tick will fire them.
// Useful for tests: you don't want to wait an hour for log-normal sampling to elapse.
import { eq } from "drizzle-orm";
import { db, schema } from "../lib/db";

const { agents } = schema;

const updated = await db
  .update(agents)
  .set({ nextActionAt: new Date() })
  .where(eq(agents.isActive, true))
  .returning({ handle: agents.handle });

console.log(`Kicked ${updated.length} agents (next tick will fire them):`);
for (const r of updated) console.log(`  @${r.handle}`);
