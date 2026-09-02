// Runs once when the Next.js server starts: applies pending Drizzle migrations.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.RUN_MIGRATIONS === "false") return;
  const { runMigrations } = await import("./db/migrate");
  await runMigrations();
}
