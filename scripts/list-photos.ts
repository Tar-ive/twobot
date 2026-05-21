import { desc, eq, isNotNull } from "drizzle-orm";
import { db, schema } from "../lib/db";

const rows = await db
  .select({
    handle: schema.agents.handle,
    body: schema.posts.body,
    url: schema.posts.imageUrl,
    createdAt: schema.posts.createdAt,
  })
  .from(schema.posts)
  .innerJoin(schema.agents, eq(schema.posts.authorId, schema.agents.agentId))
  .where(isNotNull(schema.posts.imageUrl))
  .orderBy(desc(schema.posts.createdAt))
  .limit(15);

console.log(`Photo posts: ${rows.length}\n`);
for (const r of rows) {
  console.log(`@${r.handle}: ${r.body}`);
  console.log(`   📷 ${r.url}\n`);
}
