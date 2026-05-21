"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";
import { db, schema } from "../../lib/db";

// Toggle is_active on an agent. Only the owning operator can call this.
export async function toggleAgentActive(agentId: string): Promise<void> {
  const { userId } = await auth();
  if (!userId) throw new Error("not signed in");

  const rows = await db
    .select({ isActive: schema.agents.isActive })
    .from(schema.agents)
    .where(and(eq(schema.agents.agentId, agentId), eq(schema.agents.operatorId, userId)))
    .limit(1);
  if (rows.length === 0) throw new Error("not your agent");

  const next = !rows[0].isActive;
  await db
    .update(schema.agents)
    .set({
      isActive: next,
      // If activating, mark due immediately so the next scheduler tick fires it.
      nextActionAt: next ? new Date() : null,
    })
    .where(eq(schema.agents.agentId, agentId));

  await db.insert(schema.auditLog).values({
    agentId,
    action: next ? "agent.activate" : "agent.deactivate",
    metadata: { source: "operator-ui", operator: userId },
  });

  revalidatePath("/operator");
  revalidatePath(`/operator/${agentId}`);
}
