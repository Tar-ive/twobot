import { db, schema } from "@/lib/db";
import { eq, sql } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";

export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return new Response("Unauthorized", { status: 401 });
    }

    const viewer = await db.query.agents.findFirst({
      where: eq(schema.agents.clerkUserId, userId),
    });
    if (!viewer) {
      return new Response("No agent found", { status: 404 });
    }

    // Try parsing as text first, because navigator.sendBeacon often sends text/plain, or json
    const rawText = await req.text();
    let body;
    try {
      body = JSON.parse(rawText);
    } catch (parseErr) {
      return new Response("Invalid JSON body", { status: 400 });
    }

    const { postId, dwellMs, clicked, scrollDepth } = body;
    if (!postId) {
      return new Response("Missing postId", { status: 400 });
    }

    // Update the existing impression record or log a new view if it doesn't exist
    // Drizzle execute using raw sql
    await db.execute(sql`
      UPDATE impressions
      SET 
        dwell_ms = COALESCE(dwell_ms, 0) + ${dwellMs ?? 0},
        click_count = click_count + ${clicked ? 1 : 0},
        scroll_depth = GREATEST(COALESCE(scroll_depth, 0), ${scrollDepth ?? 0}),
        engaged_at = NOW(),
        engagement_kind = CASE 
          WHEN ${clicked} = true THEN 'like' -- or keep 'view'/'click'. The implementation plan says:
          -- WHEN clicked = true THEN 'click' but wait, we want to see how we assign engagement_kind.
          -- In schema.ts, engagementKind is: 'view' | 'like' | 'reply' | 'share' | 'skip' | 'not_interested'
          -- Wait! Let's check what engagementKind values are expected or if we can write 'click' and 'dwell'.
          -- If we use 'click' or 'dwell' as engagementKind, does it conflict with existing types? 
          -- Let's check the schema.ts: engagementKind is just text("engagement_kind"), and comments say: // 'view' | 'like' | 'reply' | 'share' | 'skip' | 'not_interested'
          -- So we can absolutely write 'click' or 'dwell'! Or we can write whatever text we want since it is a text column.
          WHEN ${clicked} = true THEN 'click'
          WHEN ${dwellMs} > 4000 THEN 'dwell'
          ELSE COALESCE(engagement_kind, 'view')
        END
      WHERE viewer_agent_id = ${viewer.agentId} AND post_id = ${postId}
    `);

    return new Response("OK");
  } catch (e: any) {
    return new Response(e.message || "Internal Server Error", { status: 500 });
  }
}
