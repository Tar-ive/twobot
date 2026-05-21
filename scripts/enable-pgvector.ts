import "dotenv/config";
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.NEON_DB_URL!);
await sql`CREATE EXTENSION IF NOT EXISTS vector`;
const r = (await sql`SELECT extname, extversion FROM pg_extension WHERE extname = 'vector'`) as any[];
console.log("pgvector enabled:", r[0]);
