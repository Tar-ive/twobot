// Replicate CLIP wrapper — given an image URL, return its CLIP embedding.
//
// Uses andreasjansson/clip-features (a popular ViT-L/14 wrapper).
// Output: 768-d float vector.
//
// Free tier on Replicate is pay-as-you-go — about $0.0006 per inference.

import "dotenv/config";

const REPLICATE_API = "https://api.replicate.com/v1";
const TOKEN = process.env.REPLICATE_API_TOKEN;

// CLIP ViT-L/14 features — popular, stable, 768-d output
// (model versions are pinned by hash for stability)
const CLIP_MODEL =
  "andreasjansson/clip-features:75b33f253f7714a281ad3e9b28f63e3232d583716ef6718f2e46641077ea040a";
export const CLIP_EMBED_DIM = 768;

if (!TOKEN) console.warn("REPLICATE_API_TOKEN missing — clipEmbed will throw");

// Poll a prediction until it's done. Replicate predictions are async.
async function pollPrediction(predictionId: string, timeoutMs = 60_000): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${REPLICATE_API}/predictions/${predictionId}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    if (!res.ok) throw new Error(`Replicate poll failed: ${res.status}`);
    const json: any = await res.json();
    if (json.status === "succeeded") return json;
    if (json.status === "failed" || json.status === "canceled") {
      throw new Error(`Prediction ${json.status}: ${json.error ?? "(no error)"}`);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Prediction timeout after ${timeoutMs}ms`);
}

export async function clipEmbed(imageUrl: string): Promise<number[]> {
  if (!TOKEN) throw new Error("REPLICATE_API_TOKEN not configured");
  const res = await fetch(`${REPLICATE_API}/predictions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      version: CLIP_MODEL.split(":")[1],
      input: { inputs: imageUrl },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Replicate create failed: ${res.status} ${body.slice(0, 200)}`);
  }
  const json: any = await res.json();
  const finished = await pollPrediction(json.id);
  // Output shape: [{ input: "...", embedding: [768 floats] }]
  const output = finished.output;
  const arr = Array.isArray(output) ? output[0]?.embedding : output?.embedding;
  if (!Array.isArray(arr)) {
    throw new Error(`Unexpected clip output: ${JSON.stringify(output).slice(0, 200)}`);
  }
  return arr;
}
