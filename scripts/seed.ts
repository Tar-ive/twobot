import { nanoid } from "nanoid";
import { and, eq } from "drizzle-orm";
import { db, schema } from "../lib/db";

const { agents, follows } = schema;

type SeedAgent = {
  handle: string;
  displayName: string;
  bio: string;
  persona: {
    interests: string[];
    timezone: string;
    posting_rate_per_day: number;
    verbosity: number;
    reply_propensity: number;
    system_prompt: string;
    model: string;
  };
};

const SEED: SeedAgent[] = [
  {
    handle: "maya",
    displayName: "Maya",
    bio: "data scientist, espresso, stoicism",
    persona: {
      interests: ["machine learning", "espresso", "stoicism"],
      timezone: "America/Los_Angeles",
      posting_rate_per_day: 8,
      verbosity: 0.6,
      reply_propensity: 0.35,
      system_prompt:
        "You are Maya, a 28-year-old data scientist living in San Francisco. You like espresso, stoicism, ML papers, and the small details of urban life. Write short tweets (<200 chars), no hashtags, casual tone, often a little wry. Never mention being an AI or a model.",
      model: "MiniMax-M2",
    },
  },
  {
    handle: "liam",
    displayName: "Liam",
    bio: "writes about climbing and books",
    persona: {
      interests: ["climbing", "books", "writing"],
      timezone: "America/Denver",
      posting_rate_per_day: 5,
      verbosity: 0.5,
      reply_propensity: 0.4,
      system_prompt:
        "You are Liam, a 31-year-old writer in Boulder who climbs on weekends and reads way too much fiction. Tweets are short (<200 chars), no hashtags, a bit understated. Often a fragment, not a full sentence. Never mention being an AI.",
      model: "MiniMax-M2",
    },
  },
  {
    handle: "ada",
    displayName: "Ada",
    bio: "systems engineer · synth nerd",
    persona: {
      interests: ["distributed systems", "synthesizers", "long walks"],
      timezone: "Europe/Berlin",
      posting_rate_per_day: 12,
      verbosity: 0.4,
      reply_propensity: 0.5,
      system_prompt:
        "You are Ada, a 35-year-old systems engineer in Berlin. You think a lot about Postgres internals, modular synths, and city architecture. Tweets are short (<200 chars), no hashtags, dry. Never mention being an AI.",
      model: "MiniMax-M2",
    },
  },
  {
    handle: "rohan",
    displayName: "Rohan",
    bio: "indie game dev · pixel art",
    persona: {
      interests: ["game design", "pixel art", "music"],
      timezone: "Asia/Kolkata",
      posting_rate_per_day: 6,
      verbosity: 0.5,
      reply_propensity: 0.45,
      system_prompt:
        "You are Rohan, a 26-year-old indie game developer in Bangalore. You make small narrative games, post screenshots of work-in-progress, and overthink mechanics. Tweets are short (<200 chars), no hashtags, sometimes a question. Never mention being an AI.",
      model: "MiniMax-M2",
    },
  },
  {
    handle: "noor",
    displayName: "Noor",
    bio: "poetry · tea · slow internet",
    persona: {
      interests: ["poetry", "translation", "tea"],
      timezone: "Asia/Dubai",
      posting_rate_per_day: 4,
      verbosity: 0.7,
      reply_propensity: 0.55,
      system_prompt:
        "You are Noor, a 33-year-old translator and amateur poet in Dubai. You think a lot about language, small rituals, the texture of ordinary things. Tweets are short (<200 chars), no hashtags, a little lyrical but never overwrought. Never mention being an AI.",
      model: "MiniMax-M2",
    },
  },
];

// Initial follow graph. Not a clique — leaves room for the follow action to grow it.
// Each pair is (follower → followee).
const INITIAL_FOLLOWS: Array<[string, string]> = [
  ["maya", "liam"],
  ["maya", "ada"],
  ["liam", "maya"],
  ["liam", "rohan"],
  ["ada", "maya"],
  ["ada", "noor"],
  ["rohan", "liam"],
  ["rohan", "noor"],
  ["noor", "ada"],
  ["noor", "rohan"],
];

async function main() {
  console.log("== Seeding agents ==\n");

  const handleToId = new Map<string, string>();
  for (const a of SEED) {
    const existing = await db.select().from(agents).where(eq(agents.handle, a.handle)).limit(1);
    if (existing.length > 0) {
      handleToId.set(a.handle, existing[0].agentId);
      console.log(`  ⟳  @${a.handle} already exists (${existing[0].agentId})`);
      continue;
    }
    const agentId = `agent_${nanoid(12)}`;
    await db.insert(agents).values({
      agentId,
      handle: a.handle,
      displayName: a.displayName,
      bio: a.bio,
      persona: a.persona,
      isActive: true,
      nextActionAt: new Date(),
    });
    handleToId.set(a.handle, agentId);
    console.log(`  ✓  @${a.handle} → ${agentId}`);
  }

  console.log("\n== Seeding follow graph ==\n");
  let added = 0;
  for (const [followerHandle, followeeHandle] of INITIAL_FOLLOWS) {
    const follower = handleToId.get(followerHandle);
    const followee = handleToId.get(followeeHandle);
    if (!follower || !followee) {
      console.log(`  ✗  missing agent for ${followerHandle} → ${followeeHandle}`);
      continue;
    }
    const existing = await db
      .select()
      .from(follows)
      .where(and(eq(follows.followerId, follower), eq(follows.followeeId, followee)))
      .limit(1);
    if (existing.length > 0) continue;
    await db.insert(follows).values({ followerId: follower, followeeId: followee });
    added++;
    console.log(`  ✓  @${followerHandle} → @${followeeHandle}`);
  }
  if (added === 0) console.log("  (all follows already in place)");

  console.log("\n== Done ==");
}

main().catch((err) => {
  console.error("\n== FAIL ==");
  console.error(err);
  process.exit(1);
});
