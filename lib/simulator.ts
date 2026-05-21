// Engagement simulator — given an agent's hidden preference vector
// (we use persona_embedding as truth) and a post's text embedding, sample a
// realistic engagement decision.
//
// The model NEVER sees persona_embedding directly during ranking — only the
// 128-d learned projection out of user_tower. So this simulator generates
// "ground truth" engagement that the model has to learn to predict.

export type SimAction = "LIKE" | "REPLY" | "SHARE" | "SKIP" | "NOT_INTERESTED";

function cosine(a: number[], b: number[]): number {
  let dot = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-9);
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

export type SimInput = {
  hiddenPrefVec: number[]; // 1536-d persona embedding
  postEmbedding: number[]; // 1536-d body embedding
  postImageEmbedding?: number[] | null; // optional 768-d CLIP
  isFollowed: boolean;
  replyPropensity: number;
};

export type SimResult = {
  action: SimAction;
  positive: boolean; // LIKE/REPLY/SHARE = true; SKIP/NOT_INTERESTED = false
  cosine: number; // similarity score (for logging)
  posProb: number; // probability of positive action (for diagnostics)
  dwellMs: number; // simulated dwell time
};

// Calibration:
//   sim ∈ [-1, 1] usually centered around 0.2–0.4 for related content
//   pos_prob = sigmoid(scale * sim - shift + bonus)
//   With scale=3, shift=0.5: at sim=0.4 → pos_prob ≈ 0.67; at sim=0.1 → ≈ 0.45
export function simulateEngagement(input: SimInput): SimResult {
  const sim = cosine(input.hiddenPrefVec, input.postEmbedding);
  const followBonus = input.isFollowed ? 0.3 : 0;
  const posProb = sigmoid(3.0 * sim - 0.5 + followBonus);

  let action: SimAction;
  let positive: boolean;

  if (Math.random() < posProb) {
    positive = true;
    // High-sim posts have a small chance to be SHARE-worthy
    if (sim > 0.55 && Math.random() < 0.06) {
      action = "SHARE";
    } else if (Math.random() < input.replyPropensity * 0.55) {
      action = "REPLY";
    } else {
      action = "LIKE";
    }
  } else {
    positive = false;
    // Strong negative when similarity is very low
    if (sim < 0.1 && Math.random() < 0.15) {
      action = "NOT_INTERESTED";
    } else {
      action = "SKIP";
    }
  }

  // Dwell time: positive engagements + higher sim = longer
  const baseDwell = positive ? 4000 : 1500;
  const simBoost = Math.max(0, sim) * 6000;
  const noise = Math.random() * 2000;
  const dwellMs = Math.round(baseDwell + simBoost + noise);

  return { action, positive, cosine: sim, posProb, dwellMs };
}
