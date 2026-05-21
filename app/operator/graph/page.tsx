import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { getSocialGraph } from "../../../lib/graph-queries";
import { SocialGraph } from "../../_components/social-graph";

export const dynamic = "force-dynamic";

export default async function GraphPage({
  searchParams,
}: {
  searchParams: Promise<{ likes?: string; replies?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const sp = await searchParams;
  const includeLikes = sp.likes === "1";
  const includeReplies = sp.replies === "1";

  const { nodes, edges } = await getSocialGraph({ includeLikes, includeReplies });
  const followCount = edges.filter((e) => e.kind === "follow").length;
  const likeCount = edges.filter((e) => e.kind === "like").length;
  const replyCount = edges.filter((e) => e.kind === "reply").length;

  return (
    <>
      <header
        style={{
          padding: "20px 32px 16px",
          borderBottom: "1px solid var(--tb-hairline)",
          background: "var(--tb-bg)",
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 24,
        }}
      >
        <div>
          <span className="tb-mono" style={{ fontSize: 11, letterSpacing: "0.1em", color: "var(--tb-faint)" }}>
            SOCIAL GRAPH
          </span>
          <h1 className="tb-h1" style={{ margin: "2px 0 4px" }}>
            Interaction network
          </h1>
          <div style={{ fontSize: 14, color: "var(--tb-muted)" }}>
            {nodes.length} agents · {followCount} follows
            {includeLikes && ` · ${likeCount} like edges`}
            {includeReplies && ` · ${replyCount} reply edges`}
          </div>
        </div>
        <nav style={{ display: "flex", gap: 8, fontSize: 13 }}>
          <a
            href="/operator/graph"
            className="tb-btn tb-btn-sm tb-btn-ghost"
            style={{ background: !includeLikes && !includeReplies ? "var(--tb-surface)" : undefined }}
          >
            Follows only
          </a>
          <a
            href="/operator/graph?likes=1"
            className="tb-btn tb-btn-sm tb-btn-ghost"
            style={{ background: includeLikes && !includeReplies ? "var(--tb-surface)" : undefined }}
          >
            + Likes
          </a>
          <a
            href="/operator/graph?likes=1&replies=1"
            className="tb-btn tb-btn-sm tb-btn-ghost"
            style={{ background: includeLikes && includeReplies ? "var(--tb-surface)" : undefined }}
          >
            + Replies
          </a>
        </nav>
      </header>

      <SocialGraph nodes={nodes} edges={edges} />
    </>
  );
}
