// Manually create an agent + API key for an already-signed-in Clerk user.
// Use when the Clerk webhook is broken or not yet wired.
//
//   npm run agent:create-for-user -- user_3DyRlc2ongZwyRhm93RmC4hqj0Q [handle]
//
// Idempotent: if an agent already exists for that user, just prints it.
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, schema } from "../lib/db";
import { generateApiKey, hashApiKey } from "../lib/api-key";

const clerkUserId = process.argv[2];
const requestedHandle = process.argv[3];

if (!clerkUserId || !clerkUserId.startsWith("user_")) {
  console.error('Usage: tsx scripts/create-agent-for-user.ts <clerk_user_id> [handle]');
  console.error('Example: tsx scripts/create-agent-for-user.ts user_3DyRlc2ongZwyRhm93RmC4hqj0Q tarive');
  process.exit(1);
}

const existing = await db
  .select()
  .from(schema.agents)
  .where(eq(schema.agents.clerkUserId, clerkUserId))
  .limit(1);

if (existing.length > 0) {
  const a = existing[0];
  console.log(`Agent already exists for ${clerkUserId}:`);
  console.log(`  @${a.handle} (${a.agentId})`);
  console.log(`  active: ${a.isActive}`);
  console.log("\nReload your browser — you should see this agent on the home page.");
  process.exit(0);
}

// Pick a unique handle
const baseHandle = (requestedHandle ?? clerkUserId.slice(5, 15))
  .toLowerCase()
  .replace(/[^a-z0-9_]/g, "")
  .slice(0, 16) || "user";

let handle = baseHandle;
let suffix = 0;
while (true) {
  const taken = await db.select().from(schema.agents).where(eq(schema.agents.handle, handle)).limit(1);
  if (taken.length === 0) break;
  suffix++;
  handle = `${baseHandle}${suffix}`;
}

const agentId = `agent_${nanoid(12)}`;

await db.insert(schema.agents).values({
  agentId,
  clerkUserId,
  operatorId: clerkUserId,
  handle,
  displayName: handle,
  persona: {
    interests: [],
    timezone: "UTC",
    posting_rate_per_day: 4,
    verbosity: 0.5,
    reply_propensity: 0.3,
    system_prompt:
      "You are a thoughtful person sharing small observations from your day. Write short tweets (<200 chars), no hashtags. Never mention being an AI.",
    model: "MiniMax-M2",
  },
  isActive: false,
});

const { key, prefix } = generateApiKey();
await db.insert(schema.agentApiKeys).values({
  keyId: `key_${nanoid(12)}`,
  agentId,
  keyHash: hashApiKey(key),
  prefix,
});

await db.insert(schema.auditLog).values({
  agentId,
  action: "agent.created",
  targetId: clerkUserId,
  metadata: { source: "manual-script", key_prefix: prefix },
});

console.log(`✓ created @${handle} (${agentId})`);
console.log(`  linked to clerk user ${clerkUserId}`);
console.log(`\n  ONE-TIME API KEY (copy now, won't be shown again):`);
console.log(`  ${key}`);
console.log(`\nReload your browser — you should see this agent on the home page.`);
