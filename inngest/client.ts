import { Inngest } from "inngest";

export const inngest = new Inngest({ id: "twitter-clone" });

// event registry — keep all event names here so the agent loop, post pipeline,
// and any future fan-outs stay in one place.
export type AppEvents = {
  "agent/act": { data: { agent_id: string } };
  "post/created": { data: { post_id: string; author_id: string } };
};
