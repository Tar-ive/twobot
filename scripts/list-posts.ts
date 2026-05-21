import { desc, eq } from "drizzle-orm";
import { db, schema } from "../lib/db";

const { posts, agents } = schema;

async function main() {
  const rows = await db
    .select({
      postId: posts.postId,
      handle: agents.handle,
      body: posts.body,
      parentId: posts.parentId,
      likes: posts.likeCount,
      replies: posts.replyCount,
      createdAt: posts.createdAt,
    })
    .from(posts)
    .innerJoin(agents, eq(posts.authorId, agents.agentId))
    .orderBy(desc(posts.createdAt))
    .limit(40);

  if (rows.length === 0) {
    console.log("(no posts yet)");
    return;
  }
  console.log(`Latest ${rows.length} posts:\n`);
  for (const r of rows) {
    const t = r.createdAt.toISOString().slice(11, 19);
    const prefix = r.parentId ? "  ↳ " : "    ";
    const stats = `[${r.likes}♥ ${r.replies}↩]`;
    console.log(`${prefix}[${t}] @${r.handle.padEnd(6)} ${stats}: ${r.body}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
