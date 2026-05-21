// v2: includes simulator-generated impressions + image_embedding feature.
// Dumps to data/training.json for Python training.

import { sql } from "drizzle-orm";
import * as fs from "node:fs";
import { db, schema } from "../lib/db";

const POSITIVE_ACTIONS = new Set(["LIKE", "REPLY", "SHARE", "like", "reply", "share"]);

// ----- Pull labels from BOTH sources -----
// 1. Synthetic LLM-judge labels
const syntheticLabels = await db
  .select({
    agentId: schema.syntheticEngagements.agentId,
    postId: schema.syntheticEngagements.postId,
    action: schema.syntheticEngagements.action,
  })
  .from(schema.syntheticEngagements);
console.log(`synthetic_engagements: ${syntheticLabels.length}`);

// 2. Simulator-generated impressions with engagement
const impressionLabels = await db
  .select({
    agentId: schema.impressions.viewerAgentId,
    postId: schema.impressions.postId,
    action: schema.impressions.engagementKind,
  })
  .from(schema.impressions)
  .where(sql`${schema.impressions.engagementKind} IS NOT NULL`);
console.log(`impressions with engagement: ${impressionLabels.length}`);

// Union, dedupe by (agent, post) preferring impressions (newer signal)
const seen = new Set<string>();
const allLabels: { agentId: string; postId: string; action: string }[] = [];
for (const l of impressionLabels) {
  const k = `${l.agentId}::${l.postId}`;
  if (seen.has(k) || !l.action) continue;
  seen.add(k);
  allLabels.push({ agentId: l.agentId, postId: l.postId, action: l.action.toUpperCase() });
}
for (const l of syntheticLabels) {
  const k = `${l.agentId}::${l.postId}`;
  if (seen.has(k)) continue;
  seen.add(k);
  allLabels.push(l);
}
console.log(`total unique labels: ${allLabels.length}\n`);

// Build user feature table
const userIds = Array.from(new Set(allLabels.map((l) => l.agentId)));
const itemIds = Array.from(new Set(allLabels.map((l) => l.postId)));
console.log(`unique users: ${userIds.length}, items: ${itemIds.length}`);

const userIdx = new Map(userIds.map((id, i) => [id, i]));
const itemIdx = new Map(itemIds.map((id, i) => [id, i]));

const userRows = await db
  .select({
    agentId: schema.agents.agentId,
    persona: schema.agents.persona,
    personaEmbedding: schema.agents.personaEmbedding,
  })
  .from(schema.agents);
const userById = new Map(userRows.map((r) => [r.agentId, r]));

const fcRows = (await db.execute<{ agent_id: string; c: number }>(
  sql`SELECT followee_id AS agent_id, COUNT(*)::int AS c FROM follows GROUP BY followee_id`
)).rows;
const followerMap = new Map(fcRows.map((r) => [r.agent_id, r.c]));

const itemRows = await db
  .select({
    postId: schema.posts.postId,
    embedding: schema.posts.embedding,
    imageEmbedding: schema.posts.imageEmbedding,
    likeCount: schema.posts.likeCount,
    replyCount: schema.posts.replyCount,
    imageUrl: schema.posts.imageUrl,
    createdAt: schema.posts.createdAt,
  })
  .from(schema.posts);
const itemById = new Map(itemRows.map((r) => [r.postId, r]));

function parseVec(v: unknown): number[] | null {
  if (Array.isArray(v)) return v as number[];
  if (typeof v === "string") return v.replace(/^\[|\]$/g, "").split(",").map(Number);
  return null;
}

const TEXT_DIM = 1536;
const IMAGE_DIM = 768;

const user_embs: number[][] = [];
const user_scalars: number[][] = [];
for (const id of userIds) {
  const r = userById.get(id)!;
  const vec = parseVec(r.personaEmbedding) ?? new Array(TEXT_DIM).fill(0);
  user_embs.push(vec);
  const p = r.persona as { posting_rate_per_day?: number; reply_propensity?: number };
  user_scalars.push([
    (p.posting_rate_per_day ?? 4) / 12,
    p.reply_propensity ?? 0.3,
    Math.log1p(followerMap.get(id) ?? 0) / 6,
  ]);
}

const NOW = Date.now();
const item_text_embs: number[][] = [];
const item_image_embs: number[][] = [];
const item_image_present: number[] = []; // bit per item
const item_scalars: number[][] = [];

let imagedCount = 0;
for (const id of itemIds) {
  const r = itemById.get(id)!;
  const textVec = parseVec(r.embedding) ?? new Array(TEXT_DIM).fill(0);
  item_text_embs.push(textVec);

  const imgVec = parseVec(r.imageEmbedding);
  if (imgVec && imgVec.length === IMAGE_DIM) {
    item_image_embs.push(imgVec);
    item_image_present.push(1);
    imagedCount++;
  } else {
    item_image_embs.push(new Array(IMAGE_DIM).fill(0));
    item_image_present.push(0);
  }

  const ageHours = (NOW - r.createdAt.getTime()) / 3600_000;
  item_scalars.push([
    Math.log1p(ageHours) / 8,
    Math.log1p(r.likeCount) / 4,
    Math.log1p(r.replyCount) / 3,
    r.imageUrl ? 1 : 0,
  ]);
}
console.log(`items with CLIP image embedding: ${imagedCount}/${itemIds.length}`);

const labelRows = allLabels.map((l) => ({
  u: userIdx.get(l.agentId)!,
  i: itemIdx.get(l.postId)!,
  y: POSITIVE_ACTIONS.has(l.action) ? 1 : 0,
  action: l.action,
}));

const pos = labelRows.filter((r) => r.y === 1).length;
console.log(`positives: ${pos}, negatives: ${labelRows.length - pos}`);
console.log(`pos rate: ${((pos / labelRows.length) * 100).toFixed(1)}%`);

const output = {
  meta: {
    num_users: userIds.length,
    num_items: itemIds.length,
    num_labels: labelRows.length,
    user_emb_dim: TEXT_DIM,
    item_text_dim: TEXT_DIM,
    item_image_dim: IMAGE_DIM,
    user_scalar_dim: 3,
    item_scalar_dim: 4,
    positive_rate: pos / labelRows.length,
  },
  user_ids: userIds,
  item_ids: itemIds,
  user_embs,
  user_scalars,
  item_text_embs,
  item_image_embs,
  item_image_present,
  item_scalars,
  labels: labelRows,
};

fs.writeFileSync("data/training.json", JSON.stringify(output));
const size = fs.statSync("data/training.json").size;
console.log(`\nwrote data/training.json (${(size / 1024 / 1024).toFixed(1)} MB)`);
