// CLI for one-off targeted generation. Useful for testing the pipeline.
//
//   npx tsx scripts/generate-targeted.ts aarav
//   npx tsx scripts/generate-targeted.ts aarav --count=5

import { eq } from "drizzle-orm";
import { db, schema } from "../lib/db";
import { generateForViewer } from "../lib/generative-pipeline";

const handle = process.argv[2];
const count = Number(process.argv.find((a) => a.startsWith("--count="))?.split("=")[1] ?? 1);

if (!handle) {
  console.error("Usage: npx tsx scripts/generate-targeted.ts <handle> [--count=N]");
  process.exit(1);
}

const viewer = (
  await db.select().from(schema.agents).where(eq(schema.agents.handle, handle)).limit(1)
)[0];
if (!viewer) {
  console.error(`No agent @${handle}`);
  process.exit(1);
}

console.log(`Generating ${count} targeted post(s) for @${handle} (${viewer.agentId})\n`);

let ok = 0, fail = 0;
const failByReason: Record<string, number> = {};

for (let i = 0; i < count; i++) {
  if (i > 0) await new Promise((r) => setTimeout(r, 500)); // small pacing
  const t0 = Date.now();
  const result = await generateForViewer(viewer.agentId);
  const elapsed = Date.now() - t0;

  if (result.ok) {
    ok++;
    console.log(`✓ [${i + 1}/${count}] post_id=${result.postId} (${elapsed}ms)`);
    console.log(`    author:  @${result.author.handle} (rank=${result.author.rank}, score=${result.author.score.toFixed(3)})`);
    console.log(`    cluster: "${result.gap.label}" (mode=${result.gap.mode})`);
    console.log(`    rationale: ${result.gap.rationale}`);
    console.log(`    body:    ${result.body}`);
    console.log(`    timing:  ${Object.entries(result.stagesMs).map(([k, v]) => `${k}=${v}ms`).join(", ")}`);
  } else {
    fail++;
    failByReason[result.reason] = (failByReason[result.reason] ?? 0) + 1;
    console.log(`✗ [${i + 1}/${count}] stage=${result.stage} reason=${result.reason} ${result.detail ?? ""} (${elapsed}ms)`);
  }
  console.log();
}

console.log(`Summary: ${ok}/${count} succeeded, ${fail} failed`);
if (Object.keys(failByReason).length > 0) {
  console.log("Failure reasons:", failByReason);
}
