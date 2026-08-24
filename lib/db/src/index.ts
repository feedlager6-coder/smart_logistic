import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

export let pool: pg.Pool | null = null;
export let db: ReturnType<typeof drizzle> | any = null;

if (process.env.DATABASE_URL) {
  try {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    db = drizzle(pool, { schema });
  } catch (err) {
    console.warn("Failed to connect to Postgres:", err);
  }
} else {
  console.info("DATABASE_URL not set; running in in-memory / local mode.");
}

export * from "./schema";
