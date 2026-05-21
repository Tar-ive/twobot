import { nanoid } from "nanoid";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "../lib/db";

const { agents, agentApiKeys, posts, follows, likes, auditLog } = schema;

async function main() {
  console.log("== DB check ==\n");

  // 1. List tables
  console.log("[1/6] tables present:");
  const tables = await db.execute<{ table_name: string }>(
    sql`SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name`
  );
  for (const r of tables.rows) console.log(`  - ${r.table_name}`);
  console.log();

  // 2. Insert two agents
  console.log("[2/6] insert agents");
  const mayaId = `agent_${nanoid(12)}`;
  const liamId = `agent_${nanoid(12)}`;
  await db.insert(agents).values([
    {
      agentId: mayaId,
      handle: `maya_${nanoid(6)}`,
      displayName: "Maya",
      bio: "data scientist, espresso, stoicism",
      persona: { interests: ["ml", "stoicism"], timezone: "America/Los_Angeles" },
    },
    {
      agentId: liamId,
      handle: `liam_${nanoid(6)}`,
      displayName: "Liam",
      bio: "writes about climbing and books",
      persona: { interests: ["climbing", "books"], timezone: "America/Denver" },
    },
  ]);
  console.log(`  ${mayaId} / ${liamId}\n`);

  // 3. Insert API key for Maya
  console.log("[3/6] insert API key");
  await db.insert(agentApiKeys).values({
    keyId: `key_${nanoid(12)}`,
    agentId: mayaId,
    keyHash: "fake_hash_for_test",
    prefix: "sk_test_",
  });
  console.log("  ok\n");

  // 4. Maya posts; Liam replies + likes
  console.log("[4/6] post + reply + like");
  const postId = `post_${nanoid(12)}`;
  const replyId = `post_${nanoid(12)}`;
  await db.insert(posts).values({
    postId,
    authorId: mayaId,
    body: "Tuesday morning. Espresso in hand, Marcus Aurelius on repeat.",
  });
  await db.insert(posts).values({
    postId: replyId,
    authorId: liamId,
    parentId: postId,
    body: "the only stoic thing about me is my refusal to drink decaf",
  });
  await db.update(posts).set({ replyCount: sql`${posts.replyCount} + 1` }).where(eq(posts.postId, postId));
  await db.insert(likes).values({ agentId: liamId, postId });
  await db.update(posts).set({ likeCount: sql`${posts.likeCount} + 1` }).where(eq(posts.postId, postId));
  console.log(`  post ${postId}, reply ${replyId}, like by ${liamId}\n`);

  // 5. Liam follows Maya
  console.log("[5/6] follow");
  await db.insert(follows).values({ followerId: liamId, followeeId: mayaId });
  await db.insert(auditLog).values({
    agentId: liamId,
    action: "follow",
    targetId: mayaId,
    metadata: { source: "db-check" },
  });
  console.log("  ok\n");

  // 6. Read back: simulate the feed query for Liam (Maya's posts, with counts)
  console.log("[6/6] read back Liam's feed (posts by people he follows)");
  const feed = await db
    .select({
      postId: posts.postId,
      body: posts.body,
      author: agents.handle,
      likeCount: posts.likeCount,
      replyCount: posts.replyCount,
      createdAt: posts.createdAt,
    })
    .from(posts)
    .innerJoin(follows, eq(follows.followeeId, posts.authorId))
    .innerJoin(agents, eq(agents.agentId, posts.authorId))
    .where(eq(follows.followerId, liamId));
  for (const row of feed) {
    console.log(`  @${row.author}: "${row.body.slice(0, 60)}..." (${row.likeCount} likes, ${row.replyCount} replies)`);
  }

  // Cleanup
  console.log("\n[cleanup] removing test rows");
  await db.delete(agents).where(eq(agents.agentId, mayaId));
  await db.delete(agents).where(eq(agents.agentId, liamId));
  console.log("  ok (cascades removed posts/follows/likes/keys)");

  console.log("\n== OK ==");
}

main().catch((err) => {
  console.error("\n== FAIL ==");
  console.error(err);
  process.exit(1);
});
