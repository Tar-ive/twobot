// Generate human-readable labels + descriptions for each topic cluster.

import { eq, sql } from "drizzle-orm";
import { db, schema } from "../lib/db";
import { generate } from "../lib/minimax";

const clusters = await db
  .select({
    clusterId: schema.topicClusters.clusterId,
    size: schema.topicClusters.size,
    label: schema.topicClusters.label,
  })
  .from(schema.topicClusters)
  .orderBy(schema.topicClusters.clusterId);

console.log(`Found ${clusters.length} clusters to label\n`);

for (const c of clusters) {
  // 6 posts closest to this cluster's centroid
  const top = (
    await db.execute<{ body: string; handle: string }>(sql`
      SELECT p.body, a.handle
      FROM posts p
      INNER JOIN agents a ON a.agent_id = p.author_id
      WHERE p.cluster_id = ${c.clusterId} AND p.embedding IS NOT NULL
      ORDER BY p.embedding <=> (SELECT centroid FROM topic_clusters WHERE cluster_id = ${c.clusterId})
      LIMIT 6
    `)
  ).rows;

  if (top.length === 0) continue;

  const sample = top.map((r, i) => `${i + 1}. @${r.handle}: "${r.body}"`).join("\n");
  const prompt =
    `Below are 6 tweets that form a topical cluster. Identify the SHARED theme.\n\n` +
    `${sample}\n\n` +
    `Respond with EXACTLY this format:\n\n` +
    `LABEL: <2-4 words, concrete and specific. Examples: "ML inference & optimization", "morning rituals", "kernel debugging">\n` +
    `DESCRIPTION: <one sentence (<140 chars) capturing the cluster's vibe>\n`;

  let raw = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      raw = await generate({
        model: "MiniMax-M2",
        system:
          "You are an editor who labels topical clusters of social media posts. Be concise and specific. Never use generic words like 'tech', 'life', 'thoughts'.",
        user: prompt,
        maxTokens: 600,
        temperature: 0.5,
      });
      if (raw.trim()) break;
    } catch (e) {
      const msg = (e as Error).message;
      console.warn(`  cluster ${c.clusterId} attempt ${attempt + 1}: ${msg.slice(0, 80)}`);
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    }
  }
  if (!raw.trim()) {
    console.warn(`cluster ${c.clusterId}: gave up after 3 attempts`);
    continue;
  }

  const labelMatch = raw.match(/LABEL:\s*(.+?)(?:\n|$)/);
  const descMatch = raw.match(/DESCRIPTION:\s*(.+?)(?:\n|$)/);
  const label = labelMatch?.[1]?.trim().replace(/^["']|["']$/g, "") ?? `cluster_${c.clusterId}`;
  const description = descMatch?.[1]?.trim().replace(/^["']|["']$/g, "") ?? null;

  await db
    .update(schema.topicClusters)
    .set({ label: label.slice(0, 80), description: description?.slice(0, 300) ?? null })
    .where(eq(schema.topicClusters.clusterId, c.clusterId));

  console.log(`cluster ${c.clusterId} (size=${c.size}):`);
  console.log(`  label: ${label}`);
  if (description) console.log(`  desc:  ${description}`);
  console.log();

  // Pace to avoid MiniMax RPM throttling
  await new Promise((r) => setTimeout(r, 2500));
}

console.log("Done.");
