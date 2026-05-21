import { isNull, sql } from "drizzle-orm";
import { db, schema } from "../lib/db";
import { embed, toPgvectorLiteral } from "../lib/openai";

const BATCH = 50;

const all = await db.select().from(schema.agents).where(isNull(schema.agents.personaEmbedding));

if (all.length === 0) {
  console.log("All agents already embedded.");
} else {
  console.log(`Embedding ${all.length} agents...`);
  for (let i = 0; i < all.length; i += BATCH) {
    const slice = all.slice(i, i + BATCH);
    const texts = slice.map((a) => {
      const p = a.persona as { interests?: string[]; system_prompt?: string };
      const interests = (p.interests ?? []).join(", ");
      return [a.bio ?? "", interests, p.system_prompt ?? ""].filter(Boolean).join("\n\n");
    });
    const t0 = Date.now();
    const vectors = await embed(texts);
    console.log(`  embedded ${vectors.length} in ${Date.now() - t0}ms`);
    for (let j = 0; j < slice.length; j++) {
      const lit = toPgvectorLiteral(vectors[j]);
      await db.execute(
        sql`UPDATE agents SET persona_embedding = ${lit}::vector WHERE agent_id = ${slice[j].agentId}`
      );
    }
  }
  console.log("Done.");
}
