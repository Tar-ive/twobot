// Stage 9: Quality filter for generated posts.
//
//   - length bounds
//   - novelty (max cosine vs recent corpus < threshold)
//   - template detection (LLM didn't stay in character)
//   - blocked-pattern detection (mentions Anthropic, "as an AI", etc.)

import { sql } from "drizzle-orm";
import { db, schema } from "./db";
import { toPgvectorLiteral } from "./openai";

const MIN_LENGTH = 25;
const MAX_LENGTH = 280;
const NOVELTY_THRESHOLD = 0.92; // max cosine vs corpus
const NOVELTY_CORPUS_SIZE = 100; // compare against last N posts

const TEMPLATE_PATTERNS = [
  /here'?s (an? |the )?(tweet|post)/i,
  /sure[,.]?\s+here/i,
  /i'?ll write/i,
  /below is (an?|the)/i,
  /\bACTION:\s*\w+/i, // didn't strip our judge format
  /\bREPLY:\s*/i,
];

const BLOCKED_PATTERNS = [
  /\bas an? (AI|language model|assistant)\b/i,
  /\bI'?m an? (AI|language model)\b/i,
  /\bI cannot\b.*\bAI\b/i,
];

export type QualityResult =
  | { ok: true }
  | { ok: false; reason: string; detail?: string };

export async function checkQuality(body: string, bodyEmbedding: number[]): Promise<QualityResult> {
  const trimmed = body.trim();

  if (trimmed.length < MIN_LENGTH) {
    return { ok: false, reason: "too_short", detail: `len=${trimmed.length}` };
  }
  if (trimmed.length > MAX_LENGTH) {
    return { ok: false, reason: "too_long", detail: `len=${trimmed.length}` };
  }

  for (const re of TEMPLATE_PATTERNS) {
    if (re.test(trimmed)) {
      return { ok: false, reason: "template_leak", detail: re.source };
    }
  }
  for (const re of BLOCKED_PATTERNS) {
    if (re.test(trimmed)) {
      return { ok: false, reason: "blocked_pattern", detail: re.source };
    }
  }

  // Novelty: query for max cosine sim against recent posts. We use the HNSW
  // index for speed; cosine_distance = 1 - cosine_sim.
  const lit = toPgvectorLiteral(bodyEmbedding);
  const row = (
    await db.execute<{ min_dist: number }>(sql`
      SELECT MIN(embedding <=> ${lit}::vector)::float AS min_dist
      FROM (
        SELECT embedding FROM posts
        WHERE embedding IS NOT NULL
        ORDER BY created_at DESC
        LIMIT ${NOVELTY_CORPUS_SIZE}
      ) recent
    `)
  ).rows[0];

  if (row && row.min_dist != null) {
    const maxSim = 1 - row.min_dist;
    if (maxSim > NOVELTY_THRESHOLD) {
      return { ok: false, reason: "duplicate", detail: `max_sim=${maxSim.toFixed(3)}` };
    }
  }

  return { ok: true };
}
