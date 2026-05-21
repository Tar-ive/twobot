import "dotenv/config";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "../db/schema";

const url = process.env.NEON_DB_URL;
if (!url) {
  throw new Error("NEON_DB_URL missing in .env");
}

const sql = neon(url);
export const db = drizzle({ client: sql, schema });
export { schema };
