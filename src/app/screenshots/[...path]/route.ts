import { createReadStream, statSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";

// Next only serves the `public/` files it saw at startup, so screenshots written later (data syncs, upload previews)
// would 404 until a restart. This handler serves them straight from disk; files Next already knows never reach it.
export const dynamic = "force-dynamic";

const ROOT = path.resolve(process.cwd(), "public", "screenshots");
const NOT_FOUND = () => new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });

export async function GET(_req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path: parts } = await params;
  const target = path.resolve(ROOT, ...parts);
  if (!target.startsWith(ROOT + path.sep) || !target.endsWith(".webp")) return NOT_FOUND();
  let st;
  try {
    st = statSync(target);
  } catch {
    return NOT_FOUND();
  }
  if (!st.isFile()) return NOT_FOUND();
  return new Response(Readable.toWeb(createReadStream(target)) as ReadableStream, {
    headers: {
      "content-type": "image/webp",
      "content-length": String(st.size),
      "last-modified": st.mtime.toUTCString(),
      etag: `"${st.size}-${Math.floor(st.mtimeMs)}"`,
      "cache-control": "public, max-age=3600",
    },
  });
}
