import "dotenv/config";

const MINIMAX_BASE = process.env.MINIMAX_BASE_URL ?? "https://api.minimax.io/v1";
const API_KEY = process.env.MINIMAX_API_KEY;
const GROUP_ID = process.env.MINIMAX_GROUP_ID;

if (!API_KEY) {
  throw new Error("MINIMAX_API_KEY missing in .env");
}

type Message = { role: "system" | "user" | "assistant"; content: string };

export type GenerateArgs = {
  model?: string;
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
};

export async function generate(args: GenerateArgs): Promise<string> {
  const model = args.model ?? "MiniMax-Text-01";
  const messages: Message[] = [
    { role: "system", content: args.system },
    { role: "user", content: args.user },
  ];

  const res = await fetch(`${MINIMAX_BASE}/text/chatcompletion_v2`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: args.maxTokens ?? 256,
      temperature: args.temperature ?? 0.9,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`MiniMax generate failed: ${res.status} ${body}`);
  }

  const json: any = await res.json();
  const text = json?.choices?.[0]?.message?.content;
  if (typeof text !== "string") {
    const code = json?.base_resp?.status_code;
    const msg = json?.base_resp?.status_msg;
    if (code !== undefined) {
      throw new Error(`MiniMax generate: ${code} — ${msg}`);
    }
    throw new Error(`MiniMax generate: unexpected shape: ${JSON.stringify(json).slice(0, 400)}`);
  }
  return text;
}

export type EmbedArgs = {
  texts: string[];
  type?: "db" | "query";
  model?: string;
};

export async function embed(args: EmbedArgs): Promise<number[][]> {
  const model = args.model ?? "embo-01";
  const type = args.type ?? "db";

  const url = GROUP_ID
    ? `${MINIMAX_BASE}/embeddings?GroupId=${encodeURIComponent(GROUP_ID)}`
    : `${MINIMAX_BASE}/embeddings`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, texts: args.texts, type }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`MiniMax embed failed: ${res.status} ${body}`);
  }

  const json: any = await res.json();
  const vectors = json?.vectors;
  if (!Array.isArray(vectors)) {
    const code = json?.base_resp?.status_code;
    const msg = json?.base_resp?.status_msg;
    if (code !== undefined) {
      const err: any = new Error(`MiniMax embed: ${code} — ${msg}`);
      err.code = code;
      throw err;
    }
    throw new Error(`MiniMax embed: unexpected shape: ${JSON.stringify(json).slice(0, 400)}`);
  }
  return vectors;
}

export async function embedWithRetry(args: EmbedArgs, opts: { retries?: number; delayMs?: number } = {}): Promise<number[][]> {
  const retries = opts.retries ?? 3;
  const delayMs = opts.delayMs ?? 2000;
  for (let i = 0; i <= retries; i++) {
    try {
      return await embed(args);
    } catch (e: any) {
      const isRateLimit = e?.code === 1002 || /rate limit/i.test(e?.message ?? "");
      if (i < retries && isRateLimit) {
        const wait = delayMs * Math.pow(2, i);
        console.warn(`  embed rate-limited (attempt ${i + 1}/${retries + 1}), waiting ${wait}ms...`);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      throw e;
    }
  }
  throw new Error("unreachable");
}
