import "dotenv/config";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";

const url = process.env.NEON_DB_URL;
if (!url) throw new Error("NEON_DB_URL missing in .env");

const sql = neon(url);
const db = drizzle({ client: sql });

console.log("Applying migrations from db/migrations ...");
await migrate(db, { migrationsFolder: "./db/migrations" });
console.log("Done.");
