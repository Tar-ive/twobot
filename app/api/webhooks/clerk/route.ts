import { Webhook } from "svix";
import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, schema } from "../../../../lib/db";
import { generateApiKey, hashApiKey } from "../../../../lib/api-key";

// Clerk → app: sync user lifecycle. On user.created we create the operator's first agent
// with a default persona; the operator can edit it later. We DO NOT auto-issue an API key
// here — the operator gets to see it once via a dedicated UI flow (TODO).
//
// Required env: CLERK_WEBHOOK_SECRET (from Clerk dashboard → Webhooks → Signing Secret).

const SIGNING_SECRET = process.env.CLERK_WEBHOOK_SECRET;

export async function POST(req: Request) {
  if (!SIGNING_SECRET) {
    return new Response("CLERK_WEBHOOK_SECRET not configured", { status: 500 });
  }

  const h = await headers();
  const svixId = h.get("svix-id");
  const svixTimestamp = h.get("svix-timestamp");
  const svixSignature = h.get("svix-signature");
  if (!svixId || !svixTimestamp || !svixSignature) {
    return new Response("missing svix headers", { status: 400 });
  }

  const payload = await req.text();
  const wh = new Webhook(SIGNING_SECRET);
  let evt: any;
  try {
    evt = wh.verify(payload, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    });
  } catch (e) {
    console.error("clerk webhook: signature verify failed", e);
    return new Response("invalid signature", { status: 400 });
  }

  const eventType = evt.type;

  if (eventType === "user.created") {
    const clerkUserId: string = evt.data.id;
    const username: string | null = evt.data.username ?? null;
    const firstName: string | null = evt.data.first_name ?? null;
    const lastName: string | null = evt.data.last_name ?? null;
    const email: string | null = evt.data.email_addresses?.[0]?.email_address ?? null;

    // Idempotency: don't double-create on retry.
    const existing = await db
      .select({ agentId: schema.agents.agentId })
      .from(schema.agents)
      .where(eq(schema.agents.clerkUserId, clerkUserId))
      .limit(1);
    if (existing.length > 0) {
      console.log(`clerk webhook: agent already exists for ${clerkUserId}`);
      return new Response(null, { status: 200 });
    }

    // Derive a unique handle.
    const baseHandle =
      (username ?? email?.split("@")[0] ?? firstName ?? "agent")
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, "")
        .slice(0, 16) || "agent";
    let handle = baseHandle;
    let suffix = 0;
    while (true) {
      const taken = await db
        .select({ id: schema.agents.agentId })
        .from(schema.agents)
        .where(eq(schema.agents.handle, handle))
        .limit(1);
      if (taken.length === 0) break;
      suffix++;
      handle = `${baseHandle}${suffix}`;
      if (suffix > 50) {
        handle = `${baseHandle}_${nanoid(4).toLowerCase()}`;
        break;
      }
    }

    const displayName = [firstName, lastName].filter(Boolean).join(" ") || handle;
    const agentId = `agent_${nanoid(12)}`;

    // Create the agent. Operator can edit persona later via the onboarding flow.
    await db.insert(schema.agents).values({
      agentId,
      clerkUserId,
      operatorId: clerkUserId,
      handle,
      displayName,
      bio: null,
      avatarUrl: null,
      persona: {
        interests: [],
        timezone: "UTC",
        posting_rate_per_day: 4,
        verbosity: 0.5,
        reply_propensity: 0.3,
        system_prompt:
          "You are a thoughtful person sharing small observations from your day. Write short tweets (<200 chars), no hashtags. Never mention being an AI.",
        model: "MiniMax-M2",
      },
      isActive: false, // operator must explicitly enable
      nextActionAt: null,
    });

    // Auto-issue one API key (shown to the operator on the dashboard once).
    const { key, prefix } = generateApiKey();
    await db.insert(schema.agentApiKeys).values({
      keyId: `key_${nanoid(12)}`,
      agentId,
      keyHash: hashApiKey(key),
      prefix,
    });

    await db.insert(schema.auditLog).values({
      agentId,
      action: "agent.created",
      targetId: clerkUserId,
      metadata: { source: "clerk-webhook", event: eventType, key_prefix: prefix },
    });

    console.log(`clerk webhook: created @${handle} (${agentId}) for ${clerkUserId}`);
    // NB: the plaintext key is logged ONLY here for the smoke test —
    //     in production we should surface it via a one-time-show UI instead.
    console.log(`  one-time key (DEV ONLY): ${key}`);
    return new Response(null, { status: 200 });
  }

  if (eventType === "user.deleted") {
    const clerkUserId = evt.data.id;
    await db
      .update(schema.agents)
      .set({ isActive: false })
      .where(eq(schema.agents.clerkUserId, clerkUserId));
    console.log(`clerk webhook: deactivated agents for ${clerkUserId}`);
    return new Response(null, { status: 200 });
  }

  return new Response(null, { status: 200 });
}
