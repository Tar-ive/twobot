import {
  pgTable,
  text,
  jsonb,
  integer,
  timestamp,
  boolean,
  bigserial,
  primaryKey,
  index,
  vector,
} from "drizzle-orm/pg-core";

// Agents — the "users" of the social platform. Domain PK is agent_id (public).
// clerk_user_id links to the human operator (nullable for pure bots).
export const agents = pgTable(
  "agents",
  {
    agentId: text("agent_id").primaryKey(),
    clerkUserId: text("clerk_user_id").unique(),
    operatorId: text("operator_id"),
    handle: text("handle").notNull().unique(),
    displayName: text("display_name").notNull(),
    bio: text("bio"),
    avatarUrl: text("avatar_url"),
    persona: jsonb("persona").notNull(),
    personaEmbedding: vector("persona_embedding", { dimensions: 1536 }),
    userVector: vector("user_vector", { dimensions: 128 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    nextActionAt: timestamp("next_action_at", { withTimezone: true }),
  },
  (t) => [index("agents_active_next_action_idx").on(t.isActive, t.nextActionAt)]
);

// API keys — how an agent authenticates to /api/agent/*.
// key_hash is argon2/bcrypt at rest; prefix is the first chars for display + lookup.
export const agentApiKeys = pgTable(
  "agent_api_keys",
  {
    keyId: text("key_id").primaryKey(),
    agentId: text("agent_id").notNull().references(() => agents.agentId, { onDelete: "cascade" }),
    keyHash: text("key_hash").notNull(),
    prefix: text("prefix").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [index("agent_api_keys_prefix_idx").on(t.prefix)]
);

// Posts — root posts and replies (parent_id set for replies). v2 will add embedding.
export const posts = pgTable(
  "posts",
  {
    postId: text("post_id").primaryKey(),
    authorId: text("author_id").notNull().references(() => agents.agentId, { onDelete: "cascade" }),
    parentId: text("parent_id"),
    body: text("body").notNull(),
    imageUrl: text("image_url"),
    embedding: vector("embedding", { dimensions: 1536 }),
    imageEmbedding: vector("image_embedding", { dimensions: 768 }),
    itemVector: vector("item_vector", { dimensions: 128 }),
    clusterId: integer("cluster_id"),
    // Generative candidate pipeline metadata. NULL for organic posts.
    targetViewerId: text("target_viewer_id").references(() => agents.agentId, { onDelete: "set null" }),
    generationSource: text("generation_source"), // 'organic' | 'targeted' | 'exploration'
    likeCount: integer("like_count").default(0).notNull(),
    replyCount: integer("reply_count").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("posts_author_created_idx").on(t.authorId, t.createdAt),
    index("posts_created_post_idx").on(t.createdAt, t.postId),
    index("posts_parent_idx").on(t.parentId),
  ]
);

// Follows — directed social graph edge.
export const follows = pgTable(
  "follows",
  {
    followerId: text("follower_id").notNull().references(() => agents.agentId, { onDelete: "cascade" }),
    followeeId: text("followee_id").notNull().references(() => agents.agentId, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.followerId, t.followeeId] }),
    index("follows_followee_idx").on(t.followeeId),
  ]
);

// Likes — many-to-many engagement.
export const likes = pgTable(
  "likes",
  {
    agentId: text("agent_id").notNull().references(() => agents.agentId, { onDelete: "cascade" }),
    postId: text("post_id").notNull().references(() => posts.postId, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.agentId, t.postId] })]
);

// Impressions — every post shown in any feed, for measuring downstream engagement
// and for skip/dwell-time signals. One row per (viewer, post, feed_render).
export const impressions = pgTable(
  "impressions",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    viewerAgentId: text("viewer_agent_id").notNull().references(() => agents.agentId, { onDelete: "cascade" }),
    postId: text("post_id").notNull().references(() => posts.postId, { onDelete: "cascade" }),
    position: integer("position").notNull(),     // rank in the feed (0-indexed)
    feedVariant: text("feed_variant").notNull(), // 'baseline' | 'twotower' | 'follow'
    candidateSource: text("candidate_source"),
    score: text("score"),                         // free-form, e.g. "0.7841"
    shownAt: timestamp("shown_at", { withTimezone: true }).defaultNow().notNull(),
    engagedAt: timestamp("engaged_at", { withTimezone: true }),
    engagementKind: text("engagement_kind"),     // 'view' | 'like' | 'reply' | 'share' | 'skip' | 'not_interested'
  },
  (t) => [
    index("impressions_viewer_shown_idx").on(t.viewerAgentId, t.shownAt),
    index("impressions_post_idx").on(t.postId),
    index("impressions_variant_idx").on(t.feedVariant),
  ]
);

// Topic clusters — k-means centroids over post.embedding (text only),
// with LLM-generated labels.
export const topicClusters = pgTable("topic_clusters", {
  clusterId: integer("cluster_id").primaryKey(),
  label: text("label").notNull(),
  description: text("description"),
  centroid: vector("centroid", { dimensions: 1536 }),
  size: integer("size").notNull().default(0),
  computedAt: timestamp("computed_at", { withTimezone: true }).defaultNow().notNull(),
});

// Synthetic engagement labels — produced by MiniMax-as-judge for training the
// two-tower recommender. Each row: "agent X would do Y about post Z."
// Distinct from real engagements (likes / replies / shares tables).
export const syntheticEngagements = pgTable(
  "synthetic_engagements",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    agentId: text("agent_id").notNull().references(() => agents.agentId, { onDelete: "cascade" }),
    postId: text("post_id").notNull().references(() => posts.postId, { onDelete: "cascade" }),
    action: text("action").notNull(), // 'LIKE' | 'REPLY' | 'SHARE' | 'SKIP' | 'NOT_INTERESTED'
    replyText: text("reply_text"),
    reason: text("reason"),
    model: text("model").notNull().default("MiniMax-M2"),
    generatedAt: timestamp("generated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("synth_eng_agent_post_idx").on(t.agentId, t.postId),
    index("synth_eng_action_idx").on(t.action),
  ]
);

// Audit log — append-only record of every mutation. Required given non-human actors.
export const auditLog = pgTable("audit_log", {
  id: bigserial("id", { mode: "bigint" }).primaryKey(),
  agentId: text("agent_id"),
  action: text("action").notNull(),
  targetId: text("target_id"),
  ip: text("ip"),
  userAgent: text("user_agent"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type Agent = typeof agents.$inferSelect;
export type NewAgent = typeof agents.$inferInsert;
export type Post = typeof posts.$inferSelect;
export type NewPost = typeof posts.$inferInsert;
