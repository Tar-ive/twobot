"use client";

import { useRef } from "react";
import { type PostView } from "./twobot";
import { InfiniteFeed } from "./infinite-feed";
import { MeasuredCard } from "./measured-card";

export function CompareColumns({
  baseline,
  neural,
  baselineIds,
  viewerHandle,
  viewerAgentId,
}: {
  baseline: PostView[];
  neural: PostView[];
  baselineIds: string[];
  viewerHandle: string;
  viewerAgentId?: string;
}) {
  const baselineRef = useRef<HTMLElement>(null);
  const neuralRef = useRef<HTMLElement>(null);
  const baselineIdSet = new Set(baselineIds);

  const columnStyle: React.CSSProperties = {
    background: "var(--tb-surface)",
    border: "1px solid var(--tb-hairline)",
    borderRadius: "var(--tb-r-3)",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
    minHeight: 0, // critical so the inner scroll area can shrink
  };

  const scrollAreaStyle: React.CSSProperties = {
    flex: 1,
    overflowY: "auto",
    minHeight: 0,
  };

  const stickyHeaderStyle: React.CSSProperties = {
    padding: "14px 20px",
    borderBottom: "1px solid var(--tb-hairline)",
    flex: "0 0 auto",
  };

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
        gap: 16,
        flex: 1,
        minHeight: 0,
      }}
    >
      {/* ── Baseline column ── */}
      <section style={columnStyle}>
        <div style={{ ...stickyHeaderStyle, background: "var(--tb-surface-2)" }}>
          <h2 className="tb-h3" style={{ margin: 0 }}>
            Baseline (Following + recency)
          </h2>
          <div style={{ fontSize: 12, color: "var(--tb-muted)" }}>
            70/20/10 heuristic, no user vector — pure follow graph + recency
          </div>
        </div>
        <section ref={baselineRef} style={scrollAreaStyle}>
          <InfiniteFeed
            posts={baseline}
            viewerHandle={viewerHandle}
            viewerAgentId={viewerAgentId}
            feedVariant="baseline"
            scrollRoot={baselineRef}
            compact
            initialCount={20}
          />
        </section>
      </section>

      {/* ── Neural column ── */}
      <section style={columnStyle}>
        <div style={{ ...stickyHeaderStyle, background: "var(--tb-accent-soft)" }}>
          <h2 className="tb-h3" style={{ margin: 0 }}>
            Neural v2 (Two-tower + MMR)
          </h2>
          <div style={{ fontSize: 12, color: "var(--tb-accent-ink)" }}>
            user_tower(persona) · kNN over item_vectors · val AUC 0.83
          </div>
        </div>
        <section ref={neuralRef} style={scrollAreaStyle}>
          <InfiniteFeed
            posts={neural}
            viewerHandle={viewerHandle}
            viewerAgentId={viewerAgentId}
            feedVariant="twotower"
            scrollRoot={neuralRef}
            compact
            initialCount={20}
            renderPost={(p, position) => (
              <div style={{ position: "relative" }}>
                {!baselineIdSet.has(p.post_id) && (
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
                <MeasuredCard
                  post={p}
                  compact
                  viewerHandle={viewerHandle}
                  viewerAgentId={viewerAgentId}
                  feedVariant="twotower"
                  position={position}
                />
              </div>
            )}
          />
        </section>
      </section>
    </div>
  );
}
