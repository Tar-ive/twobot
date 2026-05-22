// The 12-stage generative candidate pipeline orchestrator.
// One call = one generated targeted post (or a structured rejection).

import { nanoid } from "nanoid";
import { desc, eq, sql } from "drizzle-orm";
import { db, schema } from "./db";
import { embedOne, generateChat, toPgvectorLiteral } from "./openai";
import { buildItemScalars, computeItemVector } from "./twotower";
import { detectTopicGap, type TopicGap } from "./topic-gap";
import { pickAuthor, type AuthorChoice } from "./author-picker";
import { checkQuality, type QualityResult } from "./quality-filter";

export type GenerationResult =
  | {
      ok: true;
      postId: string;
      body: string;
      author: AuthorChoice;
      gap: TopicGap;
      stagesMs: Record<string, number>;
    }
  | { ok: false; stage: string; reason: string; detail?: string };

export async function generateForViewer(viewerId: string): Promise<GenerationResult> {
  const stages: Record<string, number> = {};
  const tick = (k: string, t: number) => {
    stages[k] = Date.now() - t;
  };

  // -- Stage 2: viewer state (handled inline by topic-gap + author-picker) --
  const viewer = (
    await db.select().from(schema.agents).where(eq(schema.agents.agentId, viewerId)).limit(1)
  )[0];
  if (!viewer) return { ok: false, stage: "viewer-lookup", reason: "viewer_not_found" };

  // -- Stage 3: topic gap --
  let t = Date.now();
  const gap = await detectTopicGap(viewerId);
  tick("gap-detect", t);
  if (!gap) {
    return { ok: false, stage: "gap-detect", reason: "no_gap_found" };
  }

  // -- Stage 4-5: author selection --
  t = Date.now();
  const author = await pickAuthor(viewerId, gap.clusterId);
  tick("author-pick", t);
  if (!author) {
    return { ok: false, stage: "author-pick", reason: "no_eligible_author" };
  }

  // -- Stage 6: topic brief (3 anchor posts + tf-idf-ish keywords) --
  t = Date.now();
  const anchors = (
    await db.execute<{ body: string }>(sql`
      SELECT p.body FROM posts p
      WHERE p.cluster_id = ${gap.clusterId} AND p.embedding IS NOT NULL
      ORDER BY p.embedding <=> (SELECT centroid FROM topic_clusters WHERE cluster_id = ${gap.clusterId})
      LIMIT 3
    `)
  ).rows.map((r) => r.body);
  tick("topic-brief", t);

  // -- Stage 7: viewer priming (recent positive topics) --
  t = Date.now();
  const recentPositive = (
    await db.execute<{ body: string }>(sql`
      SELECT p.body
      FROM impressions i
      INNER JOIN posts p ON p.post_id = i.post_id
      WHERE i.viewer_agent_id = ${viewerId}
        AND i.engagement_kind IN ('like','reply','share','LIKE','REPLY','SHARE')
      ORDER BY i.shown_at DESC
      LIMIT 3
    `)
  ).rows.map((r) => r.body.slice(0, 100));
  tick("viewer-priming", t);

  // -- Stage 8: MiniMax generate --
  t = Date.now();
  const anchorBlock = anchors.length > 0
    ? anchors.map((a, i) => `  ${i + 1}. "${a}"`).join("\n")
    : "  (no anchors available)";
  const recentBlock = recentPositive.length > 0
    ? recentPositive.map((r) => `  - "${r}"`).join("\n")
    : "  (no recent engagement signal)";

  const userPrompt =
    `Write a tweet (<200 chars) that fits the cluster "${gap.label}".\n\n` +
    `Style anchors — get the vibe, don't copy:\n${anchorBlock}\n\n` +
    `Reader recently engaged with:\n${recentBlock}\n\n` +
    `Stay in your own voice. No hashtags. No "here's a tweet" framing — just the tweet.`;

  let body = "";
  try {
    body = (
      await generateChat({
        system: author.systemPrompt,
        user: userPrompt,
        maxTokens: 220,
        temperature: 0.85,
      })
    ).trim();
  } catch (e) {
    tick("generate", t);
    return { ok: false, stage: "generate", reason: "generate_error", detail: (e as Error).message.slice(0, 100) };
  }
  tick("generate", t);
  if (!body) {
    return { ok: false, stage: "generate", reason: "empty_output" };
  }
  // Strip surrounding quotes if the model wrapped its output
  body = body.replace(/^["']|["']$/g, "").trim();

  // -- Stage 10 first: embed (needed for Stage 9 novelty check) --
  t = Date.now();
  const textEmb = await embedOne(body);
  tick("embed", t);

  // -- Stage 9: quality filter (uses the embedding) --
  t = Date.now();
  const quality = await checkQuality(body, textEmb);
  tick("quality-check", t);
  if (!quality.ok) {
    return { ok: false, stage: "quality-check", reason: quality.reason, detail: quality.detail };
  }

  // -- Stage 10 (cont.): item_vector via two-tower --
  t = Date.now();
  const now = new Date();
  const authorFollowersRow = await db.execute<{ c: number }>(
    sql`SELECT COUNT(*)::int AS c FROM follows WHERE followee_id = ${author.agentId}`
  );
  const authorFollowers = authorFollowersRow.rows[0]?.c ?? 0;
  const itemVec = await computeItemVector({
    bodyEmbedding: textEmb,
    scalars: buildItemScalars({ likeCount: 0, replyCount: 0, imageUrl: null, createdAt: now }, authorFollowers, now),
  });
  tick("item-vector", t);

  // -- Stage 11: insert --
  t = Date.now();
  const postId = `post_${nanoid(12)}`;
  await db.execute(sql`
    INSERT INTO posts (post_id, author_id, body, embedding, item_vector, cluster_id, target_viewer_id, generation_source)
    VALUES (${postId}, ${author.agentId}, ${body},
      ${toPgvectorLiteral(textEmb)}::vector,
      ${toPgvectorLiteral(itemVec)}::vector,
      ${gap.clusterId}, ${viewerId}, 'targeted')
  `);
  tick("insert", t);

  // -- Stage 12: audit --
  await db.insert(schema.auditLog).values({
    agentId: author.agentId,
    action: "post.create",
    targetId: postId,
    metadata: {
      source: "generative-pipeline",
      targetViewer: viewerId,
      cluster: gap.clusterId,
      clusterLabel: gap.label,
      gapMode: gap.mode,
      authorScore: author.score,
      authorRank: author.rank,
    },
  });

  return { ok: true, postId, body, author, gap, stagesMs: stages };
}
