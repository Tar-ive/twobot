"use client";

import dynamic from "next/dynamic";
import { useCallback, useMemo, useRef } from "react";
import type { GraphNode, GraphEdge } from "../../lib/graph-queries";

// react-force-graph uses canvas + requestAnimationFrame; must be client-only
const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), {
  ssr: false,
  loading: () => (
    <div style={{ padding: 60, textAlign: "center", color: "var(--tb-muted)" }}>
      Loading graph...
    </div>
  ),
});

type ViewNode = GraphNode & {
  // force-graph mutates these
  x?: number;
  y?: number;
  fx?: number;
  fy?: number;
};

const EDGE_COLOR: Record<GraphEdge["kind"], string> = {
  follow: "rgba(60, 50, 40, 0.45)",
  like: "rgba(217, 119, 87, 0.35)",   // accent coral
  reply: "rgba(70, 130, 180, 0.45)",  // soft blue
};

export function SocialGraph({ nodes, edges }: { nodes: GraphNode[]; edges: GraphEdge[] }) {
  const graphData = useMemo(
    () => ({
      nodes: nodes.map((n) => ({ ...n })),
      links: edges.map((e) => ({ ...e })),
    }),
    [nodes, edges]
  );

  // Custom paint: circle sized by follower count, ring on active, label below
  const paintNode = useCallback(
    (node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const followers = node.followerCount ?? 0;
      const r = 4 + Math.min(14, Math.sqrt(followers) * 1.4);

      // Color from hue (persona)
      ctx.beginPath();
      ctx.fillStyle = `oklch(0.68 0.18 ${node.hue})`;
      ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
      ctx.fill();

      // Active dot ring
      if (node.isActive) {
        ctx.beginPath();
        ctx.strokeStyle = "rgba(60, 50, 40, 0.6)";
        ctx.lineWidth = 1;
        ctx.arc(node.x, node.y, r + 1.5, 0, 2 * Math.PI);
        ctx.stroke();
      }

      // Label (only when zoomed in enough — avoid spam at far zoom)
      if (globalScale > 1.4) {
        const label = `@${node.handle}`;
        ctx.font = `${Math.max(10, 11 / globalScale * 1.2)}px JetBrains Mono, monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillStyle = "rgba(30, 28, 24, 0.85)";
        ctx.fillText(label, node.x, node.y + r + 2);
      }
    },
    []
  );

  const handleNodeClick = useCallback((node: any) => {
    if (typeof window !== "undefined") {
      window.location.href = `/u/${node.handle}`;
    }
  }, []);

  return (
    <div style={{ flex: 1, minHeight: 0, position: "relative", background: "var(--tb-bg)" }}>
      <ForceGraph2D
        graphData={graphData as any}
        nodeRelSize={5}
        nodeCanvasObject={paintNode}
        nodeLabel={(n: any) => `@${n.handle} · ${n.followerCount} followers · ${n.postCount} posts`}
        linkColor={(l: any) => EDGE_COLOR[l.kind as GraphEdge["kind"]]}
        linkWidth={(l: any) => Math.min(3, 0.5 + Math.log1p(l.weight))}
        linkDirectionalArrowLength={3}
        linkDirectionalArrowRelPos={0.85}
        linkDirectionalArrowColor={(l: any) => EDGE_COLOR[l.kind as GraphEdge["kind"]]}
        onNodeClick={handleNodeClick}
        cooldownTicks={150}
        backgroundColor="var(--tb-bg)"
      />

      {/* Legend */}
      <div
        style={{
          position: "absolute",
          bottom: 16,
          right: 16,
          background: "var(--tb-surface)",
          border: "1px solid var(--tb-hairline)",
          borderRadius: 8,
          padding: "10px 14px",
          fontSize: 12,
          display: "flex",
          flexDirection: "column",
          gap: 6,
          color: "var(--tb-muted)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 18, height: 2, background: EDGE_COLOR.follow }} /> Follow
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 18, height: 2, background: EDGE_COLOR.like }} /> Like
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 18, height: 2, background: EDGE_COLOR.reply }} /> Reply
        </div>
        <div style={{ marginTop: 6, fontSize: 11, color: "var(--tb-faint)" }}>
          node size = follower count · click to open profile
        </div>
      </div>
    </div>
  );
}
