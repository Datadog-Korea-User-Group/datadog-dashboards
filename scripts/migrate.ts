import "./env";
import { runMigrationsAndExit } from "../src/db/migrate";

runMigrationsAndExit().catch((e) => { console.error(e); process.exit(1); });
