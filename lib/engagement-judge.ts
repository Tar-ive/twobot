// Use MiniMax as a judge: ask "what would this agent do if they saw this post?"
// Returns a structured engagement decision.

import { generate } from "./minimax";

export type EngagementAction = "LIKE" | "REPLY" | "SHARE" | "SKIP" | "NOT_INTERESTED";

export type EngagementJudgment = {
  action: EngagementAction;
  replyText: string | null;
  reason: string | null;
  raw: string;
};

// The full menu of actions the LLM can pick from. Order matches the prompt;
// listing the rarer/extreme actions LAST seems to reduce LLM bias toward them.
const ACTIONS: EngagementAction[] = ["LIKE", "REPLY", "SHARE", "SKIP", "NOT_INTERESTED"];

export type JudgeInput = {
  personaSystemPrompt: string;
  agentHandle: string;
  postAuthorHandle: string;
  postBody: string;
  model?: string;
};

export async function judgeEngagement(input: JudgeInput): Promise<EngagementJudgment> {
  const userPrompt =
    `You're scrolling your feed and see this tweet by @${input.postAuthorHandle}:\n\n` +
    `"${input.postBody}"\n\n` +
    `What do you do? Respond with EXACTLY this format:\n\n` +
    `ACTION: <one of: LIKE | REPLY | SHARE | SKIP | NOT_INTERESTED>\n` +
    `REPLY: <if action is REPLY, your reply (<200 chars); otherwise leave blank>\n` +
    `REASON: <one short line explaining your choice>\n\n` +
    `Guidelines:\n` +
    `- LIKE when the post resonates with you\n` +
    `- REPLY when you have something substantive to add\n` +
    `- SHARE only when you'd actively push this to others (rare; <5%)\n` +
    `- SKIP when it's fine but not for you right now\n` +
    `- NOT_INTERESTED when the topic/author actively doesn't fit you\n\n` +
    `Be honest. Most posts should be SKIP. Stay in character.`;

  // MiniMax-M2 is a reasoning model — it spends ~150-200 tokens on chain-of-thought
  // before producing the final answer. We need ~500 budget so both fit.
  const raw = await generate({
    model: input.model ?? "MiniMax-M2",
    system: input.personaSystemPrompt,
    user: userPrompt,
    maxTokens: 500,
    temperature: 0.6,
  });

  return parseJudgment(raw);
}

export function parseJudgment(raw: string): EngagementJudgment {
  const text = raw.trim();
  const actionMatch = text.match(/ACTION:\s*(LIKE|REPLY|SHARE|SKIP|NOT[_ ]?INTERESTED)/i);
  const replyMatch = text.match(/REPLY:\s*(.*?)(?:\n[A-Z]+:|$)/s);
  const reasonMatch = text.match(/REASON:\s*(.+?)(?:\n[A-Z]+:|$)/s);

  let action: EngagementAction = "SKIP";
  if (actionMatch) {
    const raw = actionMatch[1].toUpperCase().replace(/\s/g, "_");
    if (ACTIONS.includes(raw as EngagementAction)) action = raw as EngagementAction;
  }
  const reply = replyMatch?.[1]?.trim() || null;
  const reason = reasonMatch?.[1]?.trim() || null;

  return {
    action,
    replyText: action === "REPLY" && reply ? reply.slice(0, 500) : null,
    reason: reason ? reason.slice(0, 300) : null,
    raw: text,
  };
}
