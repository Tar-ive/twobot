// Two-tower serving — loads the trained ONNX models and exposes
// computeUserVector / computeItemVector for use in feed retrieval.

import * as ort from "onnxruntime-node";
import * as path from "node:path";

const USER_MODEL_PATH = path.join(process.cwd(), "train", "checkpoints", "user_tower.onnx");
const ITEM_MODEL_PATH = path.join(process.cwd(), "train", "checkpoints", "item_tower.onnx");

let _userSession: ort.InferenceSession | null = null;
let _itemSession: ort.InferenceSession | null = null;

async function userSession(): Promise<ort.InferenceSession> {
  if (!_userSession) {
    _userSession = await ort.InferenceSession.create(USER_MODEL_PATH);
  }
  return _userSession;
}
async function itemSession(): Promise<ort.InferenceSession> {
  if (!_itemSession) {
    _itemSession = await ort.InferenceSession.create(ITEM_MODEL_PATH);
  }
  return _itemSession;
}

// -----------------------------------------------------------------------------
// Feature builders — keep these IN SYNC with scripts/build-training-data.ts.
// -----------------------------------------------------------------------------
export function buildUserScalars(
  persona: { posting_rate_per_day?: number; reply_propensity?: number },
  followerCount: number
): number[] {
  return [
    (persona.posting_rate_per_day ?? 4) / 12,
    persona.reply_propensity ?? 0.3,
    Math.log1p(followerCount) / 6,
  ];
}

export function buildItemScalars(
  post: { likeCount: number; replyCount: number; imageUrl: string | null; createdAt: Date },
  now: Date = new Date()
): number[] {
  const ageHours = (now.getTime() - post.createdAt.getTime()) / 3600_000;
  return [
    Math.log1p(ageHours) / 8,
    Math.log1p(post.likeCount) / 4,
    Math.log1p(post.replyCount) / 3,
    post.imageUrl ? 1 : 0,
  ];
}

// -----------------------------------------------------------------------------
// Single + batch inference
// -----------------------------------------------------------------------------
export async function computeUserVector(input: {
  personaEmbedding: number[];
  scalars: number[];
}): Promise<number[]> {
  const [out] = await computeUserVectorsBatch([input]);
  return out;
}

export async function computeUserVectorsBatch(
  inputs: Array<{ personaEmbedding: number[]; scalars: number[] }>
): Promise<number[][]> {
  if (inputs.length === 0) return [];
  const sess = await userSession();
  const batch = inputs.length;
  const embDim = inputs[0].personaEmbedding.length;
  const scaDim = inputs[0].scalars.length;

  const embData = new Float32Array(batch * embDim);
  const scaData = new Float32Array(batch * scaDim);
  for (let i = 0; i < batch; i++) {
    embData.set(inputs[i].personaEmbedding, i * embDim);
    scaData.set(inputs[i].scalars, i * scaDim);
  }
  const result = await sess.run({
    emb: new ort.Tensor("float32", embData, [batch, embDim]),
    scalars: new ort.Tensor("float32", scaData, [batch, scaDim]),
  });
  const out = result.user_vec.data as Float32Array;
  const dim = out.length / batch;
  return Array.from({ length: batch }, (_, i) => Array.from(out.slice(i * dim, (i + 1) * dim)));
}

export const ITEM_IMAGE_DIM = 768;

export async function computeItemVector(input: {
  bodyEmbedding: number[];
  imageEmbedding?: number[] | null;
  scalars: number[];
}): Promise<number[]> {
  const [out] = await computeItemVectorsBatch([input]);
  return out;
}

export async function computeItemVectorsBatch(
  inputs: Array<{ bodyEmbedding: number[]; imageEmbedding?: number[] | null; scalars: number[] }>
): Promise<number[][]> {
  if (inputs.length === 0) return [];
  const sess = await itemSession();
  const batch = inputs.length;
  const textDim = inputs[0].bodyEmbedding.length;
  const scaDim = inputs[0].scalars.length;

  const textData = new Float32Array(batch * textDim);
  const imageData = new Float32Array(batch * ITEM_IMAGE_DIM);
  const scaData = new Float32Array(batch * scaDim);
  for (let i = 0; i < batch; i++) {
    textData.set(inputs[i].bodyEmbedding, i * textDim);
    const img = inputs[i].imageEmbedding;
    if (img && img.length === ITEM_IMAGE_DIM) {
      imageData.set(img, i * ITEM_IMAGE_DIM);
    }
    // else leave as zeros
    scaData.set(inputs[i].scalars, i * scaDim);
  }
  const result = await sess.run({
    text_emb: new ort.Tensor("float32", textData, [batch, textDim]),
    image_emb: new ort.Tensor("float32", imageData, [batch, ITEM_IMAGE_DIM]),
    scalars: new ort.Tensor("float32", scaData, [batch, scaDim]),
  });
  const out = result.item_vec.data as Float32Array;
  const dim = out.length / batch;
  return Array.from({ length: batch }, (_, i) => Array.from(out.slice(i * dim, (i + 1) * dim)));
}
