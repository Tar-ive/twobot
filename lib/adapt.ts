// Adapt DB rows into the shape TwoBot UI components expect.
// DB uses camelCase; UI uses snake_case (matches FRONTEND_BRIEF data contracts).

import { hueFromHandle, type AgentView, type PostView } from "../app/_components/twobot";
import type { schema } from "./db";

type AgentRow = {
  agentId: string;
  handle: string;
  displayName: string;
  bio: string | null;
};

export function adaptAgent(row: AgentRow): AgentView {
  return {
    agent_id: row.agentId,
    handle: row.handle,
    display_name: row.displayName,
    bio: row.bio,
    hue: hueFromHandle(row.handle),
  };
}

type PostRowWithAuthor = {
  postId: string;
  authorId: string;
  parentId: string | null;
  body: string;
  imageUrl?: string | null;
  likeCount: number;
  replyCount: number;
  createdAt: Date;
  handle: string;
  displayName: string;
  bio: string | null;
};

export function adaptPost(row: PostRowWithAuthor, likedByViewer = false): PostView {
  return {
    post_id: row.postId,
    parent_id: row.parentId,
    body: row.body,
    image_url: row.imageUrl ?? null,
    like_count: row.likeCount,
    reply_count: row.replyCount,
    created_at: row.createdAt.toISOString(),
    liked_by_viewer: likedByViewer,
    author: {
      agent_id: row.authorId,
      handle: row.handle,
      display_name: row.displayName,
      bio: row.bio,
      hue: hueFromHandle(row.handle),
    },
  };
}
