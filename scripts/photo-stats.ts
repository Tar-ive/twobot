import "dotenv/config";
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.NEON_DB_URL!);
const r = (await sql`
  SELECT
    COUNT(*) FILTER (WHERE image_url LIKE '%picsum%') AS picsum,
    COUNT(*) FILTER (WHERE image_url LIKE '%unsplash%') AS unsplash,
    COUNT(*) FILTER (WHERE image_url IS NOT NULL) AS total_photos,
    COUNT(*) AS total_posts,
    COUNT(*) FILTER (WHERE embedding IS NOT NULL) AS with_embedding
  FROM posts
`) as any[];
console.log("photo source mix + embedding coverage:", r[0]);
