// Stage 3: Topic gap detection.
//
// Two modes based on stability signal (Mariano-Frasca-inspired):
//   - ENGAGEMENT GAP mode (default): pick cluster the viewer engages with most
//     but where corpus coverage is thin. Closes gaps.
//   - DIVERSIFICATION mode: when viewer's cluster entropy drops below threshold,
//     pick an under-engaged cluster instead. Forces exploration to avoid the
//     polarization failure mode the paper warns about.

import { desc, eq, sql } from "drizzle-orm";
import { db, schema } from "./db";
import { clusterEntropy } from "./stability-metrics";

const ENTROPY_THRESHOLD = 0.6;
const RECENT_IMPRESSIONS = 50;

export type TopicGap = {
  clusterId: number;
  label: string;
  mode: "engagement" | "diversification";
  rationale: string;
};

export async function detectTopicGap(viewerId: string): Promise<TopicGap | null> {
  // 1. Pull viewer's recent impressions joined with cluster_id
  const recent = (
    await db.execute<{ cluster_id: number | null; engagement_kind: string | null }>(sql`
      SELECT p.cluster_id, i.engagement_kind
      FROM impressions i
      INNER JOIN posts p ON p.post_id = i.post_id
      WHERE i.viewer_agent_id = ${viewerId}
      ORDER BY i.shown_at DESC
      LIMIT ${RECENT_IMPRESSIONS}
    `)
  ).rows;

  // 2. Compute current cluster entropy
  const entropy = clusterEntropy(recent.map((r) => r.cluster_id));

  // 3. Count engagements per cluster (positive only)
  const engagedPerCluster = new Map<number, number>();
  for (const r of recent) {
    if (r.cluster_id == null) continue;
    if (r.engagement_kind && ["like", "reply", "share", "LIKE", "REPLY", "SHARE"].includes(r.engagement_kind)) {
      engagedPerCluster.set(r.cluster_id, (engagedPerCluster.get(r.cluster_id) ?? 0) + 1);
    }
  }

  // 4. Pull corpus size + label per cluster
  const clusters = await db.select().from(schema.topicClusters);
  const corpusSizeByCluster = new Map(clusters.map((c) => [c.clusterId, c.size]));
  const labelByCluster = new Map(clusters.map((c) => [c.clusterId, c.label]));

  if (entropy < ENTROPY_THRESHOLD && entropy > 0) {
    // DIVERSIFICATION mode: pick a cluster the viewer has barely engaged with,
    // sized enough that the model can learn from it.
    const engagedIds = new Set(engagedPerCluster.keys());
    const candidates = clusters.filter((c) => !engagedIds.has(c.clusterId) && c.size >= 5);
    if (candidates.length === 0) return null;
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    return {
      clusterId: pick.clusterId,
      label: pick.label,
      mode: "diversification",
      rationale: `viewer cluster entropy ${entropy.toFixed(2)} < ${ENTROPY_THRESHOLD}; forcing exposure to under-engaged cluster`,
    };
  }

  // ENGAGEMENT GAP mode: cluster with highest (engaged / corpus_size) scarcity.
  let best: { clusterId: number; scarcity: number } | null = null;
  for (const [clusterId, engaged] of engagedPerCluster) {
    const corpusSize = corpusSizeByCluster.get(clusterId) ?? 0;
    if (corpusSize === 0) continue;
    // Want engaged > 1 (real signal), corpus < 50 (thin enough to need more)
    if (engaged < 2) continue;
    const scarcity = engaged / corpusSize;
    if (!best || scarcity > best.scarcity) {
      best = { clusterId, scarcity };
    }
  }

  if (best) {
    return {
      clusterId: best.clusterId,
      label: labelByCluster.get(best.clusterId) ?? `cluster_${best.clusterId}`,
      mode: "engagement",
      rationale: `engaged-but-thin cluster · scarcity ${best.scarcity.toFixed(2)}`,
    };
  }

  // Fallback: pick the viewer's most-engaged cluster regardless of corpus size.
  const fallback = [...engagedPerCluster.entries()].sort((a, b) => b[1] - a[1])[0];
  if (fallback) {
    return {
      clusterId: fallback[0],
      label: labelByCluster.get(fallback[0]) ?? `cluster_${fallback[0]}`,
      mode: "engagement",
      rationale: "fallback: most-engaged cluster, no scarcity signal",
    };
  }

  return null;
}
