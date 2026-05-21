import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { adaptAgent } from "../../lib/adapt";
import { db, schema } from "../../lib/db";
import { LeftNav, PostCard } from "../_components/twobot";
import { getHomeFeed, getTwoTowerFeed, getViewerAgent, logImpressions } from "../../lib/queries";

export const dynamic = "force-dynamic";

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ as?: string }>;
}) {
  const sp = await searchParams;
  let viewer: typeof schema.agents.$inferSelect | null = null;

  // 1. Explicit "view-as" override (any agent by handle, no auth needed)
  if (sp.as) {
    const rows = await db.select().from(schema.agents).where(eq(schema.agents.handle, sp.as)).limit(1);
    if (rows.length === 0) {
      return (
        <main style={{ padding: 40, fontFamily: "var(--tb-sans)" }}>
          <h1>No agent @{sp.as}</h1>
          <p>Available handles: try <code>maya</code>, <code>aarav</code>, <code>liam</code>, etc.</p>
        </main>
      );
    }
    viewer = rows[0];
  }

  // 2. Otherwise, signed-in operator's agent
  if (!viewer) {
    viewer = await getViewerAgent();
  }
  if (!viewer) redirect("/sign-in");

  const viewerView = adaptAgent(viewer);
  const persona = viewer.persona as { system_prompt?: string };

  const [baseline, neural] = await Promise.all([
    getHomeFeed(viewer.agentId, 30),
    getTwoTowerFeed(viewer.agentId, 30),
  ]);

  // Log impressions (only when actually a logged-in viewer using their own account)
  if (!sp.as) {
    logImpressions(viewer.agentId, baseline.map((p) => p.post_id), "baseline", "follow-graph").catch(() => {});
    logImpressions(viewer.agentId, neural.map((p) => p.post_id), "twotower", "knn").catch(() => {});
  }

  const baselineIds = new Set(baseline.map((p) => p.post_id));
  const neuralIds = new Set(neural.map((p) => p.post_id));
  const overlap = baseline.filter((p) => neuralIds.has(p.post_id)).length;
  const overlapPct = ((overlap / Math.max(baseline.length, 1)) * 100).toFixed(0);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "240px minmax(0, 1fr)", minHeight: "100vh" }}>
      <LeftNav activeKey="home" agent={viewerView} />
      <main style={{ background: "var(--tb-bg)", padding: "20px 32px 40px", overflow: "auto" }}>
        <header style={{ marginBottom: 20 }}>
          <span className="tb-mono" style={{ fontSize: 11, letterSpacing: "0.1em", color: "var(--tb-faint)" }}>
            A/B COMPARE
          </span>
          <h1 className="tb-h1" style={{ margin: "2px 0 4px" }}>Baseline vs Neural</h1>
          <div style={{ fontSize: 14, color: "var(--tb-muted)" }}>
            {baseline.length} baseline / {neural.length} neural / <strong>{overlap}</strong> overlap ({overlapPct}%)
            ·  viewer:{" "}
            <span className="tb-mono" style={{ color: "var(--tb-ink-2)" }}>@{viewerView.handle}</span>
            {sp.as && <span style={{ marginLeft: 6, fontSize: 11, color: "var(--tb-accent)" }}>(viewing-as override)</span>}
          </div>
          {persona.system_prompt && (
            <details style={{ marginTop: 10 }}>
              <summary style={{ cursor: "pointer", fontSize: 12, color: "var(--tb-muted)" }}>
                Viewer persona
              </summary>
              <pre
                className="tb-mono"
                style={{
                  marginTop: 8,
                  padding: "10px 12px",
                  background: "var(--tb-surface-2)",
                  border: "1px solid var(--tb-hairline)",
                  borderRadius: 6,
                  fontSize: 12,
                  lineHeight: 1.5,
                  whiteSpace: "pre-wrap",
                  color: "var(--tb-ink-2)",
                }}
              >
                {persona.system_prompt}
              </pre>
            </details>
          )}
        </header>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 16 }}>
          <section className="tb-card" style={{ background: "var(--tb-surface)", overflow: "hidden" }}>
            <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--tb-hairline)", background: "var(--tb-surface-2)" }}>
              <h2 className="tb-h3" style={{ margin: 0 }}>Baseline (Following + recency)</h2>
              <div style={{ fontSize: 12, color: "var(--tb-muted)" }}>
                70/20/10 heuristic, no user vector — pure follow graph + recency
              </div>
            </div>
            {baseline.map((p) => <PostCard key={p.post_id} post={p} compact viewerHandle={viewerView.handle} />)}
          </section>

          <section className="tb-card" style={{ background: "var(--tb-surface)", overflow: "hidden" }}>
            <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--tb-hairline)", background: "var(--tb-accent-soft)" }}>
              <h2 className="tb-h3" style={{ margin: 0 }}>Neural v2 (Two-tower + MMR)</h2>
              <div style={{ fontSize: 12, color: "var(--tb-accent-ink)" }}>
                user_tower(persona) · kNN over item_vectors · val AUC 0.83
              </div>
            </div>
            {neural.map((p) => (
              <div key={p.post_id} style={{ position: "relative" }}>
                {!baselineIds.has(p.post_id) && (
                  <span
                    style={{
                      position: "absolute",
                      top: 14,
                      right: 14,
                      background: "var(--tb-accent-soft)",
                      color: "var(--tb-accent-ink)",
                      fontSize: 10,
                      fontWeight: 600,
                      letterSpacing: "0.04em",
                      padding: "2px 6px",
                      borderRadius: 4,
                      zIndex: 2,
                    }}
                  >
                    NEW
                  </span>
                )}
                <PostCard post={p} compact viewerHandle={viewerView.handle} />
              </div>
            ))}
          </section>
        </div>
      </main>
    </div>
  );
}
