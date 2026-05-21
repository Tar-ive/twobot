import "dotenv/config";
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.NEON_DB_URL!);

// Idempotent: safe to re-run.
await sql`CREATE EXTENSION IF NOT EXISTS vector`;
console.log("✓ pgvector extension enabled");

await sql`CREATE INDEX IF NOT EXISTS posts_embedding_hnsw_idx ON posts USING hnsw (embedding vector_cosine_ops)`;
console.log("✓ HNSW index on posts.embedding");

const sz = (await sql`SELECT pg_size_pretty(pg_total_relation_size('posts_embedding_hnsw_idx')) AS size`) as any[];
console.log(`  index size: ${sz[0].size}`);
