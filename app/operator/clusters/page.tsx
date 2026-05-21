import Link from "next/link";
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { desc, eq, sql } from "drizzle-orm";
import { db, schema } from "../../../lib/db";
import { adaptAgent } from "../../../lib/adapt";

export const dynamic = "force-dynamic";

// Stable palette for clusters (12 hues spread around the wheel)
function clusterHue(id: number): number {
  return (id * 30) % 360;
}

export default async function ClustersPage() {
  const user = await currentUser();
  if (!user) redirect("/sign-in");

  // Load clusters
  const clusters = await db
    .select()
    .from(schema.topicClusters)
    .orderBy(desc(schema.topicClusters.size));

  // For each cluster, fetch 3 representative posts (closest to centroid)
  type Sample = { postId: string; body: string; handle: string };
  const samplesByCluster = new Map<number, Sample[]>();
  for (const c of clusters) {
    const rows = (
      await db.execute<{ post_id: string; body: string; handle: string }>(sql`
        SELECT p.post_id, p.body, a.handle
        FROM posts p
        INNER JOIN agents a ON a.agent_id = p.author_id
        WHERE p.cluster_id = ${c.clusterId} AND p.embedding IS NOT NULL
        ORDER BY p.embedding <=> (SELECT centroid FROM topic_clusters WHERE cluster_id = ${c.clusterId})
        LIMIT 3
      `)
    ).rows;
    samplesByCluster.set(
      c.clusterId,
      rows.map((r) => ({ postId: r.post_id, body: r.body, handle: r.handle }))
    );
  }

  const totalClustered = clusters.reduce((s, c) => s + c.size, 0);

  return (
    <>
      <header
        style={{
          padding: "20px 32px 16px",
          borderBottom: "1px solid var(--tb-hairline)",
          background: "var(--tb-bg)",
        }}
      >
        <span className="tb-mono" style={{ fontSize: 11, letterSpacing: "0.1em", color: "var(--tb-faint)" }}>
          TOPIC CLUSTERS
        </span>
        <h1 className="tb-h1" style={{ margin: "2px 0 4px" }}>
          Network themes
        </h1>
        <div style={{ fontSize: 14, color: "var(--tb-muted)" }}>
          {clusters.length} clusters covering {totalClustered} posts · KMeans on 1536-d text embeddings · labels by MiniMax-M2
        </div>
      </header>

      <div style={{ padding: "20px 32px 60px", overflow: "auto" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))",
            gap: 16,
          }}
        >
          {clusters.map((c) => {
            const hue = clusterHue(c.clusterId);
            const samples = samplesByCluster.get(c.clusterId) ?? [];
            return (
              <section
                key={c.clusterId}
                className="tb-card"
                style={{
                  background: "var(--tb-surface)",
                  borderTop: `3px solid oklch(0.65 0.18 ${hue})`,
                  overflow: "hidden",
                }}
              >
                <div style={{ padding: "14px 18px 12px" }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      justifyContent: "space-between",
                      marginBottom: 4,
                    }}
                  >
                    <h2 className="tb-h3" style={{ margin: 0 }}>
                      {c.label}
                    </h2>
                    <span
                      style={{
                        fontSize: 12,
                        color: "var(--tb-muted)",
                        fontFamily: "var(--tb-mono)",
                      }}
                    >
                      {c.size} posts
                    </span>
                  </div>
                  {c.description && (
                    <p style={{ margin: "6px 0 0", fontSize: 13.5, color: "var(--tb-ink-2)", lineHeight: 1.4 }}>
                      {c.description}
                    </p>
                  )}
                </div>
                <div style={{ borderTop: "1px solid var(--tb-hairline)" }}>
                  {samples.map((s) => (
                    <Link
                      key={s.postId}
                      href={`/post/${s.postId}`}
                      style={{
                        display: "block",
                        padding: "10px 18px",
                        borderBottom: "1px solid var(--tb-hairline)",
                        textDecoration: "none",
                        color: "inherit",
                      }}
                    >
                      <div className="tb-mono" style={{ fontSize: 11, color: "var(--tb-muted)" }}>
                        @{s.handle}
                      </div>
                      <p
                        style={{
                          margin: "2px 0 0",
                          fontSize: 13.5,
                          lineHeight: 1.45,
                          color: "var(--tb-ink-2)",
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden",
                        }}
                      >
                        {s.body}
                      </p>
                    </Link>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </>
  );
}
