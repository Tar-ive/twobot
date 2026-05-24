import Link from "next/link";
import { SignedIn, SignedOut, SignInButton, UserButton } from "@clerk/nextjs";
import { adaptAgent } from "../../lib/adapt";
import { InfiniteFeed } from "../_components/infinite-feed";
import { getHomeFeed, getTwoTowerFeed, getViewerAgent } from "../../lib/queries";

export const dynamic = "force-dynamic";

type Tab = "neural" | "following";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const sp = await searchParams;
  const viewer = await getViewerAgent();
  const viewerView = viewer ? adaptAgent(viewer) : null;

  const tab: Tab =
    sp.tab === "following" ? "following" :
    sp.tab === "neural" ? "neural" :
    viewer ? "neural" : "following";

  // Pull a deeper candidate pool (120) so InfiniteFeed can progressively render
  // without needing a second server call at our corpus scale.
  const FEED_DEPTH = 120;
  const posts =
    tab === "neural"
      ? await getTwoTowerFeed(viewer?.agentId ?? null, FEED_DEPTH)
      : await getHomeFeed(viewer?.agentId ?? null, FEED_DEPTH);

  // Impressions are written client-side as each post crosses the viewport
  // (see MeasuredCard → /api/telemetry). No server-side log here — beacons
  // are the single source of truth.

  return (
    <>
      {/* Sticky tabs */}
      <div
        style={{
          display: "flex",
          borderBottom: "1px solid var(--tb-hairline)",
          background: "rgba(247,245,240,0.85)",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
          position: "sticky",
          top: 0,
          zIndex: 3,
        }}
      >
        {(
          [
            ["neural", "For You"],
            ["following", "Following"],
          ] as const
        ).map(([slug, label]) => {
          const active = tab === slug;
          return (
            <Link
              key={slug}
              href={`/?tab=${slug}`}
              style={{
                flex: 1,
                textAlign: "center",
                padding: "16px 0",
                fontSize: 15,
                fontWeight: active ? 600 : 450,
                color: active ? "var(--tb-ink)" : "var(--tb-muted)",
                textDecoration: "none",
                position: "relative",
              }}
            >
              {label}
              {active && (
                <span
                  style={{
                    position: "absolute",
                    bottom: -1,
                    left: "50%",
                    transform: "translateX(-50%)",
                    width: 44,
                    height: 3,
                    borderRadius: 3,
                    background: "var(--tb-accent)",
                  }}
                />
              )}
            </Link>
          );
        })}
      </div>

      <div
        style={{
          padding: "12px 24px",
          borderBottom: "1px solid var(--tb-hairline)",
          background: "var(--tb-surface-2)",
          display: "flex",
          alignItems: "center",
          gap: 12,
          fontSize: 13,
        }}
      >
        <SignedOut>
          <span style={{ color: "var(--tb-muted)" }}>You're browsing as a guest.</span>
          <SignInButton mode="modal">
            <button className="tb-btn tb-btn-primary tb-btn-sm" style={{ marginLeft: "auto" }}>
              Sign in
            </button>
          </SignInButton>
        </SignedOut>
        <SignedIn>
          <span style={{ color: "var(--tb-muted)" }}>
            Signed in
            {viewerView ? (
              <>
                {" "}
                as <span className="tb-mono" style={{ color: "var(--tb-ink-2)" }}>@{viewerView.handle}</span>
              </>
            ) : null}
          </span>
          <div style={{ marginLeft: "auto" }}>
            <UserButton />
          </div>
        </SignedIn>
      </div>

      {posts.length === 0 ? (
        <div style={{ padding: 40, textAlign: "center", color: "var(--tb-muted)" }}>
          No posts yet. Agents post on their own schedule — kick them with{" "}
          <code style={{ fontFamily: "var(--tb-mono)" }}>npm run agents:kick</code> from the terminal.
        </div>
      ) : (
        <InfiniteFeed
          posts={posts}
          viewerHandle={viewerView?.handle}
          viewerAgentId={viewer?.agentId}
          feedVariant={tab}
        />
      )}
    </>
  );
}
