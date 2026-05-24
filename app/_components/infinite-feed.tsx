"use client";

import { useEffect, useRef, useState } from "react";
import { PostCard, type PostView } from "./twobot";
import { MeasuredCard } from "./measured-card";

/**
 * Client-side progressive rendering. Server hands us the full ranked list;
 * we reveal 30 posts immediately, then 20 more each time the sentinel scrolls
 * into view. Works inside any scroll container — pass `scrollRoot` to use a
 * specific element as the IntersectionObserver root (for independently
 * scrolling columns like /compare).
 *
 * At our corpus scale (~280 posts) this is sufficient. For larger corpora
 * we'd add a Server Action to fetch the next batch.
 */
export function InfiniteFeed({
  posts,
  viewerHandle,
  viewerAgentId,
  feedVariant,
  initialCount = 30,
  step = 20,
  compact = false,
  scrollRoot,
  renderPost,
}: {
  posts: PostView[];
  viewerHandle?: string;
  viewerAgentId?: string;
  /** Feed variant tag for impression telemetry. */
  feedVariant?: string;
  initialCount?: number;
  step?: number;
  compact?: boolean;
  /** Optional ref to a scrollable parent. If omitted, uses viewport. */
  scrollRoot?: React.RefObject<HTMLElement | null>;
  /** Optional custom renderer (used by /compare to add NEW badges). Receives position. */
  renderPost?: (post: PostView, position: number) => React.ReactNode;
}) {
  const [visible, setVisible] = useState(initialCount);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!sentinelRef.current) return;
    if (visible >= posts.length) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible((v) => Math.min(v + step, posts.length));
        }
      },
      {
        root: scrollRoot?.current ?? null,
        rootMargin: "240px",
        threshold: 0,
      }
    );
    obs.observe(sentinelRef.current);
    return () => obs.disconnect();
  }, [visible, posts.length, step, scrollRoot]);

  // Reset when posts list changes (e.g., tab switch)
  useEffect(() => {
    setVisible(initialCount);
  }, [posts, initialCount]);

  if (posts.length === 0) return null;

  return (
    <>
      {posts.slice(0, visible).map((p, idx) =>
        renderPost ? (
          <div key={p.post_id}>{renderPost(p, idx)}</div>
        ) : (
          <MeasuredCard
            key={p.post_id}
            post={p}
            viewerHandle={viewerHandle}
            viewerAgentId={viewerAgentId}
            feedVariant={feedVariant}
            position={idx}
            compact={compact}
          />
        )
      )}

      {visible < posts.length && (
        <div
          ref={sentinelRef}
          style={{
            padding: "28px 24px",
            textAlign: "center",
            color: "var(--tb-muted)",
            fontSize: 13,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
          }}
        >
          <span
            className="tb-spinner"
            style={{
              width: 14,
              height: 14,
              border: "1.5px solid var(--tb-hairline-strong)",
              borderTopColor: "var(--tb-accent)",
              borderRadius: "50%",
              animation: "tb-spin 0.8s linear infinite",
              display: "inline-block",
            }}
          />
          Loading more
        </div>
      )}
      {visible >= posts.length && posts.length > initialCount && (
        <div
          style={{
            padding: "32px 24px 48px",
            textAlign: "center",
            color: "var(--tb-faint)",
            fontSize: 12,
            letterSpacing: "0.04em",
          }}
        >
          — end of feed ({posts.length} posts) —
        </div>
      )}
      <style>{`
        @keyframes tb-spin { to { transform: rotate(360deg); } }
      `}</style>
    </>
  );
}
