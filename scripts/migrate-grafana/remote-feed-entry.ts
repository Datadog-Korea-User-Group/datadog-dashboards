// Entry point of the remote feeder: bundled with esbuild into a single file and run in a plain node container next to
// the Datadog Agent (so DogStatsD/UDP never has to cross the internet or a VPN).
//   node feeder.js <specs.json> [minutes=20] [host=127.0.0.1] [port=8125]
import { readFileSync } from "node:fs";
import { Feeder, type SeriesSpec } from "./dd-feed";

const [file, minutes = "20", host = "127.0.0.1", port = "8125"] = process.argv.slice(2);
const specs = JSON.parse(readFileSync(file, "utf8")) as SeriesSpec[];
const feeder = new Feeder(host, Number(port), specs);
feeder.start(10);
console.log(`${new Date().toISOString()} feeding ${specs.length} series to ${host}:${port} for ${minutes} min`);
setTimeout(() => { feeder.stop(); console.log(`${new Date().toISOString()} done`); process.exit(0); }, Number(minutes) * 60_000);
