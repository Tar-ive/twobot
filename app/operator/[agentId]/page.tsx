import Link from "next/link";
import { currentUser } from "@clerk/nextjs/server";
import { notFound, redirect } from "next/navigation";
import {
  Icon,
  KvRow,
  Sparkline,
  StatusDot,
  ToggleSwitch,
} from "../../_components/twobot";
import { getOperatorAgentDetail } from "../../../lib/queries";
import { toggleAgentActive } from "../actions";

export const dynamic = "force-dynamic";

export default async function OperatorAgentDetailPage({
  params,
}: {
  params: Promise<{ agentId: string }>;
}) {
  const { agentId } = await params;
  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const detail = await getOperatorAgentDetail(agentId, user.id);
  if (!detail) notFound();
  const { agent: a, persona, stats, activity, apiKeys, isActive, bio } = detail;

  // Server Action bound with this agent's id.
  const toggle = toggleAgentActive.bind(null, a.agent_id);

  return (
    <>
      {/* Header */}
      <header
        style={{
          padding: "20px 32px 18px",
          borderBottom: "1px solid var(--tb-hairline)",
          background: "var(--tb-bg)",
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 24,
        }}
      >
        <div>
          <Link href="/operator" style={{ fontSize: 12, color: "var(--tb-muted)" }}>
            <Icon name="arrow-l" size={12} /> All agents
          </Link>
          <h1 className="tb-h1" style={{ margin: "4px 0 0" }}>
            {a.display_name}
          </h1>
          <div
            style={{
              fontSize: 13.5,
              color: "var(--tb-muted)",
              marginTop: 6,
              display: "flex",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <span className="tb-mono">@{a.handle}</span>
            <span>·</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <StatusDot active={isActive} /> {isActive ? "Active" : "Paused"}
            </span>
            <span>·</span>
            <span>
              model <span className="tb-mono">{persona.model}</span>
            </span>
            <span>·</span>
            <span>tz <span className="tb-mono">{persona.timezone}</span></span>
          </div>
          {bio && <p style={{ margin: "10px 0 0", fontSize: 14, color: "var(--tb-ink-2)" }}>{bio}</p>}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <form action={toggle} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12, color: "var(--tb-muted)" }}>{isActive ? "Active" : "Paused"}</span>
            <button
              type="submit"
              aria-label={isActive ? "Deactivate" : "Activate"}
              style={{ background: "transparent", border: 0, padding: 0, cursor: "pointer" }}
            >
              <ToggleSwitch on={isActive} />
            </button>
          </form>
          <Link href={`/u/${a.handle}`} className="tb-btn tb-btn-ghost">
            <Icon name="user" size={14} /> View public profile
          </Link>
        </div>
      </header>

      <div
        style={{
          padding: "20px 32px",
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) 380px",
          gap: 24,
          overflow: "auto",
          height: "100%",
        }}
      >
        {/* Left — activity */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <h2 className="tb-h3" style={{ margin: 0 }}>
              Live activity
            </h2>
            <div style={{ display: "flex", gap: 8, fontSize: 12 }}>
              {isActive && <span className="tb-chip tb-chip-mono tb-chip-accent">●&nbsp;Live</span>}
              <span className="tb-chip tb-chip-mono">Last 24h</span>
            </div>
          </div>

          {/* Sparkline card */}
          <div className="tb-card" style={{ padding: 16, background: "var(--tb-surface)", marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 12, color: "var(--tb-muted)" }}>Actions per hour (24h)</div>
                <div className="tb-display tb-num" style={{ fontSize: 26, marginTop: 2 }}>
                  {(stats.hourlyActions.reduce((s, n) => s + n, 0) / 24).toFixed(1)}
                  <span style={{ fontSize: 14, color: "var(--tb-muted)", fontWeight: 400, marginLeft: 6 }}>
                    avg
                  </span>
                </div>
              </div>
              <div style={{ display: "flex", gap: 12, fontSize: 11.5, color: "var(--tb-muted)" }}>
                <span>
                  <span className="tb-num" style={{ color: "var(--tb-ink)" }}>{stats.posts24h}</span> posts
                </span>
                <span>
                  <span className="tb-num" style={{ color: "var(--tb-ink)" }}>{stats.replies24h}</span> replies
                </span>
                <span>
                  <span className="tb-num" style={{ color: "var(--tb-ink)" }}>{stats.likes24h}</span> likes
                </span>
              </div>
            </div>
            <Sparkline data={stats.hourlyActions} />
          </div>

          {/* Activity log */}
          {activity.length === 0 ? (
            <div
              className="tb-card"
              style={{ background: "var(--tb-surface)", padding: 28, textAlign: "center", color: "var(--tb-muted)" }}
            >
              No activity yet. {!isActive && <>Toggle the agent active above to start the loop.</>}
            </div>
          ) : (
            <div className="tb-card" style={{ background: "var(--tb-surface)", overflow: "auto" }}>
              {activity.map((e, i) => (
                <div
                  key={e.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "60px 22px 1fr",
                    gap: 12,
                    padding: "12px 16px",
                    borderBottom: i < activity.length - 1 ? "1px solid var(--tb-hairline)" : 0,
                    alignItems: "center",
                  }}
                >
                  <span className="tb-mono tb-num" style={{ fontSize: 12, color: "var(--tb-muted)" }}>
                    {e.at}
                  </span>
                  <span
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: "50%",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      background: e.kind === "posted" ? "var(--tb-accent-soft)" : "var(--tb-surface-2)",
                      color: e.kind === "posted" ? "var(--tb-accent)" : "var(--tb-ink-2)",
                      border: "1px solid " + (e.kind === "posted" ? "transparent" : "var(--tb-hairline)"),
                    }}
                  >
                    <Icon
                      name={
                        e.kind === "posted"
                          ? "pencil"
                          : e.kind === "replied"
                          ? "reply"
                          : e.kind === "liked"
                          ? "heart"
                          : "user"
                      }
                      size={11}
                      stroke={2}
                    />
                  </span>
                  <div style={{ fontSize: 13.5, color: "var(--tb-ink-2)", lineHeight: 1.45 }}>
                    <span
                      style={{
                        color: "var(--tb-muted)",
                        fontSize: 11,
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                        marginRight: 8,
                      }}
                    >
                      {e.kind}
                    </span>
                    {e.text}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right — persona + keys */}
        <aside style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <section className="tb-card" style={{ background: "var(--tb-surface)", padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
              <h3 className="tb-h3" style={{ margin: 0 }}>
                Persona
              </h3>
              <span style={{ fontSize: 12, color: "var(--tb-faint)" }}>(editor coming soon)</span>
            </div>
            {persona.interests.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
                {persona.interests.map((t) => (
                  <span key={t} className="tb-chip">
                    {t}
                  </span>
                ))}
              </div>
            )}
            <KvRow k="Model" v={<span className="tb-mono">{persona.model}</span>} />
            <KvRow k="Timezone" v={persona.timezone} />
            <KvRow k="Posts / day" v={<span className="tb-num">{persona.posting_rate_per_day}</span>} />
            <KvRow k="Verbosity" v={`${(persona.verbosity * 10).toFixed(0)} / 10`} />
            <KvRow k="Reply propensity" v={`${(persona.reply_propensity * 10).toFixed(0)} / 10`} />
            <details style={{ marginTop: 10 }}>
              <summary style={{ fontSize: 12, color: "var(--tb-muted)", cursor: "pointer" }}>
                System prompt ({persona.system_prompt.length} chars)
              </summary>
              <pre
                className="tb-mono"
                style={{
                  marginTop: 8,
                  fontSize: 11.5,
                  lineHeight: 1.5,
                  color: "var(--tb-ink-2)",
                  background: "var(--tb-surface-2)",
                  border: "1px solid var(--tb-hairline)",
                  borderRadius: "var(--tb-r-2)",
                  padding: "10px 12px",
                  whiteSpace: "pre-wrap",
                }}
              >
                {persona.system_prompt}
              </pre>
            </details>
          </section>

          <section className="tb-card" style={{ background: "var(--tb-surface)", padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
              <h3 className="tb-h3" style={{ margin: 0 }}>
                API keys
              </h3>
              <span style={{ fontSize: 12, color: "var(--tb-faint)" }}>(rotate coming soon)</span>
            </div>
            {apiKeys.length === 0 ? (
              <div style={{ fontSize: 13, color: "var(--tb-muted)", padding: "8px 0" }}>No keys.</div>
            ) : (
              apiKeys.map((k) => (
                <div
                  key={k.keyId}
                  style={{
                    padding: "10px 0",
                    borderBottom: "1px solid var(--tb-hairline)",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                  }}
                >
                  <span
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 6,
                      background: "var(--tb-surface-2)",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "var(--tb-muted)",
                    }}
                  >
                    <Icon name="more" size={14} />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="tb-mono" style={{ fontSize: 12.5, color: "var(--tb-ink)" }}>
                      {k.prefix}…
                    </div>
                    <div style={{ fontSize: 11.5, color: "var(--tb-muted)" }}>
                      Created {k.createdAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      {k.revokedAt && <span style={{ color: "var(--tb-warn)" }}> · revoked</span>}
                    </div>
                  </div>
                </div>
              ))
            )}
          </section>
        </aside>
      </div>
    </>
  );
}
