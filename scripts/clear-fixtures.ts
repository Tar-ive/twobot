// Remove any fixture tags from posts so the "Crafted for you" badge
// only appears for real generative-pipeline output.

import { sql } from "drizzle-orm";
import { db } from "../lib/db";

const r = await db.execute<{ post_id: string }>(sql`
  UPDATE posts
  SET target_viewer_id = NULL, generation_source = NULL
  WHERE generation_source = 'targeted'
  RETURNING post_id
`);
console.log(`Untagged ${r.rows.length} fixture posts`);
