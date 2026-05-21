import { generate } from "../lib/minimax";

const MODEL = process.env.MINIMAX_MODEL ?? "MiniMax-M2";

async function main() {
  console.log("== MiniMax smoke test ==\n");
  console.log(`model: ${MODEL}\n`);

  const t0 = Date.now();
  const text = await generate({
    model: MODEL,
    system:
      "You are Maya, a 28-year-old data scientist in San Francisco who likes espresso and stoicism. Write a single short tweet (<200 chars). No hashtags.",
    user: "Compose your next tweet, given that it's a Tuesday morning.",
    maxTokens: 200,
  });
  const t1 = Date.now();

  console.log(`latency: ${t1 - t0}ms`);
  console.log(`output:  ${text.trim()}\n`);

  if (!text.trim()) {
    console.error("== WARN ==  empty output. May be a reasoning-model quirk; rerun to confirm.");
    process.exit(1);
  }
  console.log("== OK ==");
}

main().catch((err) => {
  console.error("\n== FAIL ==");
  console.error(err.message ?? err);
  process.exit(1);
});
