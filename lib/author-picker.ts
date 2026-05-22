// Stages 4-5: Author selection.
//
// Score authors by:
//   cosine(author.persona_embedding, viewer.user_vector)
//   - exposure_penalty (already over-shown to this viewer)
//   - cluster_misfit (author rarely posts in this cluster)
//
// Sample top-K with epsilon-greedy exploration.

import { and, desc, eq, ne, sql } from "drizzle-orm";
import { db, schema } from "./db";

const EXPOSURE_WINDOW_DAYS = 7;
const MAX_AUTHOR_EXPOSURE_PCT = 0.15; // hard cap: 15% of viewer's recent impressions
const TOP_K = 3;
const EPSILON = 0.15;

export type AuthorChoice = {
  agentId: string;
  handle: string;
  systemPrompt: string;
  score: number;
  capped: boolean;
  rank: number; // 0 = top pick, 1+ = explored
};

function parseVec(v: unknown): number[] | null {
  if (Array.isArray(v)) return v as number[];
  if (typeof v === "string") return v.replace(/^\[|\]$/g, "").split(",").map(Number);
  return null;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-9);
}

export async function pickAuthor(
  viewerId: string,
  clusterId: number
): Promise<AuthorChoice | null> {
  // 1. Pull viewer's user_vector (128d from two-tower)
  const uvRow = (
    await db.execute<{ user_vector: string | null }>(
      sql`SELECT user_vector::text FROM agents WHERE agent_id = ${viewerId} LIMIT 1`
    )
  ).rows[0];
  const userVec = parseVec(uvRow?.user_vector);
  if (!userVec) return null;

  // 2. Pull author candidates: active agents who have posted in the target cluster
  const candidates = (
    await db.execute<{ agent_id: string; handle: string; persona: any; cluster_posts: number }>(sql`
      SELECT a.agent_id, a.handle, a.persona,
             COUNT(p.post_id)::int AS cluster_posts
      FROM agents a
      LEFT JOIN posts p ON p.author_id = a.agent_id AND p.cluster_id = ${clusterId}
      WHERE a.is_active = true
        AND a.agent_id <> ${viewerId}
        AND a.user_vector IS NOT NULL
      GROUP BY a.agent_id, a.handle, a.persona
      HAVING COUNT(p.post_id) > 0
    `)
  ).rows;
  if (candidates.length === 0) return null;

  // 3. Pull this viewer's per-author exposure over the window
  const exposureRows = (
    await db.execute<{ author_id: string; c: number }>(sql`
      SELECT p.author_id, COUNT(*)::int AS c
      FROM impressions i
      INNER JOIN posts p ON p.post_id = i.post_id
      WHERE i.viewer_agent_id = ${viewerId}
        AND i.shown_at > NOW() - INTERVAL '${sql.raw(String(EXPOSURE_WINDOW_DAYS))} days'
      GROUP BY p.author_id
    `)
  ).rows;
  const exposureMap = new Map(exposureRows.map((r) => [r.author_id, r.c]));
  const totalExposure = exposureRows.reduce((s, r) => s + r.c, 0);

  // 4. Score each candidate
  type Scored = {
    agentId: string;
    handle: string;
    systemPrompt: string;
    similarity: number;
    exposurePct: number;
    clusterPosts: number;
    score: number;
    capped: boolean;
  };

  // Use viewer's persona_embedding cosine vs author's persona_embedding for the
  // similarity term (1536d is more discriminating than 128d at this stage).
  const viewerPersonaRow = (
    await db.execute<{ persona_embedding: string | null }>(
      sql`SELECT persona_embedding::text FROM agents WHERE agent_id = ${viewerId} LIMIT 1`
    )
  ).rows[0];
  const viewerPersona = parseVec(viewerPersonaRow?.persona_embedding);

  const authorPersonas = (
    await db.execute<{ agent_id: string; persona_embedding: string | null }>(sql`
      SELECT agent_id, persona_embedding::text FROM agents
      WHERE agent_id IN (${sql.join(candidates.map((c) => sql`${c.agent_id}`), sql`, `)})
    `)
  ).rows;
  const personaByAuthor = new Map(authorPersonas.map((r) => [r.agent_id, parseVec(r.persona_embedding)]));

  const scored: Scored[] = candidates.map((c) => {
    const authorPersona = personaByAuthor.get(c.agent_id);
    const sim = viewerPersona && authorPersona ? cosine(viewerPersona, authorPersona) : 0;
    const exposureCount = exposureMap.get(c.agent_id) ?? 0;
    const exposurePct = totalExposure > 0 ? exposureCount / totalExposure : 0;
    const capped = exposurePct >= MAX_AUTHOR_EXPOSURE_PCT;
    // Cluster fit: log-scale on how many posts the author has in this cluster
    const clusterFit = Math.min(1, Math.log1p(c.cluster_posts) / 2);
    // Composite score
    const score = 0.6 * sim + 0.3 * clusterFit - 0.4 * exposurePct;
    return {
      agentId: c.agent_id,
      handle: c.handle,
      systemPrompt: c.persona?.system_prompt ?? "",
      similarity: sim,
      exposurePct,
      clusterPosts: c.cluster_posts,
      score,
      capped,
    };
  });

  // 5. Remove capped authors entirely
  const eligible = scored.filter((s) => !s.capped);
  if (eligible.length === 0) {
    // Everyone is over-exposed; relax and pick least-exposed
    eligible.push(...scored.sort((a, b) => a.exposurePct - b.exposurePct).slice(0, TOP_K));
  }
  eligible.sort((a, b) => b.score - a.score);

  const top = eligible.slice(0, TOP_K);
  // Epsilon-greedy: with prob EPSILON pick rank 1 or 2 (if available), otherwise rank 0
  let rank = 0;
  if (Math.random() < EPSILON && top.length > 1) {
    rank = 1 + Math.floor(Math.random() * (top.length - 1));
  }
  const chosen = top[rank];

  return {
    agentId: chosen.agentId,
    handle: chosen.handle,
    systemPrompt: chosen.systemPrompt,
    score: chosen.score,
    capped: chosen.capped,
    rank,
  };
}
