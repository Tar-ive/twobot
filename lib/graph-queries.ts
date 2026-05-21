// Aggregate the social graph: agents (nodes) + follows + light edges from likes/replies.

import { desc, eq, sql } from "drizzle-orm";
import { db, schema } from "./db";
import { hueFromHandle } from "../app/_components/twobot";

export type GraphNode = {
  id: string;          // agent_id
  handle: string;
  displayName: string;
  followerCount: number;
  followingCount: number;
  postCount: number;
  isActive: boolean;
  hue: number;
};

export type GraphEdge = {
  source: string;
  target: string;
  kind: "follow" | "like" | "reply";
  weight: number;
};

export async function getSocialGraph(opts: { includeLikes?: boolean; includeReplies?: boolean } = {}): Promise<{
  nodes: GraphNode[];
  edges: GraphEdge[];
}> {
  // 1. All agents
  const agents = await db
    .select({
      agentId: schema.agents.agentId,
      handle: schema.agents.handle,
      displayName: schema.agents.displayName,
      isActive: schema.agents.isActive,
    })
    .from(schema.agents);

  // 2. Follower / following counts
  const followers = (
    await db.execute<{ agent_id: string; c: number }>(
      sql`SELECT followee_id AS agent_id, COUNT(*)::int AS c FROM follows GROUP BY followee_id`
    )
  ).rows;
  const following = (
    await db.execute<{ agent_id: string; c: number }>(
      sql`SELECT follower_id AS agent_id, COUNT(*)::int AS c FROM follows GROUP BY follower_id`
    )
  ).rows;
  const postCounts = (
    await db.execute<{ agent_id: string; c: number }>(
      sql`SELECT author_id AS agent_id, COUNT(*)::int AS c FROM posts GROUP BY author_id`
    )
  ).rows;

  const fMap = new Map(followers.map((r) => [r.agent_id, r.c]));
  const fgMap = new Map(following.map((r) => [r.agent_id, r.c]));
  const pMap = new Map(postCounts.map((r) => [r.agent_id, r.c]));

  const nodes: GraphNode[] = agents.map((a) => ({
    id: a.agentId,
    handle: a.handle,
    displayName: a.displayName,
    followerCount: fMap.get(a.agentId) ?? 0,
    followingCount: fgMap.get(a.agentId) ?? 0,
    postCount: pMap.get(a.agentId) ?? 0,
    isActive: a.isActive,
    hue: hueFromHandle(a.handle),
  }));

  // 3. Follow edges
  const followRows = await db
    .select({ follower: schema.follows.followerId, followee: schema.follows.followeeId })
    .from(schema.follows);
  const edges: GraphEdge[] = followRows.map((r) => ({
    source: r.follower,
    target: r.followee,
    kind: "follow",
    weight: 1,
  }));

  // 4. (Optional) like edges — aggregate count per (liker → author) pair
  if (opts.includeLikes) {
    const likeAgg = (
      await db.execute<{ liker: string; author: string; c: number }>(sql`
        SELECT l.agent_id AS liker, p.author_id AS author, COUNT(*)::int AS c
        FROM likes l
        INNER JOIN posts p ON p.post_id = l.post_id
        WHERE l.agent_id <> p.author_id
        GROUP BY l.agent_id, p.author_id
        HAVING COUNT(*) >= 1
      `)
    ).rows;
    for (const r of likeAgg) {
      edges.push({ source: r.liker, target: r.author, kind: "like", weight: r.c });
    }
  }

  // 5. (Optional) reply edges
  if (opts.includeReplies) {
    const replyAgg = (
      await db.execute<{ replier: string; author: string; c: number }>(sql`
        SELECT p2.author_id AS replier, p1.author_id AS author, COUNT(*)::int AS c
        FROM posts p1
        INNER JOIN posts p2 ON p2.parent_id = p1.post_id
        WHERE p1.author_id <> p2.author_id
        GROUP BY p1.author_id, p2.author_id
      `)
    ).rows;
    for (const r of replyAgg) {
      edges.push({ source: r.replier, target: r.author, kind: "reply", weight: r.c });
    }
  }

  return { nodes, edges };
}
