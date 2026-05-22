import "dotenv/config";
import OpenAI from "openai";

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) throw new Error("OPENAI_API_KEY missing in .env");

const client = new OpenAI({ apiKey });

const MODEL = process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small";
// 1536 dims (default) for text-embedding-3-small. Matches our schema.

export async function embed(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const res = await client.embeddings.create({
    model: MODEL,
    input: texts,
  });
  return res.data.map((r) => r.embedding);
}

export async function embedOne(text: string): Promise<number[]> {
  const [vec] = await embed([text]);
  return vec;
}

// Mean of vectors. Used for building viewer preference vector from likes.
export function meanVector(vecs: number[][]): number[] | null {
  if (vecs.length === 0) return null;
  const dim = vecs[0].length;
  const out = new Array(dim).fill(0);
  for (const v of vecs) for (let i = 0; i < dim; i++) out[i] += v[i];
  for (let i = 0; i < dim; i++) out[i] /= vecs.length;
  return out;
}

// Helper to convert a number[] into the literal pgvector string Postgres expects:
//   '[0.1,0.2,...]'
export function toPgvectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}

// -----------------------------------------------------------------------------
// Chat completion via a small OpenAI model. Used for the generative candidate
// pipeline as a fallback when MiniMax hits its daily quota.
// -----------------------------------------------------------------------------
const CHAT_MODEL = process.env.OPENAI_CHAT_MODEL ?? "gpt-4o-mini";

export async function generateChat(opts: {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  model?: string;
}): Promise<string> {
  const res = await client.chat.completions.create({
    model: opts.model ?? CHAT_MODEL,
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
    max_tokens: opts.maxTokens ?? 200,
    temperature: opts.temperature ?? 0.8,
  });
  const content = res.choices?.[0]?.message?.content;
  if (!content || !content.trim()) {
    throw new Error(`OpenAI chat: empty content (finish=${res.choices?.[0]?.finish_reason})`);
  }
  return content.trim();
}

