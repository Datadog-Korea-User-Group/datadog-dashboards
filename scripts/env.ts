// Loads .env.local then .env (if present) without a dependency. Node >= 20.12.
import { existsSync } from "node:fs";
for (const f of [".env.local", ".env"]) {
  if (existsSync(f)) {
    try { process.loadEnvFile(f); } catch { /* ignore parse errors */ }
  }
}
