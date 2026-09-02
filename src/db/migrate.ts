import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "./index";

export async function runMigrations() {
  await migrate(db, { migrationsFolder: "./drizzle" });
}

// `pnpm db:migrate` entry (scripts/migrate.ts) calls this and closes the pool.
export async function runMigrationsAndExit() {
  try {
    await runMigrations();
    console.log("migrations applied");
  } finally {
    await pool.end();
  }
}
