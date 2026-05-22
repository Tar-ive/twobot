// Validate the mixer / badge / pipeline plumbing WITHOUT calling MiniMax.
// Picks 3 existing organic posts that semantically match @aarav and marks
// them as `target_viewer_id=aarav, generation_source='targeted'`.
//
// Then checks that getTwoTowerFeed surfaces them as `source: "targeted"`.

import { eq, sql } from "drizzle-orm";
import { db, schema } from "../lib/db";

const handle = process.argv[2] ?? "aarav";
const N = Number(process.argv[3] ?? 3);

const viewer = (
  await db.select().from(schema.agents).where(eq(schema.agents.handle, handle)).limit(1)
)[0];
if (!viewer) {
  console.error(`No agent @${handle}`);
  process.exit(1);
}

console.log(`Tagging ${N} existing posts as targeted for @${handle} (${viewer.agentId})\n`);

// Pick 3 posts in the viewer's most-engaged cluster that they didn't author
const candidates = (
  await db.execute<{ post_id: string; body: string; cluster_id: number; handle: string }>(sql`
    SELECT p.post_id, p.body, p.cluster_id, a.handle
    FROM posts p
    INNER JOIN agents a ON a.agent_id = p.author_id
    WHERE p.author_id <> ${viewer.agentId}
      AND p.target_viewer_id IS NULL
      AND p.cluster_id IS NOT NULL
      AND p.item_vector IS NOT NULL
      AND p.cluster_id IN (
        SELECT p2.cluster_id FROM impressions i
        INNER JOIN posts p2 ON p2.post_id = i.post_id
        WHERE i.viewer_agent_id = ${viewer.agentId}
          AND i.engagement_kind IN ('like','reply','share','LIKE','REPLY','SHARE')
          AND p2.cluster_id IS NOT NULL
        GROUP BY p2.cluster_id ORDER BY COUNT(*) DESC LIMIT 1
      )
    ORDER BY p.created_at DESC LIMIT ${N}
  `)
).rows;

if (candidates.length === 0) {
  console.error("No suitable candidates found.");
  process.exit(1);
}

for (const c of candidates) {
  await db.execute(sql`
    UPDATE posts
    SET target_viewer_id = ${viewer.agentId},
        generation_source = 'targeted',
        created_at = NOW()
    WHERE post_id = ${c.post_id}
  `);
  console.log(`  tagged post_id=${c.post_id} by @${c.handle} (cluster ${c.cluster_id})`);
  console.log(`    body: ${c.body.slice(0, 100)}`);
}

console.log(`\n✓ ${candidates.length} posts re-tagged. Now visit /compare?as=${handle} to see them in the neural feed.`);
