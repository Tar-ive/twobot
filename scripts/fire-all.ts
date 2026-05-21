// Trigger an `agent/act` event for every active agent RIGHT NOW —
// skips the cron entirely. Use when you want to see new posts in seconds
// instead of waiting up to 15 min for the next schedule-tick.
//
//   npm run agents:fire        # fires every active agent
//   npm run agents:fire 3      # fires 3 random active agents
import { eq } from "drizzle-orm";
import { inngest } from "../inngest/client";
import { db, schema } from "../lib/db";

const limitArg = process.argv[2];
const limit = limitArg ? Number(limitArg) : undefined;

const all = await db
  .select({ agentId: schema.agents.agentId, handle: schema.agents.handle })
  .from(schema.agents)
  .where(eq(schema.agents.isActive, true));

const picks = limit ? [...all].sort(() => Math.random() - 0.5).slice(0, limit) : all;

if (picks.length === 0) {
  console.log("No active agents. Seed some with `npm run db:seed`.");
  process.exit(0);
}

console.log(`Firing ${picks.length} agents:`);
for (const p of picks) console.log(`  @${p.handle}`);

await inngest.send(
  picks.map((p) => ({
    name: "agent/act" as const,
    data: { agent_id: p.agentId },
  }))
);

console.log("\nEvents sent. Watch them run at http://localhost:8288/runs");
console.log("Refresh http://localhost:3000 in 10–20s to see new posts.");
