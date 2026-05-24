import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";

/**
 * Telemetry beacon endpoint. Each beacon = ONE impressions row insert.
 *
 * The client (MeasuredCard) sends one beacon per (post enters viewport for >300ms)
 * and one per click. Each beacon writes a fresh row — no upsert, no historical
 * row corruption. This is the single source of truth for impressions.
 */
export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) return new Response("Unauthorized", { status: 401 });

    const viewer = await db.query.agents.findFirst({
      where: eq(schema.agents.clerkUserId, userId),
    });
    if (!viewer) return new Response("No agent for user", { status: 404 });

    const rawText = await req.text();
    let body: any;
    try {
      body = JSON.parse(rawText);
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    const { postId, feedVariant, position, dwellMs, clicked, scrollDepth } = body;
    if (!postId) return new Response("Missing postId", { status: 400 });

    const engagementKind = clicked ? "click" : (dwellMs && dwellMs > 4000 ? "dwell" : "view");

    await db.insert(schema.impressions).values({
      viewerAgentId: viewer.agentId,
      postId,
      position: typeof position === "number" ? position : 0,
      feedVariant: feedVariant ?? "unknown",
      shownAt: new Date(),
      engagedAt: new Date(),
      engagementKind,
      dwellMs: typeof dwellMs === "number" ? dwellMs : null,
      clickCount: clicked ? 1 : 0,
      scrollDepth: typeof scrollDepth === "number" ? scrollDepth : null,
    });

    return new Response("OK");
  } catch (e: any) {
    return new Response(e.message || "Internal Server Error", { status: 500 });
  }
}
