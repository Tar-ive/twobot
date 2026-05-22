// Smoke-test the mixer's three streams for a given viewer.

import { eq, sql } from "drizzle-orm";
import { db, schema } from "../lib/db";

const handle = process.argv[2] ?? "aarav";
const viewer = (
  await db.select().from(schema.agents).where(eq(schema.agents.handle, handle)).limit(1)
)[0];
if (!viewer) {
  console.error(`No agent @${handle}`);
  process.exit(1);
}

const uv = (
  await db.execute<{ user_vector: string | null }>(
    sql`SELECT user_vector::text FROM agents WHERE agent_id = ${viewer.agentId} LIMIT 1`
  )
).rows[0]?.user_vector;
if (!uv) {
  console.error("viewer has no user_vector");
  process.exit(1);
}

// Stream B: targeted
const targeted = (
  await db.execute<{ post_id: string; author_handle: string; body: string; cluster_id: number; age_min: number }>(sql`
    SELECT p.post_id, a.handle AS author_handle, p.body, p.cluster_id,
           EXTRACT(EPOCH FROM (NOW() - p.created_at))/60 AS age_min
    FROM posts p
    INNER JOIN agents a ON a.agent_id = p.author_id
    WHERE p.target_viewer_id = ${viewer.agentId}
      AND p.generation_source = 'targeted'
      AND p.created_at > NOW() - INTERVAL '24 hours'
    ORDER BY p.created_at DESC LIMIT 6
  `)
).rows;

console.log(`\n── TARGETED stream for @${handle} ──`);
console.log(`count: ${targeted.length}`);
for (const r of targeted) {
  console.log(`  @${r.author_handle} (cluster ${r.cluster_id}, ${Number(r.age_min).toFixed(0)}m ago)`);
  console.log(`    ${r.body.slice(0, 100)}`);
}

// Stream C: exploration (cluster-novel)
const topClusters = (
  await db.execute<{ cluster_id: number }>(sql`
    SELECT p.cluster_id
    FROM impressions i
    INNER JOIN posts p ON p.post_id = i.post_id
    WHERE i.viewer_agent_id = ${viewer.agentId}
      AND i.engagement_kind IN ('like','reply','share','LIKE','REPLY','SHARE')
      AND p.cluster_id IS NOT NULL
    GROUP BY p.cluster_id ORDER BY COUNT(*) DESC LIMIT 3
  `)
).rows.map((r) => r.cluster_id);
console.log(`\n── EXPLORATION stream for @${handle} ──`);
console.log(`viewer's top engaged clusters: ${topClusters.join(", ")}`);
if (topClusters.length > 0) {
  const explore = (
    await db.execute<{ post_id: string; author_handle: string; body: string; cluster_id: number }>(sql`
      SELECT p.post_id, a.handle AS author_handle, p.body, p.cluster_id
      FROM posts p
      INNER JOIN agents a ON a.agent_id = p.author_id
      WHERE p.author_id <> ${viewer.agentId}
        AND p.cluster_id IS NOT NULL
        AND p.cluster_id NOT IN (${sql.join(topClusters.map((c) => sql`${c}`), sql`, `)})
      ORDER BY p.item_vector <=> ${uv}::vector
      LIMIT 6
    `)
  ).rows;
  console.log(`exploration candidates: ${explore.length}`);
  for (const r of explore) {
    console.log(`  @${r.author_handle} (cluster ${r.cluster_id})`);
    console.log(`    ${r.body.slice(0, 100)}`);
  }
}
