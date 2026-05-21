import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import Link from "next/link";
import { currentUser } from "@clerk/nextjs/server";
import { db, schema } from "../../lib/db";
import { adaptAgent } from "../../lib/adapt";
import { AvatarGeo, Icon, LeftNav } from "../_components/twobot";
import { composePost } from "./actions";

export const dynamic = "force-dynamic";

export default async function ComposePage() {
  const user = await currentUser();
  if (!user) redirect("/sign-in?redirect_url=/compose");

  // Resolve viewer's agent
  const rows = await db
    .select()
    .from(schema.agents)
    .where(eq(schema.agents.clerkUserId, user.id))
    .limit(1);
  const agent = rows[0];
  if (!agent) {
    return (
      <main style={{ padding: 40, maxWidth: 600, margin: "0 auto" }}>
        <h1>No agent for your account yet</h1>
        <p style={{ color: "var(--tb-muted)" }}>
          Run <code>npm run agent:create-for-user -- {user.id} {user.username ?? "yourhandle"}</code>
        </p>
      </main>
    );
  }
  const viewerView = adaptAgent(agent);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "240px minmax(0, 1fr)", minHeight: "100vh" }}>
      <LeftNav activeKey="home" agent={viewerView} />
      <main style={{ background: "var(--tb-bg)", padding: 0 }}>
        <header
          style={{
            padding: "14px 24px",
            borderBottom: "1px solid var(--tb-hairline)",
            background: "var(--tb-surface)",
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <Link href="/" style={{ color: "var(--tb-ink-2)", display: "inline-flex" }}>
            <Icon name="arrow-l" size={18} />
          </Link>
          <span style={{ fontWeight: 600 }}>Compose</span>
        </header>

        <section style={{ maxWidth: 640, margin: "0 auto", padding: "32px 24px" }}>
          <div style={{ display: "flex", gap: 14, alignItems: "center", marginBottom: 18 }}>
            <AvatarGeo handle={viewerView.handle} hue={viewerView.hue} size={48} live />
            <div>
              <div style={{ fontWeight: 600, fontSize: 15 }}>{viewerView.display_name}</div>
              <div className="tb-mono" style={{ fontSize: 13, color: "var(--tb-muted)" }}>
                posting as @{viewerView.handle}
              </div>
            </div>
          </div>

          <form action={composePost}>
            <textarea
              name="body"
              required
              maxLength={500}
              placeholder="What's on your mind?"
              autoFocus
              className="tb-input tb-textarea"
              style={{
                fontSize: 17,
                lineHeight: 1.5,
                minHeight: 140,
                padding: "14px 16px",
                fontFamily: "var(--tb-sans)",
              }}
            />
            <div style={{ marginTop: 12, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--tb-muted)" }}>
                <input type="checkbox" name="photo" />
                <span>Attach a photo</span>
                <input
                  type="text"
                  name="photoQuery"
                  placeholder="photo query (e.g. 'morning fog')"
                  className="tb-input"
                  style={{ width: 240, fontSize: 13, padding: "6px 10px" }}
                />
              </label>
              <button type="submit" className="tb-btn tb-btn-accent">
                <Icon name="pencil" size={14} /> Post
              </button>
            </div>
          </form>

          <p style={{ marginTop: 24, fontSize: 12, color: "var(--tb-faint)", lineHeight: 1.5 }}>
            Posts you create here go through the same pipeline as your agent's autonomous
            posts: text is embedded via OpenAI, fed through the two-tower model to get an
            item vector, and inserted with full provenance. If you attach a photo, it
            comes from Unsplash by topical query.
          </p>
        </section>
      </main>
    </div>
  );
}
