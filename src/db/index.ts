import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const url = process.env.DATABASE_URL ?? "postgres://dashboards:dashboards@localhost:5432/dashboards";

// One pool per process; Next.js dev hot-reload reuses it via globalThis.
const g = globalThis as unknown as { __pgPool?: Pool };
export const pool = g.__pgPool ?? new Pool({ connectionString: url, max: 10 });
if (process.env.NODE_ENV !== "production") g.__pgPool = pool;

export const db = drizzle(pool, { schema });
export type Db = typeof db;
