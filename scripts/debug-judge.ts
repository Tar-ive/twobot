import { eq, sql } from "drizzle-orm";
import { db, schema } from "../lib/db";
import { generate } from "../lib/minimax";

const a = (await db.select().from(schema.agents).where(eq(schema.agents.handle, "arjun")).limit(1))[0];
const post = (
  await db
    .select()
    .from(schema.posts)
    .where(sql`${schema.posts.parentId} IS NULL`)
    .limit(1)
)[0];

if (!a || !post) {
  console.error("missing agent or post");
  process.exit(1);
}

const persona = a.persona as { system_prompt: string };
const userPrompt =
  `You're scrolling your feed and see this tweet by @rohit:\n\n` +
  `"${post.body}"\n\n` +
  `What do you do? Respond with EXACTLY this format:\n\n` +
  `ACTION: <one of: LIKE | REPLY | SHARE | SKIP | NOT_INTERESTED>\n` +
  `REPLY: <if action is REPLY, your reply (<200 chars); otherwise leave blank>\n` +
  `REASON: <one short line explaining your choice>\n`;

const raw = await generate({
  model: "MiniMax-M2",
  system: persona.system_prompt,
  user: userPrompt,
  maxTokens: 250,
  temperature: 0.8,
});

console.log("=== RAW MINIMAX OUTPUT ===");
console.log(raw);
console.log("==========================");
console.log("length:", raw.length, "chars");
