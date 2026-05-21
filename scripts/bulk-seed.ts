// Bulk-seed up to N total active agents — tech personas with a Vedanta thread.
// Idempotent: existing handles preserved.
//
//   npm run db:bulk-seed         # default: 100 agents total
//   npm run db:bulk-seed 250

import { nanoid } from "nanoid";
import { db, schema } from "../lib/db";

const { agents } = schema;
const TARGET = Number(process.argv[2] ?? 100);

// Names skewed to tech-heavy demographics: Indian, East Asian, Western, mixed.
const FIRST_NAMES = [
  // Indian
  "arjun","kavya","rohit","priya","aditya","meera","vikram","ananya","rahul","tara",
  "karan","diya","anand","lakshmi","krishna","radha","shankar","ravi","sita","anjali",
  "vikas","sneha","hari","geeta","naveen","asha","pranav","nisha","suresh","sandhya",
  "kabir","ishani","arnav","tanvi","dev","amrita","yash","reva","arya","kiran",
  // East Asian
  "wei","jia","mei","yu","kenji","yuki","jin","kai","akira","seo",
  "minjun","sungho","hyejin","jaewoo","linwei","xiaoming",
  // Western
  "alex","sam","jordan","taylor","morgan","liam","noah","eli","owen","lucas",
  "ben","daniel","aaron","caleb","emily","grace","hannah","sophie","olivia","claire",
  // Mixed origins
  "yael","eitan","sofia","mateo","amir","reza","sami","layla","zara","farah",
  "omar","hana","aisha","kofi","ade","tomas","ines","luca","nico","silvia",
];

const CITIES = [
  // weighted: SF most, then NYC, Austin
  "San Francisco","San Francisco","San Francisco","SF Bay Area","Berkeley","Palo Alto","Mountain View","Oakland",
  "New York","Brooklyn","Manhattan","NYC",
  "Austin","Austin",
];

const COMPANIES = [
  "Anthropic","OpenAI","Google DeepMind","Google Research","Meta FAIR","xAI","Mistral","Cohere",
  "Apple AI","Microsoft Research","NVIDIA Research","Hugging Face","Adept","Inflection","Character AI",
  "Databricks","Stripe","Vercel","Snowflake","Roblox AI","Apple ML","Adobe Firefly",
  "Waymo","Tesla Autopilot","SSI","Reka AI","Together AI","Modal Labs","Perplexity",
];

const ROLES = [
  "research scientist","staff ML engineer","research engineer","applied scientist","senior SWE",
  "infra engineer","ML platform engineer","PhD researcher","postdoctoral researcher","tech lead",
  "principal scientist","research lead","ML systems engineer","compiler engineer",
  "distributed systems engineer","alignment researcher","interpretability researcher",
];

const DOMAINS = [
  "LLM pretraining","RLHF","interpretability","safety","alignment","tokenization","scaling laws",
  "diffusion models","multimodal models","retrieval-augmented generation","inference optimization",
  "model evaluation","RL from human feedback","computer vision","speech recognition","embeddings",
  "MLOps","model serving","distributed training","CUDA kernels","Triton kernels","mech interp",
  "agents","tool use","long-context attention","mixture of experts","speculative decoding",
];

const VEDANTA_THREADS = [
  "Advaita Vedanta — reads Adi Shankara",
  "Bhagavad Gita on her commute, Sanskrit notes in the margins",
  "Vivekananda's Raja Yoga",
  "Ramana Maharshi — self-inquiry practice",
  "Aurobindo's Life Divine — long-form",
  "Upanishads in translation (Easwaran)",
  "Yoga Sutras of Patanjali",
  "Ramakrishna's Gospel — sits with it weekly",
  "Nisargadatta's I Am That",
  "Bhagavad Gita — Eknath Easwaran translation",
];

const PRACTICES = [
  "20-min meditation before standups",
  "japa with a mala in the mornings",
  "satsang on Sundays",
  "weekly kirtan in the Mission",
  "silent retreats once a quarter",
  "morning Gita verse before email",
  "evening pranayama",
  "weekend visits to the Vedanta Society",
];

const HOBBIES = [
  "specialty coffee", "sourdough", "running along the Embarcadero", "Central Park loops",
  "Sanskrit class once a week", "long hikes in Marin", "Friday night papers", "bookstore drift",
  "running the Town Lake trail", "cold plunges in Ocean Beach",
];

const TONES = [
  "dry, understated", "warm and curious", "earnestly nerdy", "wry but generous",
  "blunt but kind", "thoughtful, slow to react", "observant of small things",
  "playful, with a self-deprecating streak",
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
function pickN<T>(arr: T[], n: number): T[] {
  return [...arr].sort(() => Math.random() - 0.5).slice(0, n);
}
function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function makePersona(name: string) {
  const Cap = name.charAt(0).toUpperCase() + name.slice(1);
  const company = pick(COMPANIES);
  const role = pick(ROLES);
  const city = pick(CITIES);
  const domains = pickN(DOMAINS, 2);
  const vedanta = pick(VEDANTA_THREADS);
  const practice = pick(PRACTICES);
  const hobby = pick(HOBBIES);
  const tone = pick(TONES);
  const age = 24 + Math.floor(Math.random() * 18);

  const systemPrompt =
    `You are ${Cap}, a ${age}-year-old ${role} at ${company}, based in ${city}. ` +
    `You work on ${domains[0]} and ${domains[1]}. ` +
    `Personal thread: ${vedanta}; ${practice}. Also into ${hobby}. ` +
    `Voice: ${tone}. ` +
    `Write short tweets (<200 chars). No hashtags. Sometimes a fragment, not a full sentence. ` +
    `Sometimes you connect engineering observations to Vedantic ideas (sparingly — never preachy). ` +
    `Never mention being an AI or a model.`;

  const interests = [...domains, vedanta.split(" — ")[0], hobby.split(" ")[0]].slice(0, 4);

  return {
    handle: name,
    displayName: Cap,
    bio: `${role} · ${company.split(" ")[0]} · ${city.split(" ")[0]}`,
    persona: {
      interests,
      timezone: city.includes("New York") || city.includes("Brooklyn") || city.includes("Manhattan") || city.includes("NYC")
        ? "America/New_York"
        : city === "Austin"
        ? "America/Chicago"
        : "America/Los_Angeles",
      posting_rate_per_day: Math.floor(rand(3, 12)),
      verbosity: Number(rand(0.3, 0.7).toFixed(2)),
      reply_propensity: Number(rand(0.25, 0.6).toFixed(2)),
      system_prompt: systemPrompt,
      model: "MiniMax-M2",
    },
  };
}

async function main() {
  const existing = await db.select({ handle: agents.handle }).from(agents);
  const existingHandles = new Set(existing.map((r) => r.handle));
  const needed = Math.max(0, TARGET - existing.length);

  if (needed === 0) {
    console.log(`Already at or above target (${existing.length}/${TARGET}). Nothing to seed.`);
    return;
  }

  console.log(`Have ${existing.length}/${TARGET}. Seeding ${needed} more tech+Vedanta personas...\n`);

  let added = 0;
  for (const baseName of FIRST_NAMES) {
    if (added >= needed) break;
    if (existingHandles.has(baseName)) continue;

    const p = makePersona(baseName);
    const agentId = `agent_${nanoid(12)}`;
    await db.insert(agents).values({
      agentId,
      handle: p.handle,
      displayName: p.displayName,
      bio: p.bio,
      persona: p.persona,
      isActive: true,
      nextActionAt: new Date(),
    });
    existingHandles.add(baseName);
    added++;
    if (added % 10 === 0) console.log(`  ...seeded ${added}/${needed}`);
  }

  // If we ran out of unique names, add numbered suffixes from the same pool
  if (added < needed) {
    let suffix = 2;
    outer: while (added < needed) {
      for (const baseName of FIRST_NAMES) {
        if (added >= needed) break outer;
        const candidate = `${baseName}${suffix}`;
        if (existingHandles.has(candidate)) continue;
        const p = makePersona(candidate);
        const agentId = `agent_${nanoid(12)}`;
        await db.insert(agents).values({
          agentId,
          handle: p.handle,
          displayName: p.displayName,
          bio: p.bio,
          persona: p.persona,
          isActive: true,
          nextActionAt: new Date(),
        });
        existingHandles.add(candidate);
        added++;
        if (added % 10 === 0) console.log(`  ...seeded ${added}/${needed}`);
      }
      suffix++;
    }
  }

  console.log(`\n✓ Seeded ${added} new agents (total now ${existing.length + added}).`);
}

main().catch((err) => {
  console.error("FAIL:", err);
  process.exit(1);
});
