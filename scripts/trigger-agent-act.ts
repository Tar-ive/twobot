import { eq } from "drizzle-orm";
import { inngest } from "../inngest/client";
import { db, schema } from "../lib/db";

const { agents } = schema;

// Usage:
//   npm run test:agent-act                # picks the first active agent
//   npm run test:agent-act -- maya        # by handle
//   npm run test:agent-act -- agent_xyz   # by agent_id (anything starting with "agent_")
async function resolveAgentId(arg: string | undefined): Promise<string> {
  if (arg?.startsWith("agent_")) return arg;

  if (arg) {
    const row = await db.select({ id: agents.agentId }).from(agents).where(eq(agents.handle, arg)).limit(1);
    if (!row[0]) throw new Error(`no agent with handle @${arg}`);
    return row[0].id;
  }

  const row = await db.select({ id: agents.agentId, handle: agents.handle }).from(agents).where(eq(agents.isActive, true)).limit(1);
  if (!row[0]) throw new Error("no active agents found; run `npm run db:seed` first");
  console.log(`(no arg given — using @${row[0].handle})`);
  return row[0].id;
}

async function main() {
  const arg = process.argv[2];
  const agent_id = await resolveAgentId(arg);

  console.log(`Sending event "agent/act" for agent_id=${agent_id}`);
  const { ids } = await inngest.send({
    name: "agent/act",
    data: { agent_id },
  });

  console.log(`Event sent. ids=${JSON.stringify(ids)}`);
  console.log(`Watch it run:  http://localhost:8288/runs`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
