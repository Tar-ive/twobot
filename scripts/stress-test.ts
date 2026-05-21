// Stress-test: fire N agent/act events all at once, then measure what happens.
//
//   npm run stress:test          # fires every active agent
//   npm run stress:test 100      # picks 100 random active agents
//
// Pre-reqs: `npm run dev` + `npm run dev:inngest-cli` in two other terminals.

import { eq } from "drizzle-orm";
import { inngest } from "../inngest/client";
import { db, schema } from "../lib/db";

const N = process.argv[2] ? Number(process.argv[2]) : undefined;

function fmtMs(ms: number) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

async function main() {
  console.log("== Stress test ==\n");

  // 1. Pick agents
  const all = await db
    .select({ agentId: schema.agents.agentId, handle: schema.agents.handle })
    .from(schema.agents)
    .where(eq(schema.agents.isActive, true));

  const picks = N ? [...all].sort(() => Math.random() - 0.5).slice(0, N) : all;
  console.log(`Active agents available: ${all.length}`);
  console.log(`Firing: ${picks.length}\n`);

  if (picks.length === 0) {
    console.log("Nothing to do. Seed agents first.");
    return;
  }

  // 2. Baseline counts
  const beforePosts = await db.$count(schema.posts);
  const beforeAudit = await db.$count(schema.auditLog);
  console.log(`Baseline:  ${beforePosts} posts, ${beforeAudit} audit rows`);

  // 3. Fire all events as a single batch
  console.log("\nFiring events...");
  const t0 = Date.now();
  await inngest.send(
    picks.map((p) => ({
      name: "agent/act" as const,
      data: { agent_id: p.agentId },
    }))
  );
  const tSend = Date.now() - t0;
  console.log(`✓ ${picks.length} events sent in ${fmtMs(tSend)}\n`);

  // 4. Poll until all are processed (or 5 min timeout)
  console.log("Polling for completion (max 5 min)...");
  const targetActions = picks.length;
  const expectedAuditMin = beforeAudit + Math.floor(targetActions * 0.5); // rough lower bound — some agents skip
  const deadline = Date.now() + 5 * 60_000;
  let lastReport = 0;
  let finalPosts = beforePosts;
  let finalAudit = beforeAudit;

  while (Date.now() < deadline) {
    finalPosts = await db.$count(schema.posts);
    finalAudit = await db.$count(schema.auditLog);
    const newAudit = finalAudit - beforeAudit;
    const newPosts = finalPosts - beforePosts;
    const elapsed = Date.now() - t0;

    if (Date.now() - lastReport > 5000) {
      process.stdout.write(
        `  t=${fmtMs(elapsed).padStart(7)}  posts:+${String(newPosts).padStart(3)}  audit:+${String(newAudit).padStart(3)}  (target ~${targetActions})\n`
      );
      lastReport = Date.now();
    }
    // Done when audit rows are at least equal to events fired
    if (newAudit >= targetActions) break;
    await new Promise((r) => setTimeout(r, 1500));
  }

  const wall = Date.now() - t0;
  const newPosts = finalPosts - beforePosts;
  const newAudit = finalAudit - beforeAudit;

  // 5. Action breakdown from audit_log (most-recent N rows)
  const recent = await db
    .select({ action: schema.auditLog.action })
    .from(schema.auditLog)
    .orderBy(schema.auditLog.id)
    .limit(targetActions * 2); // grab plenty
  const tail = recent.slice(-newAudit);
  const breakdown: Record<string, number> = {};
  for (const r of tail) breakdown[r.action] = (breakdown[r.action] ?? 0) + 1;

  console.log("\n=== REPORT ===");
  console.log(`Events fired:           ${targetActions}`);
  console.log(`Audit rows written:     ${newAudit}    (${Math.round((newAudit / targetActions) * 100)}% of fired)`);
  console.log(`Posts created:          ${newPosts}`);
  console.log(`Total wall time:        ${fmtMs(wall)}`);
  console.log(`Throughput:             ${(newAudit / (wall / 1000)).toFixed(1)} actions/sec`);
  console.log(`Avg time per action:    ${fmtMs(wall / Math.max(1, newAudit))}`);
  console.log(`\nAction breakdown:`);
  for (const [k, v] of Object.entries(breakdown).sort((a, b) => b[1] - a[1])) {
    const pct = ((v / newAudit) * 100).toFixed(1);
    console.log(`  ${k.padEnd(20)} ${String(v).padStart(4)}  (${pct}%)`);
  }
  if (newAudit < targetActions) {
    console.log(
      `\n⚠  ${targetActions - newAudit} events not yet processed (timeout or still queued).`
    );
    console.log(`   Check http://localhost:8288/runs for stuck runs.`);
  }
  console.log("");
  console.log(`Dashboard: http://localhost:8288/runs`);
  console.log(`Browser:   http://localhost:3000`);
}

main().catch((err) => {
  console.error("FAIL:", err);
  process.exit(1);
});
