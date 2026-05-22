// Stability diagnostic report.
//
// Reads the impressions table (already populated by past simulator runs + UI hits)
// and reports the three Mariano-Frasca-style metrics per variant:
//
//   1. Cluster entropy   — how diverse is each viewer's recent feed, by topic?
//                          Low = polarization → filter bubble
//   2. Exposure Gini     — concentration of impressions per post / per author
//                          High = a few items eat all the exposure
//   3. Feed Jaccard      — overlap between baseline and neural feeds for the
//                          same viewer. Low = neural has diverged a lot.
//
//   npx tsx scripts/stability-report.ts [--window=7]

import { desc, eq, sql } from "drizzle-orm";
import { db, schema } from "../lib/db";
import {
  bar,
  clusterEntropy,
  giniCoefficient,
  jaccardSimilarity,
  trendSlope,
} from "../lib/stability-metrics";

const WINDOW_DAYS = Number(process.argv.find((a) => a.startsWith("--window="))?.split("=")[1] ?? 30);

function variantBase(v: string): string {
  // Sim variants come as "sim:baseline" or "sim:neural"; normalize.
  return v.replace(/^sim:/, "");
}

async function main() {
  console.log("== Stability diagnostic ==");
  console.log(`window: last ${WINDOW_DAYS} days\n`);

  // 1. Load all impressions in the window, joined with post.cluster_id
  const impressions = (
    await db.execute<{
      viewer_agent_id: string;
      post_id: string;
      author_id: string;
      cluster_id: number | null;
      feed_variant: string;
      engagement_kind: string | null;
      shown_at: Date;
    }>(sql`
      SELECT
        i.viewer_agent_id, i.post_id, p.author_id, p.cluster_id,
        i.feed_variant, i.engagement_kind, i.shown_at
      FROM impressions i
      INNER JOIN posts p ON p.post_id = i.post_id
      WHERE i.shown_at > NOW() - INTERVAL '${sql.raw(String(WINDOW_DAYS))} days'
    `)
  ).rows;

  console.log(`impressions in window: ${impressions.length}`);
  if (impressions.length === 0) {
    console.log("(nothing to analyze — run `npm run sim:run` first)");
    return;
  }

  // Group by variant
  const byVariant = new Map<string, typeof impressions>();
  for (const r of impressions) {
    const v = variantBase(r.feed_variant);
    if (!byVariant.has(v)) byVariant.set(v, []);
    byVariant.get(v)!.push(r);
  }

  const variantStats = new Map<string, {
    impressions: number;
    engaged: number;
    posts: number;
    authors: number;
    avgClusterEntropy: number;
    postGini: number;
    authorGini: number;
    clusterDistribution: Map<number | null, number>;
  }>();

  for (const [variant, rows] of byVariant) {
    // Per-viewer cluster entropy
    const perViewerClusters = new Map<string, Array<number | null>>();
    const perPost = new Map<string, number>();
    const perAuthor = new Map<string, number>();
    const clusterDist = new Map<number | null, number>();
    let engaged = 0;

    for (const r of rows) {
      const k = r.viewer_agent_id;
      if (!perViewerClusters.has(k)) perViewerClusters.set(k, []);
      perViewerClusters.get(k)!.push(r.cluster_id);
      perPost.set(r.post_id, (perPost.get(r.post_id) ?? 0) + 1);
      perAuthor.set(r.author_id, (perAuthor.get(r.author_id) ?? 0) + 1);
      clusterDist.set(r.cluster_id, (clusterDist.get(r.cluster_id) ?? 0) + 1);
      if (r.engagement_kind && ["like", "reply", "share"].includes(r.engagement_kind)) {
        engaged++;
      }
    }

    const entropies = Array.from(perViewerClusters.values()).map((cs) => clusterEntropy(cs));
    const avgEntropy = entropies.reduce((s, v) => s + v, 0) / Math.max(1, entropies.length);

    variantStats.set(variant, {
      impressions: rows.length,
      engaged,
      posts: perPost.size,
      authors: perAuthor.size,
      avgClusterEntropy: avgEntropy,
      postGini: giniCoefficient(Array.from(perPost.values())),
      authorGini: giniCoefficient(Array.from(perAuthor.values())),
      clusterDistribution: clusterDist,
    });
  }

  // 2. Print summary table per variant
  console.log("\n┌─────────────────────────────────────────────────────────────────────────────┐");
  console.log("│  VARIANT       impressions    engagement   diversity   post Gini   author Gini │");
  console.log("├─────────────────────────────────────────────────────────────────────────────┤");
  for (const [v, s] of [...variantStats.entries()].sort()) {
    const engRate = (s.engaged / Math.max(1, s.impressions)) * 100;
    console.log(
      `│  ${v.padEnd(13)} ${String(s.impressions).padStart(11)}  ${engRate.toFixed(1).padStart(8)}%   ` +
      `${bar(s.avgClusterEntropy)} ${(s.avgClusterEntropy * 100).toFixed(0).padStart(3)}%   ` +
      `${(s.postGini).toFixed(3)}      ${(s.authorGini).toFixed(3)}    │`
    );
  }
  console.log("└─────────────────────────────────────────────────────────────────────────────┘");
  console.log(`  diversity = mean normalized cluster entropy (1.0 = uniform across 12 clusters)`);

  // 3. Per-viewer cluster overlap between variants
  console.log("\n── Feed overlap (Jaccard) between baseline and neural for the same viewer ──");
  const variants = [...byVariant.keys()].filter((v) => v === "baseline" || v === "neural");
  if (variants.includes("baseline") && variants.includes("neural")) {
    const blByViewer = new Map<string, Set<string>>();
    const nuByViewer = new Map<string, Set<string>>();
    for (const r of byVariant.get("baseline")!) {
      if (!blByViewer.has(r.viewer_agent_id)) blByViewer.set(r.viewer_agent_id, new Set());
      blByViewer.get(r.viewer_agent_id)!.add(r.post_id);
    }
    for (const r of byVariant.get("neural")!) {
      if (!nuByViewer.has(r.viewer_agent_id)) nuByViewer.set(r.viewer_agent_id, new Set());
      nuByViewer.get(r.viewer_agent_id)!.add(r.post_id);
    }
    const overlap: number[] = [];
    for (const [v, blSet] of blByViewer) {
      const nuSet = nuByViewer.get(v);
      if (!nuSet) continue;
      overlap.push(jaccardSimilarity(blSet, nuSet));
    }
    if (overlap.length > 0) {
      const mean = overlap.reduce((s, v) => s + v, 0) / overlap.length;
      console.log(`  viewers compared: ${overlap.length}`);
      console.log(`  mean Jaccard:     ${mean.toFixed(3)}  ${bar(mean)}`);
      console.log(
        `  interpretation:   ${mean < 0.15 ? "neural has DIVERGED FAR from baseline (warning)" :
          mean < 0.4 ? "neural diverges meaningfully" : "neural is similar to baseline (model may be weak)"}`
      );
    } else {
      console.log(`  (no viewers seen in both variants — sim assigns variant per round)`);
    }
  } else {
    console.log(`  (need both baseline AND neural variants present)`);
  }

  // 4. Per-round trend (if simulator logged enough data)
  console.log("\n── Trend: cluster entropy per round (lower → polarization over time) ──");
  const ROUND_BUCKET_MS = 60 * 1000; // group impressions into ~minute buckets as a proxy for rounds
  for (const [variant, rows] of byVariant) {
    const sorted = [...rows].sort((a, b) => new Date(a.shown_at).getTime() - new Date(b.shown_at).getTime());
    if (sorted.length < 50) continue;

    // Split into chronological buckets of equal count (10 buckets)
    const buckets: Array<Array<number | null>> = [];
    const bucketSize = Math.max(50, Math.ceil(sorted.length / 10));
    for (let i = 0; i < sorted.length; i += bucketSize) {
      buckets.push(sorted.slice(i, i + bucketSize).map((r) => r.cluster_id));
    }
    const entropies = buckets.map((cs) => clusterEntropy(cs));
    const slope = trendSlope(entropies);

    console.log(`  ${variant.padEnd(13)} ${entropies.map((e) => e.toFixed(2)).join(" → ")}`);
    console.log(
      `  ${" ".repeat(13)} slope: ${slope >= 0 ? "+" : ""}${slope.toFixed(3)}  ${
        slope < -0.02 ? "⚠️  decreasing diversity (polarization signal)" :
        slope > 0.02 ? "diversity increasing" : "stable"
      }`
    );
  }

  // 5. Cluster distribution per variant
  console.log("\n── Where impressions land, by topic cluster ──");
  const clusterLabels = (
    await db.select({ id: schema.topicClusters.clusterId, label: schema.topicClusters.label }).from(schema.topicClusters)
  );
  const labelMap = new Map(clusterLabels.map((r) => [r.id, r.label]));

  for (const [variant, s] of variantStats) {
    console.log(`\n  ${variant}:`);
    const entries = [...s.clusterDistribution.entries()]
      .filter(([k]) => k != null)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);
    const total = entries.reduce((sum, [, c]) => sum + c, 0);
    for (const [cid, c] of entries) {
      const pct = (c / total) * 100;
      const name = labelMap.get(cid!) ?? `cluster_${cid}`;
      console.log(`    ${bar(pct, 50, 12)} ${pct.toFixed(1).padStart(5)}%  ${name}`);
    }
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error("FAIL:", err);
  process.exit(1);
});
