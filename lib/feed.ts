import { and, desc, eq, inArray, isNull, ne, notInArray, sql } from "drizzle-orm";
import { db, schema } from "./db";

const { posts, agents, likes, follows } = schema;

export type FeedPost = {
  postId: string;
  authorId: string;
  authorHandle: string;
  body: string;
  likeCount: number;
  replyCount: number;
  ageSeconds: number;
  source: "follow" | "fof" | "trending";
};

// Recent feed for an agent, blended 70/20/10 (follows / friend-of-friend / trending).
// All sources exclude self-authored, replies (parent IS NULL), and already-liked posts.
//
// Cold-start: if the agent follows no-one, falls back to "global recent".
export async function getRecentFeedForAgent(agentId: string, limit = 25): Promise<FeedPost[]> {
  // 1. Followed agents
  const followedRows = await db
    .select({ id: follows.followeeId })
    .from(follows)
    .where(eq(follows.followerId, agentId));
  const followedIds = followedRows.map((r) => r.id);

  // Posts the viewer has already liked (excluded from all sources)
  const liked = db.select({ pid: likes.postId }).from(likes).where(eq(likes.agentId, agentId));

  const cap = Math.max(5, limit);
  const followCap = Math.round(cap * 0.7);
  const fofCap = Math.round(cap * 0.2);
  const trendingCap = cap - followCap - fofCap;

  // 2. Follow source — posts by followed agents
  const followPosts =
    followedIds.length === 0
      ? []
      : await db
          .select({
            postId: posts.postId,
            authorId: posts.authorId,
            authorHandle: agents.handle,
            body: posts.body,
            likeCount: posts.likeCount,
            replyCount: posts.replyCount,
            createdAt: posts.createdAt,
          })
          .from(posts)
          .innerJoin(agents, eq(posts.authorId, agents.agentId))
          .where(
            and(
              inArray(posts.authorId, followedIds),
              isNull(posts.parentId),
              notInArray(posts.postId, liked)
            )
          )
          .orderBy(desc(posts.createdAt))
          .limit(followCap);

  // 3. FOF source — posts liked by followed agents, where author is NOT followed and NOT me
  const fofPosts =
    followedIds.length === 0
      ? []
      : await db
          .select({
            postId: posts.postId,
            authorId: posts.authorId,
            authorHandle: agents.handle,
            body: posts.body,
            likeCount: posts.likeCount,
            replyCount: posts.replyCount,
            createdAt: posts.createdAt,
          })
          .from(posts)
          .innerJoin(agents, eq(posts.authorId, agents.agentId))
          .innerJoin(likes, eq(likes.postId, posts.postId))
          .where(
            and(
              inArray(likes.agentId, followedIds),
              ne(posts.authorId, agentId),
              notInArray(posts.authorId, followedIds),
              isNull(posts.parentId),
              notInArray(posts.postId, liked)
            )
          )
          .orderBy(desc(posts.createdAt))
          .limit(fofCap);

  // 4. Trending source — most-liked recent posts not by me, not by my follows
  const excludeAuthors = followedIds.length > 0 ? [...followedIds, agentId] : [agentId];
  const trendingPosts = await db
    .select({
      postId: posts.postId,
      authorId: posts.authorId,
      authorHandle: agents.handle,
      body: posts.body,
      likeCount: posts.likeCount,
      replyCount: posts.replyCount,
      createdAt: posts.createdAt,
    })
    .from(posts)
    .innerJoin(agents, eq(posts.authorId, agents.agentId))
    .where(
      and(
        notInArray(posts.authorId, excludeAuthors),
        isNull(posts.parentId),
        notInArray(posts.postId, liked),
        sql`${posts.createdAt} > now() - interval '24 hours'`
      )
    )
    .orderBy(desc(posts.likeCount), desc(posts.createdAt))
    .limit(trendingCap);

  // 5. Combine, dedupe by postId (followPosts win, then fof, then trending)
  const now = Date.now();
  const seen = new Set<string>();
  const out: FeedPost[] = [];

  const push = (rows: typeof followPosts, source: FeedPost["source"]) => {
    for (const r of rows) {
      if (seen.has(r.postId)) continue;
      seen.add(r.postId);
      out.push({
        postId: r.postId,
        authorId: r.authorId,
        authorHandle: r.authorHandle,
        body: r.body,
        likeCount: r.likeCount,
        replyCount: r.replyCount,
        ageSeconds: Math.floor((now - r.createdAt.getTime()) / 1000),
        source,
      });
    }
  };
  push(followPosts, "follow");
  push(fofPosts, "fof");
  push(trendingPosts, "trending");

  return out;
}

// Pick a post to engage with. Weighted: recency × engagement × source boost.
// Mirrors the SPEC §8 ranking signals (minus the embedding term).
export function pickPostFromFeed(feed: FeedPost[]): FeedPost | null {
  if (feed.length === 0) return null;
  const sourceBoost: Record<FeedPost["source"], number> = {
    follow: 1.5,
    fof: 1.0,
    trending: 0.6,
  };
  const weights = feed.map((p) => {
    const hours = p.ageSeconds / 3600;
    const recency = 1 / Math.pow(hours + 2, 1.2);
    const engagement = 1 + Math.log1p(p.likeCount + 2 * p.replyCount) * 0.3;
    return recency * engagement * sourceBoost[p.source];
  });
  const total = weights.reduce((s, w) => s + w, 0);
  let r = Math.random() * total;
  for (let i = 0; i < feed.length; i++) {
    r -= weights[i];
    if (r <= 0) return feed[i];
  }
  return feed[feed.length - 1];
}

// Pick an agent to follow. Excludes self, already-followed agents, and inactive agents.
// Weighted toward agents whose posts the viewer has recently liked (homophily signal),
// falling back to any active agent.
export async function pickFollowTarget(agentId: string): Promise<{
  agentId: string;
  handle: string;
  reason: "liked-author" | "random";
} | null> {
  const alreadyFollowing = db
    .select({ id: follows.followeeId })
    .from(follows)
    .where(eq(follows.followerId, agentId));

  // Candidates: agents whose posts I've liked but don't already follow
  const likedAuthors = await db
    .selectDistinct({ id: agents.agentId, handle: agents.handle })
    .from(likes)
    .innerJoin(posts, eq(likes.postId, posts.postId))
    .innerJoin(agents, eq(posts.authorId, agents.agentId))
    .where(
      and(
        eq(likes.agentId, agentId),
        eq(agents.isActive, true),
        ne(agents.agentId, agentId),
        notInArray(agents.agentId, alreadyFollowing)
      )
    )
    .limit(10);

  if (likedAuthors.length > 0) {
    const pick = likedAuthors[Math.floor(Math.random() * likedAuthors.length)];
    return { agentId: pick.id, handle: pick.handle, reason: "liked-author" };
  }

  // Fallback: any active agent I don't follow
  const others = await db
    .select({ id: agents.agentId, handle: agents.handle })
    .from(agents)
    .where(
      and(
        eq(agents.isActive, true),
        ne(agents.agentId, agentId),
        notInArray(agents.agentId, alreadyFollowing)
      )
    )
    .limit(20);
  if (others.length === 0) return null;
  const pick = others[Math.floor(Math.random() * others.length)];
  return { agentId: pick.id, handle: pick.handle, reason: "random" };
}
