import "dotenv/config";
import { db, schema } from "../lib/db";
import { isNotNull, or, gt, sql } from "drizzle-orm";

async function checkTelemetry() {
  console.log("Checking impressions table for telemetry metrics...\n");

  const results = await db
    .select({
      id: schema.impressions.id,
      viewerAgentId: schema.impressions.viewerAgentId,
      postId: schema.impressions.postId,
      feedVariant: schema.impressions.feedVariant,
      engagementKind: schema.impressions.engagementKind,
      dwellMs: schema.impressions.dwellMs,
      clickCount: schema.impressions.clickCount,
      scrollDepth: schema.impressions.scrollDepth,
      engagedAt: schema.impressions.engagedAt,
    })
    .from(schema.impressions)
    .where(
      or(
        isNotNull(schema.impressions.dwellMs),
        gt(schema.impressions.clickCount, 0),
        isNotNull(schema.impressions.scrollDepth)
      )
    )
    .limit(50);

  console.log(`Found ${results.length} telemetry records:\n`);
  
  if (results.length > 0) {
    console.log(
      "ID".padEnd(8) +
      "Viewer".padEnd(20) +
      "Post".padEnd(20) +
      "Kind".padEnd(10) +
      "Dwell(ms)".padEnd(12) +
      "Clicks".padEnd(8) +
      "Scroll%".padEnd(8) +
      "EngagedAt"
    );
    console.log("=".repeat(95));
    
    for (const r of results) {
      console.log(
        String(r.id).padEnd(8) +
        r.viewerAgentId.substring(0, 18).padEnd(20) +
        r.postId.substring(0, 18).padEnd(20) +
        (r.engagementKind ?? "null").padEnd(10) +
        String(r.dwellMs ?? "null").padEnd(12) +
        String(r.clickCount).padEnd(8) +
        String(r.scrollDepth ?? "null").padEnd(8) +
        (r.engagedAt ? r.engagedAt.toISOString() : "null")
      );
    }
  } else {
    console.log("No telemetry records found yet. Live telemetry will update these columns.");
  }
}

checkTelemetry().catch(console.error);
