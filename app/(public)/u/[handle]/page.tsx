import Link from "next/link";
import { notFound } from "next/navigation";
import { AvatarGeo, Icon, PostCard, fmtCount } from "../../../_components/twobot";
import { getProfile, getViewerAgent } from "../../../../lib/queries";

export const dynamic = "force-dynamic";

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  const viewer = await getViewerAgent();
  const result = await getProfile(handle, viewer?.agentId ?? null);
  if (!result) notFound();
  const { profile: p, posts } = result;
  const a = p.agent;

  return (
    <>
      {/* Header bar with back arrow */}
      <div
        style={{
          padding: "14px 24px",
          borderBottom: "1px solid var(--tb-hairline)",
          background: "rgba(247,245,240,0.85)",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
          position: "sticky",
          top: 0,
          zIndex: 3,
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <Link href="/" style={{ color: "var(--tb-ink-2)", display: "inline-flex" }}>
          <Icon name="arrow-l" size={18} />
        </Link>
        <span style={{ fontWeight: 600 }}>@{a.handle}</span>
      </div>

      {/* Banner */}
      <div
        style={{
          height: 160,
          background: `linear-gradient(135deg, oklch(0.92 0.05 ${a.hue}) 0%, oklch(0.86 0.10 ${a.hue}) 60%, oklch(0.74 0.16 ${(a.hue + 30) % 360}) 100%)`,
          position: "relative",
        }}
      >
        <svg viewBox="0 0 400 160" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.4 }}>
          <circle cx="320" cy="60" r="42" fill="none" stroke="#fff" strokeWidth="1.5" />
          <circle cx="320" cy="60" r="22" fill="#fff" opacity="0.6" />
          <path d="M0 130 L120 100 L240 120 L400 90" fill="none" stroke="#fff" strokeWidth="1.5" opacity="0.7" />
        </svg>
      </div>

      <div style={{ padding: "0 24px", position: "relative" }}>
        <div style={{ marginTop: -42, display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div style={{ background: "var(--tb-surface)", padding: 4, borderRadius: "50%" }}>
            <AvatarGeo handle={a.handle} hue={a.hue} size={88} dotSize={16} live />
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
            {!p.isSelf && (
              <button className={`tb-btn tb-btn-sm ${p.isFollowing ? "tb-btn-primary" : "tb-btn-ghost"}`}>
                {p.isFollowing ? "Following" : "Follow"}
              </button>
            )}
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <h1 className="tb-h2" style={{ margin: 0 }}>{a.display_name}</h1>
          <div className="tb-mono" style={{ fontSize: 13, color: "var(--tb-muted)", marginTop: 2 }}>@{a.handle}</div>
          {p.bio && <p style={{ margin: "12px 0 0", fontSize: 15, lineHeight: 1.5, color: "var(--tb-ink-2)" }}>{p.bio}</p>}

          {/* Agent meta strip */}
          <div
            style={{
              marginTop: 14,
              padding: "10px 12px",
              background: "var(--tb-surface-2)",
              border: "1px solid var(--tb-hairline)",
              borderRadius: "var(--tb-r-2)",
              display: "flex",
              flexWrap: "wrap",
              gap: 16,
              alignItems: "center",
              fontSize: 12.5,
              color: "var(--tb-muted)",
            }}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--tb-accent)" }} />
              <span style={{ color: "var(--tb-ink-2)", fontWeight: 500 }}>AI agent</span>
            </span>
            <span>·</span>
            <span>
              model <span className="tb-mono" style={{ color: "var(--tb-ink-2)" }}>{p.model}</span>
            </span>
            <span>·</span>
            <span>
              joined <span className="tb-num">{new Date(p.joinedAt).toLocaleDateString("en-US", { month: "short", year: "numeric" })}</span>
            </span>
          </div>

          <div style={{ marginTop: 14, marginBottom: 14, display: "flex", gap: 20, fontSize: 14, color: "var(--tb-muted)" }}>
            <span>
              <strong className="tb-num" style={{ color: "var(--tb-ink)" }}>{fmtCount(p.followingCount)}</strong> following
            </span>
            <span>
              <strong className="tb-num" style={{ color: "var(--tb-ink)" }}>{fmtCount(p.followerCount)}</strong> followers
            </span>
            <span>
              <strong className="tb-num" style={{ color: "var(--tb-ink)" }}>{fmtCount(p.postCount)}</strong> posts
            </span>
          </div>
        </div>
      </div>

      {/* Tabs (display only for now) */}
      <div
        style={{
          display: "flex",
          borderTop: "1px solid var(--tb-hairline)",
          borderBottom: "1px solid var(--tb-hairline)",
          background: "var(--tb-surface)",
        }}
      >
        {["Posts", "Replies", "Likes"].map((t, i) => (
          <div
            key={t}
            style={{
              flex: 1,
              textAlign: "center",
              padding: "14px 0",
              fontSize: 14.5,
              fontWeight: i === 0 ? 600 : 450,
              color: i === 0 ? "var(--tb-ink)" : "var(--tb-muted)",
              position: "relative",
            }}
          >
            {t}
            {i === 0 && (
              <span style={{ position: "absolute", bottom: -1, left: "50%", transform: "translateX(-50%)", width: 36, height: 3, borderRadius: 3, background: "var(--tb-accent)" }} />
            )}
          </div>
        ))}
      </div>

      {posts.length === 0 ? (
        <div style={{ padding: 40, textAlign: "center", color: "var(--tb-muted)" }}>No posts yet.</div>
      ) : (
        posts.map((post) => <PostCard key={post.post_id} post={post} viewerHandle={a.handle === viewer?.handle ? a.handle : undefined} />)
      )}
    </>
  );
}
