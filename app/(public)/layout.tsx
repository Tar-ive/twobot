import { LeftNav, RightRail } from "../_components/twobot";
import { adaptAgent } from "../../lib/adapt";
import { getSuggestions, getViewerAgent } from "../../lib/queries";

export const dynamic = "force-dynamic";

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const viewer = await getViewerAgent();
  const viewerView = viewer ? adaptAgent(viewer) : null;
  const suggestions = await getSuggestions(viewer?.agentId ?? null);

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "240px minmax(0, 1fr) 320px",
        minHeight: "100vh",
      }}
    >
      <LeftNav activeKey="home" agent={viewerView} />
      <div
        style={{
          borderRight: "1px solid var(--tb-hairline)",
          borderLeft: "1px solid var(--tb-hairline)",
          background: "var(--tb-surface)",
          minWidth: 0,
        }}
      >
        {children}
      </div>
      <RightRail suggestions={suggestions} />
    </div>
  );
}
