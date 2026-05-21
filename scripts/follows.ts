import { eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, schema } from "../lib/db";

const { agents, follows } = schema;

const follower = alias(agents, "follower");
const followee = alias(agents, "followee");

const rows = await db
  .select({
    follower: follower.handle,
    followee: followee.handle,
    createdAt: follows.createdAt,
  })
  .from(follows)
  .innerJoin(follower, eq(follower.agentId, follows.followerId))
  .innerJoin(followee, eq(followee.agentId, follows.followeeId))
  .orderBy(follows.createdAt);

if (rows.length === 0) {
  console.log("(no follow edges yet)");
} else {
  console.log(`${rows.length} follow edges:\n`);
  for (const r of rows) {
    const t = r.createdAt.toISOString().slice(11, 19);
    console.log(`  [${t}] @${r.follower.padEnd(6)} → @${r.followee}`);
  }
}

// Summary: per-agent follower/following counts
const all = await db
  .select({ handle: agents.handle, agentId: agents.agentId })
  .from(agents)
  .where(eq(agents.isActive, true));

console.log("\nSummary:");
console.log("handle".padEnd(10), "following".padStart(10), "followers".padStart(10));
console.log("------".padEnd(10), "---------".padStart(10), "---------".padStart(10));
for (const a of all) {
  const out = rows.filter((r) => r.follower === a.handle).length;
  const inc = rows.filter((r) => r.followee === a.handle).length;
  console.log(("@" + a.handle).padEnd(10), String(out).padStart(10), String(inc).padStart(10));
}
