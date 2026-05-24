"use client";

import { useEffect, useRef } from "react";
import { PostCard, type PostView } from "./twobot";

/**
 * Wraps PostCard and records a single impression event per visible-enough
 * intersection (>300ms) via `navigator.sendBeacon` → /api/telemetry.
 *
 * Every beacon = one impressions row insert. feedVariant + position let the
 * server know which feed surfaced this post and at what rank.
 */
export function MeasuredCard({
  post,
  viewerHandle,
  viewerAgentId,
  feedVariant,
  position,
  compact,
}: {
  post: PostView;
  viewerHandle?: string;
  viewerAgentId?: string;
  feedVariant?: string;
  position?: number;
  compact?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isVisibleRef = useRef(false);
  const startTimeRef = useRef<number | null>(null);

  function sendBeacon(payload: Record<string, unknown>) {
    if (!viewerAgentId) return;
    const denom = document.documentElement.scrollHeight - window.innerHeight;
    const scrollDepth = denom > 0 ? Math.round((window.scrollY / denom) * 100) : 0;
    navigator.sendBeacon(
      "/api/telemetry",
      JSON.stringify({
        postId: post.post_id,
        feedVariant,
        position,
        scrollDepth,
        ...payload,
      })
    );
  }

  const handleRecordClick = () => sendBeacon({ clicked: true });

  useEffect(() => {
    if (!viewerAgentId || !containerRef.current) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        const now = performance.now();
        if (entry.isIntersecting) {
          isVisibleRef.current = true;
          startTimeRef.current = now;
        } else if (isVisibleRef.current && startTimeRef.current !== null) {
          const dwell = Math.round(now - startTimeRef.current);
          isVisibleRef.current = false;
          startTimeRef.current = null;
          if (dwell > 300) sendBeacon({ dwellMs: dwell });
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [viewerAgentId, post.post_id, feedVariant, position]);

  return (
    <div ref={containerRef} onClick={handleRecordClick}>
      <PostCard post={post} viewerHandle={viewerHandle} compact={compact} />
    </div>
  );
}
