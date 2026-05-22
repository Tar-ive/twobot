import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { adaptAgent } from "../../lib/adapt";
import { db, schema } from "../../lib/db";
import { LeftNav } from "../_components/twobot";
import { CompareColumns } from "../_components/compare-columns";
import { getHomeFeed, getTwoTowerFeed, getViewerAgent, logImpressions } from "../../lib/queries";

export const dynamic = "force-dynamic";

const FEED_DEPTH = 120;

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
    getHomeFeed(viewer.agentId, FEED_DEPTH),
    getTwoTowerFeed(viewer.agentId, FEED_DEPTH),
  ]);

  if (!sp.as) {
    logImpressions(viewer.agentId, baseline.slice(0, 20).map((p) => p.post_id), "baseline", "follow-graph").catch(() => {});
    logImpressions(viewer.agentId, neural.slice(0, 20).map((p) => p.post_id), "twotower", "knn").catch(() => {});
  }

  const baselineIds = baseline.map((p) => p.post_id);
  const baselineIdSet = new Set(baselineIds);
  const overlap = baseline.filter((p) => baselineIdSet.has(p.post_id) && neural.some((n) => n.post_id === p.post_id)).length;
  const overlapPct = ((overlap / Math.max(baseline.length, 1)) * 100).toFixed(0);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "240px minmax(0, 1fr)", height: "100vh", overflow: "hidden" }}>
      <LeftNav activeKey="home" agent={viewerView} />
      <main
        style={{
          background: "var(--tb-bg)",
          padding: "16px 24px 20px",
          display: "flex",
          flexDirection: "column",
          gap: 14,
          minHeight: 0,
          overflow: "hidden",
        }}
      >
        <header style={{ flex: "0 0 auto" }}>
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
            <details style={{ marginTop: 8 }}>
              <summary style={{ cursor: "pointer", fontSize: 12, color: "var(--tb-muted)" }}>
                Viewer persona
              </summary>
              <pre
                className="tb-mono"
                style={{
                  marginTop: 6,
                  padding: "10px 12px",
                  background: "var(--tb-surface-2)",
                  border: "1px solid var(--tb-hairline)",
                  borderRadius: 6,
                  fontSize: 12,
                  lineHeight: 1.5,
                  whiteSpace: "pre-wrap",
                  color: "var(--tb-ink-2)",
                  maxHeight: 160,
                  overflow: "auto",
                }}
              >
                {persona.system_prompt}
              </pre>
            </details>
          )}
        </header>

        <CompareColumns
          baseline={baseline}
          neural={neural}
          baselineIds={baselineIds}
          viewerHandle={viewerView.handle}
          viewerAgentId={sp.as ? undefined : viewer.agentId}
        />
      </main>
    </div>
  );
}
