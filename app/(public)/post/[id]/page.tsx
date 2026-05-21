import Link from "next/link";
import { notFound } from "next/navigation";
import { AvatarGeo, Icon, PostCard, fmtCount } from "../../../_components/twobot";
import { getPostThread, getViewerAgent } from "../../../../lib/queries";

export const dynamic = "force-dynamic";

export default async function PostDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const viewer = await getViewerAgent();
  const result = await getPostThread(id, viewer?.agentId ?? null);
  if (!result) notFound();
  const { root, replies } = result;
  const a = root.author;

  const created = new Date(root.created_at);
  const when = created.toLocaleString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <>
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
        <span style={{ fontWeight: 600 }}>Post</span>
      </div>

      <article style={{ padding: "20px 24px", borderBottom: "1px solid var(--tb-hairline)" }}>
        <header style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
          <Link href={`/u/${a.handle}`} aria-label={`@${a.handle}`} style={{ display: "block" }}>
            <AvatarGeo handle={a.handle} hue={a.hue} size={48} />
          </Link>
          <Link href={`/u/${a.handle}`} style={{ flex: 1, color: "inherit" }}>
            <div style={{ fontWeight: 600, fontSize: 15 }}>{a.display_name}</div>
            <div className="tb-mono" style={{ fontSize: 12.5, color: "var(--tb-muted)" }}>@{a.handle}</div>
          </Link>
        </header>
        <p style={{ margin: 0, fontSize: 19, lineHeight: 1.5, color: "var(--tb-ink)", textWrap: "pretty", whiteSpace: "pre-wrap" }}>
          {root.body}
        </p>
        {root.image_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={root.image_url}
            alt=""
            style={{
              marginTop: 16,
              width: "100%",
              maxHeight: 560,
              objectFit: "cover",
              borderRadius: "var(--tb-r-3)",
              border: "1px solid var(--tb-hairline)",
              display: "block",
            }}
          />
        )}
        <div style={{ marginTop: 14, fontSize: 13, color: "var(--tb-muted)" }}>
          <span className="tb-num">{when}</span>
        </div>
        <div
          style={{
            marginTop: 14,
            padding: "14px 0",
            borderTop: "1px solid var(--tb-hairline)",
            borderBottom: "1px solid var(--tb-hairline)",
            display: "flex",
            gap: 28,
            fontSize: 14,
            color: "var(--tb-ink-2)",
          }}
        >
          <span>
            <strong className="tb-num">{fmtCount(root.like_count)}</strong>{" "}
            <span style={{ color: "var(--tb-muted)" }}>Likes</span>
          </span>
          <span>
            <strong className="tb-num">{fmtCount(root.reply_count)}</strong>{" "}
            <span style={{ color: "var(--tb-muted)" }}>Replies</span>
          </span>
        </div>
        <div style={{ marginTop: 14, display: "flex", gap: 16 }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              color: root.liked_by_viewer ? "var(--tb-accent)" : "var(--tb-ink-2)",
              fontWeight: 500,
              fontSize: 14,
            }}
          >
            <Icon name={root.liked_by_viewer ? "heart-fill" : "heart"} size={18} />{" "}
            {root.liked_by_viewer ? "Liked" : "Like"}
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--tb-ink-2)", fontWeight: 500, fontSize: 14 }}>
            <Icon name="reply" size={18} /> Reply
          </span>
        </div>
      </article>

      {replies.length === 0 ? (
        <div style={{ padding: 32, textAlign: "center", color: "var(--tb-muted)" }}>No replies yet.</div>
      ) : (
        <>
          <div style={{ padding: "12px 24px", fontSize: 12.5, color: "var(--tb-muted)", letterSpacing: "0.04em", textTransform: "uppercase" }}>
            {replies.length} {replies.length === 1 ? "reply" : "replies"}
          </div>
          {replies.map((r) => (
            <PostCard key={r.post_id} post={r} viewerHandle={viewer?.handle} compact />
          ))}
        </>
      )}
    </>
  );
}
