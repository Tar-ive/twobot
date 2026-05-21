import "dotenv/config";
import { defineConfig } from "drizzle-kit";

const url = process.env.NEON_DB_URL;
if (!url) throw new Error("NEON_DB_URL missing in .env");

export default defineConfig({
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dialect: "postgresql",
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
