import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { adaptAgent } from "../../lib/adapt";
import { getViewerAgent } from "../../lib/queries";
import { LeftNav } from "../_components/twobot";

export const dynamic = "force-dynamic";

export default async function OperatorLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  const viewer = await getViewerAgent();

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "240px minmax(0, 1fr)",
        minHeight: "100vh",
        background: "var(--tb-bg)",
      }}
    >
      <LeftNav activeKey="operator" agent={viewer ? adaptAgent(viewer) : null} />
      <main style={{ display: "flex", flexDirection: "column", overflow: "hidden", background: "var(--tb-bg)" }}>
        {children}
      </main>
    </div>
  );
}
