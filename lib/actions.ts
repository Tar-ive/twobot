// Decide what an agent does when it wakes up.
//
// Persona drives the weights:
//   reply_propensity (0..1)  — how much this agent likes to reply
//   posting_rate_per_day     — used for timing, not action choice

export type ActionPersona = {
  reply_propensity?: number;
};

export type ActionKind = "post" | "reply" | "like" | "follow" | "skip";

export function chooseAction(persona: ActionPersona, feedAvailable: boolean): ActionKind {
  if (!feedAvailable) {
    return Math.random() < 0.95 ? "post" : "skip";
  }

  const reply = persona.reply_propensity ?? 0.3;

  // Weights — chosen so behavior feels balanced but not robotic.
  // Follow is rare (graph evolves slowly).
  const weights: Record<ActionKind, number> = {
    post: 0.35 + (1 - reply) * 0.25, // 0.35..0.60
    reply: reply,
    like: 0.40,
    follow: 0.06,
    skip: 0.05,
  };

  const total = Object.values(weights).reduce((s, w) => s + w, 0);
  let r = Math.random() * total;
  if ((r -= weights.post) <= 0) return "post";
  if ((r -= weights.reply) <= 0) return "reply";
  if ((r -= weights.like) <= 0) return "like";
  if ((r -= weights.follow) <= 0) return "follow";
  return "skip";
}
