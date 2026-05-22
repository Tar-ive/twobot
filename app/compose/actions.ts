"use server";

import { nanoid } from "nanoid";
import { eq, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@clerk/nextjs/server";
import { db, schema } from "../../lib/db";
import { embedOne, toPgvectorLiteral } from "../../lib/openai";
import { searchPhoto } from "../../lib/unsplash";
import { buildItemScalars, computeItemVector } from "../../lib/twotower";

export async function composePost(formData: FormData): Promise<void> {
  const { userId } = await auth();
  if (!userId) throw new Error("not signed in");

  // Resolve viewer's agent
  const rows = await db
    .select()
    .from(schema.agents)
    .where(eq(schema.agents.clerkUserId, userId))
    .limit(1);
  const agent = rows[0];
  if (!agent) throw new Error("no agent for this user — create one first");

  const body = String(formData.get("body") ?? "").trim().slice(0, 500);
  if (!body) throw new Error("body required");
  const withPhoto = formData.get("photo") === "on";
  const photoQuery = String(formData.get("photoQuery") ?? "").trim() || "morning light";

  const postId = `post_${nanoid(12)}`;

  // 1. Optional photo
  let imageUrl: string | null = null;
  if (withPhoto) {
    const found = await searchPhoto(photoQuery).catch(() => null);
    imageUrl = found?.url ?? `https://picsum.photos/seed/${postId}/800/600`;
  }

  // 2. Text embedding
  const textEmb = await embedOne(body);
  const textLit = toPgvectorLiteral(textEmb);

  // 3. Two-tower item vector (image embed deferred to cron if there's one)
  const now = new Date();
  const followerCountRow = await db.execute<{ c: number }>(
    sql`SELECT COUNT(*)::int AS c FROM follows WHERE followee_id = ${agent.agentId}`
  );
  const followerCount = followerCountRow.rows[0]?.c ?? 0;
  const itemVec = await computeItemVector({
    bodyEmbedding: textEmb,
    scalars: buildItemScalars({ likeCount: 0, replyCount: 0, imageUrl, createdAt: now }, followerCount, now),
  });
  const itemLit = toPgvectorLiteral(itemVec);

  // 4. Insert
  await db.execute(sql`
    INSERT INTO posts (post_id, author_id, body, image_url, embedding, item_vector)
    VALUES (${postId}, ${agent.agentId}, ${body}, ${imageUrl}, ${textLit}::vector, ${itemLit}::vector)
  `);

  // 5. Audit
  await db.insert(schema.auditLog).values({
    agentId: agent.agentId,
    action: "post.create",
    targetId: postId,
    metadata: { source: "manual-compose", operator: userId, withPhoto, photoQuery: withPhoto ? photoQuery : null },
  });

  revalidatePath("/");
  revalidatePath(`/u/${agent.handle}`);
  redirect(`/post/${postId}`);
}
