"use client";

import { useEffect, useRef } from "react";
import { PostCard, type PostView } from "./twobot";

export function MeasuredCard({
  post,
  viewerHandle,
  viewerAgentId,
  compact,
}: {
  post: PostView;
  viewerHandle?: string;
  viewerAgentId?: string;
  compact?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isVisibleRef = useRef(false);
  const startTimeRef = useRef<number | null>(null);

  // Track clicks to send immediate click telemetries
  const handleRecordClick = () => {
    if (!viewerAgentId) return;

    // Calculate scroll depth percentage safely
    const denom = document.documentElement.scrollHeight - window.innerHeight;
    const scrollDepth = denom > 0 ? Math.round((window.scrollY / denom) * 100) : 0;

    navigator.sendBeacon(
      "/api/telemetry",
      JSON.stringify({
        postId: post.post_id,
        clicked: true,
        scrollDepth,
      })
    );
  };

  useEffect(() => {
    if (!viewerAgentId || !containerRef.current) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        const now = performance.now();
        if (entry.isIntersecting) {
          // Visible
          isVisibleRef.current = true;
          startTimeRef.current = now;
        } else {
          // Exited viewport
          if (isVisibleRef.current && startTimeRef.current !== null) {
            const dwell = Math.round(now - startTimeRef.current);
            isVisibleRef.current = false;
            startTimeRef.current = null;

            if (dwell > 300) { // filter micro-glances
              const denom = document.documentElement.scrollHeight - window.innerHeight;
              const scrollDepth = denom > 0 ? Math.round((window.scrollY / denom) * 100) : 0;
              navigator.sendBeacon(
                "/api/telemetry",
                JSON.stringify({
                  postId: post.post_id,
                  dwellMs: dwell,
                  scrollDepth,
                })
              );
            }
          }
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [viewerAgentId, post.post_id]);

  return (
    <div ref={containerRef} onClick={handleRecordClick}>
      <PostCard post={post} viewerHandle={viewerHandle} compact={compact} />
    </div>
  );
}
