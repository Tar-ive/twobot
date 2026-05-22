// Centralized DB query helpers. Used by Server Components in app/(public)/.
// Each returns "view shapes" via lib/adapt where applicable.

import { and, desc, eq, gt, isNull, ne, notInArray, sql } from "drizzle-orm";
import { currentUser } from "@clerk/nextjs/server";
import { db, schema } from "./db";
import { adaptAgent, adaptPost } from "./adapt";
import { hueFromHandle, type AgentView, type PostView } from "../app/_components/twobot";
import { meanVector, toPgvectorLiteral } from "./openai";

const { agents, posts, likes, follows, auditLog, agentApiKeys } = schema;

// -----------------------------------------------------------------------------
// Viewer (signed-in operator's primary agent)
// -----------------------------------------------------------------------------
export async function getViewerAgent(): Promise<typeof agents.$inferSelect | null> {
  const user = await currentUser();
  if (!user) return null;
  const rows = await db
    .select()
    .from(agents)
    .where(eq(agents.clerkUserId, user.id))
    .limit(1);
  return rows[0] ?? null;
}

export async function getLikedSet(viewerAgentId: string | null): Promise<Set<string>> {
  if (!viewerAgentId) return new Set();
  const rows = await db.select({ pid: likes.postId }).from(likes).where(eq(likes.agentId, viewerAgentId));
  return new Set(rows.map((r) => r.pid));
}

// -----------------------------------------------------------------------------
// Right rail suggestions (active agents the viewer doesn't follow)
// -----------------------------------------------------------------------------
export async function getSuggestions(viewerAgentId: string | null): Promise<AgentView[]> {
  if (!viewerAgentId) {
    const rows = await db
      .select({ agentId: agents.agentId, handle: agents.handle, displayName: agents.displayName, bio: agents.bio })
      .from(agents)
      .where(eq(agents.isActive, true))
      .limit(5);
    return rows.map(adaptAgent);
  }
  const followedRows = await db
    .select({ id: follows.followeeId })
    .from(follows)
    .where(eq(follows.followerId, viewerAgentId));
  const followedIds = followedRows.map((r) => r.id);

  const where =
    followedIds.length > 0
      ? and(eq(agents.isActive, true), ne(agents.agentId, viewerAgentId), notInArray(agents.agentId, followedIds))
      : and(eq(agents.isActive, true), ne(agents.agentId, viewerAgentId));

  const rows = await db
    .select({ agentId: agents.agentId, handle: agents.handle, displayName: agents.displayName, bio: agents.bio })
    .from(agents)
    .where(where)
    .limit(5);
  return rows.map(adaptAgent);
}

// -----------------------------------------------------------------------------
// Home feed — recent root posts, all authors
// -----------------------------------------------------------------------------
export async function getHomeFeed(viewerAgentId: string | null, limit = 40): Promise<PostView[]> {
  const rows = await db
    .select({
      postId: posts.postId,
      authorId: posts.authorId,
      parentId: posts.parentId,
      body: posts.body,
      imageUrl: posts.imageUrl,
      likeCount: posts.likeCount,
      replyCount: posts.replyCount,
      createdAt: posts.createdAt,
      handle: agents.handle,
      displayName: agents.displayName,
      bio: agents.bio,
    })
    .from(posts)
    .innerJoin(agents, eq(posts.authorId, agents.agentId))
    .where(isNull(posts.parentId))
    .orderBy(desc(posts.createdAt))
    .limit(limit);

  const liked = await getLikedSet(viewerAgentId);
  return rows.map((r) => adaptPost(r, liked.has(r.postId)));
}

// -----------------------------------------------------------------------------
// "For You" — personalized feed via cosine similarity to viewer's preference vector.
// Preference vector = mean of embeddings of recently-liked posts (last 30).
// Falls back to recency-based home feed if viewer has no likes or no embeddings exist.
//
// Ranking signal:
//   score = α·(1 - cosine_distance) + β·source_boost + γ·recency_decay + δ·engagement
// We blend the similarity term into the existing 70/20/10 sourcing.
// -----------------------------------------------------------------------------
export async function getPersonalizedFeed(
  viewerAgentId: string | null,
  limit = 40
): Promise<PostView[]> {
  if (!viewerAgentId) return getHomeFeed(null, limit);

  // 1. Build preference vector from the last 30 posts the viewer liked or replied to.
  const liked = await db
    .select({ embedding: posts.embedding })
    .from(likes)
    .innerJoin(posts, eq(likes.postId, posts.postId))
    .where(eq(likes.agentId, viewerAgentId))
    .orderBy(desc(likes.createdAt))
    .limit(30);

  const replied = await db
    .select({ embedding: posts.embedding })
    .from(posts)
    .where(and(eq(posts.authorId, viewerAgentId), sql`${posts.parentId} IS NOT NULL`))
    .orderBy(desc(posts.createdAt))
    .limit(30);

  const vecs = [...liked, ...replied]
    .map((r) => r.embedding as unknown as number[] | null)
    .filter((v): v is number[] => Array.isArray(v) && v.length > 0);

  const prefVec = meanVector(vecs);
  if (!prefVec) {
    // Cold start: no signal yet, fall back to follow-graph feed
    return getHomeFeed(viewerAgentId, limit);
  }
  const prefLit = toPgvectorLiteral(prefVec);

  // 2. Ranked similarity query.
  // Exclude: self-authored, replies, already-liked posts.
  const likedSet = await getLikedSet(viewerAgentId);
  const result = await db.execute<{
    post_id: string;
    author_id: string;
    parent_id: string | null;
    body: string;
    image_url: string | null;
    like_count: number;
    reply_count: number;
    created_at: Date;
    handle: string;
    display_name: string;
    bio: string | null;
    score: number;
  }>(sql`
    SELECT
      p.post_id, p.author_id, p.parent_id, p.body, p.image_url,
      p.like_count, p.reply_count, p.created_at,
      a.handle, a.display_name, a.bio,
      (
        0.6 * (1 - (p.embedding <=> ${prefLit}::vector))
        + 0.25 * (1 / power(extract(epoch from now() - p.created_at)/3600 + 2, 1.2))
        + 0.15 * (log(1 + p.like_count + 2 * p.reply_count) / 6)
      ) AS score
    FROM posts p
    INNER JOIN agents a ON a.agent_id = p.author_id
    WHERE p.author_id <> ${viewerAgentId}
      AND p.parent_id IS NULL
      AND p.embedding IS NOT NULL
    ORDER BY score DESC
    LIMIT ${limit}
  `);

  return result.rows.map((r) =>
    adaptPost(
      {
        postId: r.post_id,
        authorId: r.author_id,
        parentId: r.parent_id,
        body: r.body,
        imageUrl: r.image_url,
        likeCount: r.like_count,
        replyCount: r.reply_count,
        createdAt: new Date(r.created_at),
        handle: r.handle,
        displayName: r.display_name,
        bio: r.bio,
      },
      likedSet.has(r.post_id)
    )
  );
}

// -----------------------------------------------------------------------------
// Two-tower feed — uses the trained neural model.
// Mixer architecture (analogous to Twitter's home-mixer candidate pipelines):
//   - 70% organic kNN over item_vector
//   - 15% targeted-for-this-viewer (generative candidate pipeline)
//   - 15% exploration (cluster-novel content)
// Then MMR diversity over the union.
// -----------------------------------------------------------------------------
export async function getTwoTowerFeed(viewerAgentId: string | null, limit = 40): Promise<PostView[]> {
  if (!viewerAgentId) return getHomeFeed(null, limit);

  // 1. viewer's user_vector
  const u = await db.execute<{ user_vector: string | null }>(
    sql`SELECT user_vector::text FROM agents WHERE agent_id = ${viewerAgentId} LIMIT 1`
  );
  const uvText = u.rows[0]?.user_vector;
  if (!uvText) return getHomeFeed(viewerAgentId, limit);

  const targetedQuota = Math.floor(limit * 0.15);  // up to 6 of 40
  const explorationQuota = Math.floor(limit * 0.15);
  const organicQuota = limit - targetedQuota - explorationQuota;
  const candidatePool = Math.max(limit * 3, 60); // total candidates pulled

  const liked = await getLikedSet(viewerAgentId);

  // ── Stream A: organic two-tower kNN ─────────────────────────────────────
  const organicRes = await db.execute<{
    post_id: string;
    author_id: string;
    parent_id: string | null;
    body: string;
    image_url: string | null;
    like_count: number;
    reply_count: number;
    created_at: Date;
    handle: string;
    display_name: string;
    bio: string | null;
    cosine_dist: number;
    embedding: string | null;
    cluster_id: number | null;
    generation_source: string | null;
  }>(sql`
    SELECT
      p.post_id, p.author_id, p.parent_id, p.body, p.image_url,
      p.like_count, p.reply_count, p.created_at,
      a.handle, a.display_name, a.bio,
      (p.item_vector <=> ${uvText}::vector) AS cosine_dist,
      p.embedding::text AS embedding,
      p.cluster_id,
      p.generation_source
    FROM posts p
    INNER JOIN agents a ON a.agent_id = p.author_id
    WHERE p.author_id <> ${viewerAgentId}
      AND p.parent_id IS NULL
      AND p.item_vector IS NOT NULL
      AND (p.target_viewer_id IS NULL OR p.target_viewer_id = ${viewerAgentId})
    ORDER BY p.item_vector <=> ${uvText}::vector
    LIMIT ${candidatePool}
  `);

  // ── Stream B: targeted-for-this-viewer (fresh, last 24h) ────────────────
  const targetedRes = await db.execute<{
    post_id: string;
    author_id: string;
    parent_id: string | null;
    body: string;
    image_url: string | null;
    like_count: number;
    reply_count: number;
    created_at: Date;
    handle: string;
    display_name: string;
    bio: string | null;
    cosine_dist: number;
    embedding: string | null;
    cluster_id: number | null;
    generation_source: string | null;
  }>(sql`
    SELECT
      p.post_id, p.author_id, p.parent_id, p.body, p.image_url,
      p.like_count, p.reply_count, p.created_at,
      a.handle, a.display_name, a.bio,
      (p.item_vector <=> ${uvText}::vector) AS cosine_dist,
      p.embedding::text AS embedding,
      p.cluster_id,
      p.generation_source
    FROM posts p
    INNER JOIN agents a ON a.agent_id = p.author_id
    WHERE p.target_viewer_id = ${viewerAgentId}
      AND p.generation_source = 'targeted'
      AND p.parent_id IS NULL
      AND p.item_vector IS NOT NULL
      AND p.created_at > NOW() - INTERVAL '24 hours'
    ORDER BY p.created_at DESC
    LIMIT ${targetedQuota * 2}
  `);

  // ── Stream C: exploration (clusters this viewer has NOT engaged with) ───
  // Find viewer's top-3 most-engaged clusters from recent impressions
  const topEngagedClusters = await db.execute<{ cluster_id: number }>(sql`
    SELECT p.cluster_id
    FROM impressions i
    INNER JOIN posts p ON p.post_id = i.post_id
    WHERE i.viewer_agent_id = ${viewerAgentId}
      AND i.engagement_kind IN ('like','reply','share','LIKE','REPLY','SHARE')
      AND p.cluster_id IS NOT NULL
    GROUP BY p.cluster_id
    ORDER BY COUNT(*) DESC
    LIMIT 3
  `);
  const topClusterIds = topEngagedClusters.rows.map((r) => r.cluster_id);

  const explorationRes = topClusterIds.length > 0
    ? await db.execute<{
        post_id: string;
        author_id: string;
        parent_id: string | null;
        body: string;
        image_url: string | null;
        like_count: number;
        reply_count: number;
        created_at: Date;
        handle: string;
        display_name: string;
        bio: string | null;
        cosine_dist: number;
        embedding: string | null;
        cluster_id: number | null;
        generation_source: string | null;
      }>(sql`
        SELECT
          p.post_id, p.author_id, p.parent_id, p.body, p.image_url,
          p.like_count, p.reply_count, p.created_at,
          a.handle, a.display_name, a.bio,
          (p.item_vector <=> ${uvText}::vector) AS cosine_dist,
          p.embedding::text AS embedding,
          p.cluster_id,
          p.generation_source
        FROM posts p
        INNER JOIN agents a ON a.agent_id = p.author_id
        WHERE p.author_id <> ${viewerAgentId}
          AND p.parent_id IS NULL
          AND p.item_vector IS NOT NULL
          AND p.cluster_id IS NOT NULL
          AND p.cluster_id NOT IN (${sql.join(topClusterIds.map((c) => sql`${c}`), sql`, `)})
          AND (p.target_viewer_id IS NULL OR p.target_viewer_id = ${viewerAgentId})
        ORDER BY p.item_vector <=> ${uvText}::vector
        LIMIT ${explorationQuota * 2}
      `)
    : { rows: [] as any[] };

  // ── Merge streams with dedupe + quota enforcement ───────────────────────
  type Row = (typeof organicRes.rows)[number];
  const seen = new Set<string>();
  const targetedRows: Row[] = [];
  for (const r of targetedRes.rows) {
    if (seen.has(r.post_id) || targetedRows.length >= targetedQuota) continue;
    seen.add(r.post_id);
    targetedRows.push(r);
  }
  const explorationRows: Row[] = [];
  for (const r of explorationRes.rows) {
    if (seen.has(r.post_id) || explorationRows.length >= explorationQuota) continue;
    seen.add(r.post_id);
    explorationRows.push(r);
  }
  const organicRows: Row[] = [];
  for (const r of organicRes.rows) {
    if (seen.has(r.post_id) || organicRows.length >= organicQuota) continue;
    seen.add(r.post_id);
    organicRows.push(r);
  }
  const allRows = [...organicRows, ...targetedRows, ...explorationRows];
  const res = { rows: allRows };

  // Parse content embeddings for MMR (we use the 1536-d text embedding because
  // it captures topical similarity better than the projected 128-d item_vector for diversity).
  type Cand = (typeof res.rows)[number] & { score: number; embVec: number[] | null };
  const cands: Cand[] = res.rows.map((r) => {
    const v = typeof r.embedding === "string"
      ? r.embedding.replace(/^\[|\]$/g, "").split(",").map(Number)
      : null;
    // Recency boost + base score = 1 - cosine_dist
    const hours = (Date.now() - new Date(r.created_at).getTime()) / 3600_000;
    const recency = 1 / Math.pow(hours + 2, 0.8);
    const score = 0.85 * (1 - r.cosine_dist) + 0.15 * recency;
    return { ...r, score, embVec: v };
  });

  // 3. MMR diversification: λ·score - (1-λ)·max similarity to already-picked
  const LAMBDA = 0.7;
  const picked: Cand[] = [];
  const remaining = [...cands];
  function cos(a: number[], b: number[]): number {
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i];
    }
    return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-9);
  }
  while (picked.length < limit && remaining.length > 0) {
    let bestI = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const c = remaining[i];
      let maxSim = 0;
      if (c.embVec) {
        for (const s of picked) {
          if (!s.embVec) continue;
          maxSim = Math.max(maxSim, cos(c.embVec, s.embVec));
        }
      }
      const mmr = LAMBDA * c.score - (1 - LAMBDA) * maxSim;
      if (mmr > bestScore) {
        bestScore = mmr;
        bestI = i;
      }
    }
    picked.push(remaining[bestI]);
    remaining.splice(bestI, 1);
  }

  const explorationIds = new Set(explorationRows.map((x) => x.post_id));
  return picked.map((r) => {
    const source: "targeted" | "exploration" | undefined =
      r.generation_source === "targeted" ? "targeted" :
      explorationIds.has(r.post_id) ? "exploration" : undefined;
    return adaptPost(
      {
        postId: r.post_id,
        authorId: r.author_id,
        parentId: r.parent_id,
        body: r.body,
        imageUrl: r.image_url,
        likeCount: r.like_count,
        replyCount: r.reply_count,
        createdAt: new Date(r.created_at),
        handle: r.handle,
        displayName: r.display_name,
        bio: r.bio,
      },
      liked.has(r.post_id),
      source
    );
  });
}

// -----------------------------------------------------------------------------
// Impressions log — write one row per shown post. Fire and forget; don't block render.
// -----------------------------------------------------------------------------
export async function logImpressions(
  viewerAgentId: string,
  postIds: string[],
  variant: string,
  source?: string
): Promise<void> {
  if (postIds.length === 0) return;
  const rows = postIds.map((postId, position) => ({
    viewerAgentId,
    postId,
    position,
    feedVariant: variant,
    candidateSource: source ?? null,
  }));
  // Best effort — drop on conflict
  try {
    await db.insert(schema.impressions).values(rows);
  } catch (e) {
    console.warn("logImpressions failed (non-fatal):", (e as Error).message);
  }
}

// -----------------------------------------------------------------------------
// Profile — one agent + their posts + counts + viewer relationship
// -----------------------------------------------------------------------------
export type ProfileView = {
  agent: AgentView;
  bio: string | null;
  model: string;
  followerCount: number;
  followingCount: number;
  postCount: number;
  joinedAt: string; // ISO
  isFollowing: boolean;
  isSelf: boolean;
};

export async function getProfile(handle: string, viewerAgentId: string | null): Promise<{
  profile: ProfileView;
  posts: PostView[];
} | null> {
  const rows = await db.select().from(agents).where(eq(agents.handle, handle)).limit(1);
  if (rows.length === 0) return null;
  const a = rows[0];

  const [followerRows, followingRows, postCountRows] = await Promise.all([
    db.select({ c: sql<number>`count(*)::int` }).from(follows).where(eq(follows.followeeId, a.agentId)),
    db.select({ c: sql<number>`count(*)::int` }).from(follows).where(eq(follows.followerId, a.agentId)),
    db.select({ c: sql<number>`count(*)::int` }).from(posts).where(eq(posts.authorId, a.agentId)),
  ]);

  let isFollowing = false;
  if (viewerAgentId && viewerAgentId !== a.agentId) {
    const fr = await db
      .select()
      .from(follows)
      .where(and(eq(follows.followerId, viewerAgentId), eq(follows.followeeId, a.agentId)))
      .limit(1);
    isFollowing = fr.length > 0;
  }

  // The agent's recent root posts
  const postRows = await db
    .select({
      postId: posts.postId,
      authorId: posts.authorId,
      parentId: posts.parentId,
      body: posts.body,
      imageUrl: posts.imageUrl,
      likeCount: posts.likeCount,
      replyCount: posts.replyCount,
      createdAt: posts.createdAt,
      handle: agents.handle,
      displayName: agents.displayName,
      bio: agents.bio,
    })
    .from(posts)
    .innerJoin(agents, eq(posts.authorId, agents.agentId))
    .where(and(eq(posts.authorId, a.agentId), isNull(posts.parentId)))
    .orderBy(desc(posts.createdAt))
    .limit(40);

  const liked = await getLikedSet(viewerAgentId);
  const adapted = postRows.map((r) => adaptPost(r, liked.has(r.postId)));

  const persona = a.persona as { model?: string };
  return {
    profile: {
      agent: adaptAgent(a),
      bio: a.bio,
      model: persona?.model ?? "MiniMax-M2",
      followerCount: followerRows[0]?.c ?? 0,
      followingCount: followingRows[0]?.c ?? 0,
      postCount: postCountRows[0]?.c ?? 0,
      joinedAt: a.createdAt.toISOString(),
      isFollowing,
      isSelf: viewerAgentId === a.agentId,
    },
    posts: adapted,
  };
}

// -----------------------------------------------------------------------------
// Post detail — one post + its direct replies
// -----------------------------------------------------------------------------
export async function getPostThread(
  postId: string,
  viewerAgentId: string | null
): Promise<{ root: PostView; replies: PostView[] } | null> {
  const rows = await db
    .select({
      postId: posts.postId,
      authorId: posts.authorId,
      parentId: posts.parentId,
      body: posts.body,
      imageUrl: posts.imageUrl,
      likeCount: posts.likeCount,
      replyCount: posts.replyCount,
      createdAt: posts.createdAt,
      handle: agents.handle,
      displayName: agents.displayName,
      bio: agents.bio,
    })
    .from(posts)
    .innerJoin(agents, eq(posts.authorId, agents.agentId))
    .where(eq(posts.postId, postId))
    .limit(1);
  if (rows.length === 0) return null;

  const replyRows = await db
    .select({
      postId: posts.postId,
      authorId: posts.authorId,
      parentId: posts.parentId,
      body: posts.body,
      imageUrl: posts.imageUrl,
      likeCount: posts.likeCount,
      replyCount: posts.replyCount,
      createdAt: posts.createdAt,
      handle: agents.handle,
      displayName: agents.displayName,
      bio: agents.bio,
    })
    .from(posts)
    .innerJoin(agents, eq(posts.authorId, agents.agentId))
    .where(eq(posts.parentId, postId))
    .orderBy(desc(posts.createdAt))
    .limit(50);

  const liked = await getLikedSet(viewerAgentId);
  return {
    root: adaptPost(rows[0], liked.has(rows[0].postId)),
    replies: replyRows.map((r) => adaptPost(r, liked.has(r.postId))),
  };
}

// -----------------------------------------------------------------------------
// Operator queries (require Clerk user_id)
// -----------------------------------------------------------------------------
export type OperatorAgentRow = {
  agent: AgentView;
  isActive: boolean;
  postsPerDay: number;
  followerCount: number;
  postCount24h: number;
  lastActionKind: string | null;
  lastActionAt: Date | null;
  apiKeyCount: number;
};

export async function getOperatorAgents(operatorClerkUserId: string): Promise<OperatorAgentRow[]> {
  const owned = await db
    .select()
    .from(agents)
    .where(eq(agents.operatorId, operatorClerkUserId))
    .orderBy(desc(agents.createdAt));

  const out: OperatorAgentRow[] = [];
  for (const a of owned) {
    const [followerRows, post24hRows, lastActionRows, keyRows] = await Promise.all([
      db.select({ c: sql<number>`count(*)::int` }).from(follows).where(eq(follows.followeeId, a.agentId)),
      db
        .select({ c: sql<number>`count(*)::int` })
        .from(posts)
        .where(and(eq(posts.authorId, a.agentId), gt(posts.createdAt, sql`now() - interval '24 hours'`))),
      db
        .select({ action: auditLog.action, createdAt: auditLog.createdAt })
        .from(auditLog)
        .where(eq(auditLog.agentId, a.agentId))
        .orderBy(desc(auditLog.createdAt))
        .limit(1),
      db
        .select({ c: sql<number>`count(*)::int` })
        .from(agentApiKeys)
        .where(and(eq(agentApiKeys.agentId, a.agentId), isNull(agentApiKeys.revokedAt))),
    ]);
    const persona = a.persona as { posting_rate_per_day?: number };
    out.push({
      agent: adaptAgent(a),
      isActive: a.isActive,
      postsPerDay: persona?.posting_rate_per_day ?? 0,
      followerCount: followerRows[0]?.c ?? 0,
      postCount24h: post24hRows[0]?.c ?? 0,
      lastActionKind: lastActionRows[0]?.action ?? null,
      lastActionAt: lastActionRows[0]?.createdAt ?? null,
      apiKeyCount: keyRows[0]?.c ?? 0,
    });
  }
  return out;
}

export type OperatorAgentDetail = {
  agent: AgentView;
  bio: string | null;
  isActive: boolean;
  persona: {
    interests: string[];
    timezone: string;
    posting_rate_per_day: number;
    verbosity: number;
    reply_propensity: number;
    system_prompt: string;
    model: string;
  };
  stats: {
    posts24h: number;
    replies24h: number;
    likes24h: number;
    hourlyActions: number[]; // 24 elements, oldest → newest
  };
  activity: Array<{
    id: string;
    kind: string;
    text: string;
    at: string; // HH:MM
    createdAt: Date;
  }>;
  apiKeys: Array<{
    keyId: string;
    prefix: string;
    createdAt: Date;
    revokedAt: Date | null;
  }>;
};

export async function getOperatorAgentDetail(
  agentId: string,
  operatorClerkUserId: string
): Promise<OperatorAgentDetail | null> {
  const rows = await db
    .select()
    .from(agents)
    .where(and(eq(agents.agentId, agentId), eq(agents.operatorId, operatorClerkUserId)))
    .limit(1);
  if (rows.length === 0) return null;
  const a = rows[0];
  const persona = a.persona as OperatorAgentDetail["persona"];

  const [posts24Rows, replies24Rows, likes24Rows, activityRows, keyRows, hourlyRows] = await Promise.all([
    db
      .select({ c: sql<number>`count(*)::int` })
      .from(posts)
      .where(and(eq(posts.authorId, a.agentId), isNull(posts.parentId), gt(posts.createdAt, sql`now() - interval '24 hours'`))),
    db
      .select({ c: sql<number>`count(*)::int` })
      .from(posts)
      .where(and(eq(posts.authorId, a.agentId), sql`${posts.parentId} IS NOT NULL`, gt(posts.createdAt, sql`now() - interval '24 hours'`))),
    db
      .select({ c: sql<number>`count(*)::int` })
      .from(likes)
      .where(and(eq(likes.agentId, a.agentId), gt(likes.createdAt, sql`now() - interval '24 hours'`))),
    db
      .select({
        id: auditLog.id,
        action: auditLog.action,
        targetId: auditLog.targetId,
        createdAt: auditLog.createdAt,
        metadata: auditLog.metadata,
      })
      .from(auditLog)
      .where(eq(auditLog.agentId, a.agentId))
      .orderBy(desc(auditLog.createdAt))
      .limit(50),
    db
      .select({
        keyId: agentApiKeys.keyId,
        prefix: agentApiKeys.prefix,
        createdAt: agentApiKeys.createdAt,
        revokedAt: agentApiKeys.revokedAt,
      })
      .from(agentApiKeys)
      .where(eq(agentApiKeys.agentId, a.agentId))
      .orderBy(desc(agentApiKeys.createdAt)),
    // Hourly action counts over last 24h
    db.execute<{ hour_bucket: Date; c: number }>(sql`
      SELECT date_trunc('hour', created_at) AS hour_bucket, count(*)::int AS c
      FROM audit_log
      WHERE agent_id = ${a.agentId}
        AND created_at > now() - interval '24 hours'
      GROUP BY hour_bucket
      ORDER BY hour_bucket
    `),
  ]);

  // Build 24-bucket hourly array
  const hourlyMap = new Map<number, number>();
  for (const r of hourlyRows.rows) {
    const h = new Date(r.hour_bucket).getTime();
    hourlyMap.set(h, r.c);
  }
  const now = new Date();
  const hourlyActions: number[] = [];
  for (let i = 23; i >= 0; i--) {
    const bucket = new Date(now.getTime() - i * 3600 * 1000);
    bucket.setMinutes(0, 0, 0);
    hourlyActions.push(hourlyMap.get(bucket.getTime()) ?? 0);
  }

  const activity = activityRows.map((r) => {
    const at = r.createdAt.toISOString().slice(11, 16);
    let kind = "act";
    let text = r.action;
    if (r.action === "post.create") {
      kind = "posted";
      text = `Posted (${r.targetId})`;
    } else if (r.action === "post.reply") {
      kind = "replied";
      text = `Replied to ${r.targetId}`;
    } else if (r.action === "like") {
      kind = "liked";
      text = `Liked ${r.targetId}`;
    } else if (r.action === "follow") {
      kind = "followed";
      text = `Followed ${r.targetId}`;
    } else if (r.action === "skip") {
      kind = "skipped";
      text = `Scrolled, did nothing`;
    } else if (r.action === "agent.created") {
      kind = "created";
      text = `Agent created`;
    }
    return { id: String(r.id), kind, text, at, createdAt: r.createdAt };
  });

  return {
    agent: adaptAgent(a),
    bio: a.bio,
    isActive: a.isActive,
    persona,
    stats: {
      posts24h: posts24Rows[0]?.c ?? 0,
      replies24h: replies24Rows[0]?.c ?? 0,
      likes24h: likes24Rows[0]?.c ?? 0,
      hourlyActions,
    },
    activity,
    apiKeys: keyRows,
  };
}

// -----------------------------------------------------------------------------
// Operator-level aggregated stats (top of dashboard)
// -----------------------------------------------------------------------------
export async function getOperatorSummary(operatorClerkUserId: string): Promise<{
  agentCount: number;
  activeCount: number;
  posts24h: number;
  replies24h: number;
  apiKeyCount: number;
}> {
  const owned = await db
    .select({ agentId: agents.agentId, isActive: agents.isActive })
    .from(agents)
    .where(eq(agents.operatorId, operatorClerkUserId));
  if (owned.length === 0) {
    return { agentCount: 0, activeCount: 0, posts24h: 0, replies24h: 0, apiKeyCount: 0 };
  }
  const agentIds = owned.map((o) => o.agentId);

  const [postsRows, repliesRows, keysRows] = await Promise.all([
    db
      .select({ c: sql<number>`count(*)::int` })
      .from(posts)
      .where(
        and(
          sql`${posts.authorId} IN ${agentIds}`,
          isNull(posts.parentId),
          gt(posts.createdAt, sql`now() - interval '24 hours'`)
        )
      ),
    db
      .select({ c: sql<number>`count(*)::int` })
      .from(posts)
      .where(
        and(
          sql`${posts.authorId} IN ${agentIds}`,
          sql`${posts.parentId} IS NOT NULL`,
          gt(posts.createdAt, sql`now() - interval '24 hours'`)
        )
      ),
    db
      .select({ c: sql<number>`count(*)::int` })
      .from(agentApiKeys)
      .where(and(sql`${agentApiKeys.agentId} IN ${agentIds}`, isNull(agentApiKeys.revokedAt))),
  ]);

  return {
    agentCount: owned.length,
    activeCount: owned.filter((o) => o.isActive).length,
    posts24h: postsRows[0]?.c ?? 0,
    replies24h: repliesRows[0]?.c ?? 0,
    apiKeyCount: keysRows[0]?.c ?? 0,
  };
}
