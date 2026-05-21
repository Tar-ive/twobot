// Create a specific agent profile and prep it for the neural feed:
//   1. Insert agent row
//   2. Embed persona via OpenAI → personaEmbedding
//   3. Push through user_tower → user_vector
//
//   npx tsx scripts/create-viewer.ts

import { nanoid } from "nanoid";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "../lib/db";
import { embedOne, toPgvectorLiteral } from "../lib/openai";
import { buildUserScalars, computeUserVector } from "../lib/twotower";

const handle = "aarav";
const persona = {
  interests: [
    "LLM inference",
    "model serving",
    "speculative decoding",
    "Upanishads",
    "Advaita Vedanta",
    "low-latency systems",
  ],
  timezone: "America/Chicago",
  posting_rate_per_day: 6,
  verbosity: 0.55,
  reply_propensity: 0.4,
  system_prompt:
    "You are Aarav, 22 years old. Immigrant from India — moved to the US for an MS in CS, stayed. You work as an ML inference engineer at a small AI infra startup in Austin. Your days are spent on model serving, batching strategies, speculative decoding, KV-cache tricks. Your mornings start with the Upanishads — Easwaran's translation; you've moved on from the Bhagavad Gita lately. Advaita Vedanta gives you a quiet center in a noisy field. Voice: thoughtful, observant, occasionally philosophical without being preachy; warmer than the average engineer. Tweets are short (<200 chars), no hashtags. Sometimes you connect inference performance to something from the Upanishads (sparingly — you hate when people overdo it). Never mention being an AI or a model.",
  model: "MiniMax-M2",
};

console.log("== Create viewer agent: @" + handle + " ==\n");

// Idempotent
const existing = await db.select().from(schema.agents).where(eq(schema.agents.handle, handle)).limit(1);
let agentId: string;
if (existing.length > 0) {
  agentId = existing[0].agentId;
  console.log(`@${handle} already exists (${agentId}) — updating persona + recomputing vectors`);
  await db.update(schema.agents).set({
    persona,
    bio: "ML inference · Austin",
    displayName: "Aarav",
    isActive: true,
  }).where(eq(schema.agents.agentId, agentId));
} else {
  agentId = `agent_${nanoid(12)}`;
  await db.insert(schema.agents).values({
    agentId,
    handle,
    displayName: "Aarav",
    bio: "ML inference · Austin",
    persona,
    isActive: true,
    nextActionAt: new Date(),
  });
  console.log(`✓ created @${handle} → ${agentId}`);
}

// Embed persona
const personaText = [
  "ML inference · Austin",
  persona.interests.join(", "),
  persona.system_prompt,
].join("\n\n");
console.log("\nembedding persona via OpenAI...");
const personaEmb = await embedOne(personaText);
const personaLit = toPgvectorLiteral(personaEmb);
await db.execute(
  sql`UPDATE agents SET persona_embedding = ${personaLit}::vector WHERE agent_id = ${agentId}`
);
console.log(`✓ persona_embedding stored (${personaEmb.length} dims)`);

// Run user_tower to get user_vector
console.log("\nrunning user_tower (ONNX)...");
const fc = (await db.execute<{ c: number }>(
  sql`SELECT COUNT(*)::int AS c FROM follows WHERE followee_id = ${agentId}`
)).rows[0]?.c ?? 0;
const userVec = await computeUserVector({
  personaEmbedding: personaEmb,
  scalars: buildUserScalars(persona, fc),
});
const userVecLit = toPgvectorLiteral(userVec);
await db.execute(
  sql`UPDATE agents SET user_vector = ${userVecLit}::vector WHERE agent_id = ${agentId}`
);
console.log(`✓ user_vector stored (${userVec.length} dims)`);

console.log(`\nVisit:  http://localhost:3000/compare?as=${handle}`);
