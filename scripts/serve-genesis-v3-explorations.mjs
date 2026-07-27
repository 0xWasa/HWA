#!/usr/bin/env node
// Tiny dependency-free static server for the HWA Genesis v3 exploration gallery.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "frontend", "public", "genesis");
const PORT = 4390;
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
  ".css": "text/css",
  ".js": "text/javascript",
};

createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    const rel = urlPath === "/" ? "v3/gallery.html" : urlPath === "/explorations" ? "v3-explorations/index.html" : urlPath.slice(1);
    const filePath = normalize(join(ROOT, rel));
    if (!filePath.startsWith(ROOT + sep) && filePath !== ROOT) {
      res.writeHead(403).end("forbidden");
      return;
    }
    const body = await readFile(filePath);
    res.writeHead(200, { "content-type": TYPES[extname(filePath)] ?? "application/octet-stream", "cache-control": "no-store" });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
}).listen(PORT, () => {
  process.stdout.write(`HWA Genesis v3 exploration gallery on http://localhost:${PORT}\n`);
});
