// Lokální vývoj bez Vercel CLI: `node dev.js` → http://localhost:3000
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, normalize } from "node:path";
import handler from "./api/menus.js";
import vision from "./api/vision.js";

try { process.loadEnvFile(new URL("./.env.local", import.meta.url).pathname); } catch {} // GEMINI_API_KEY=…

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".svg": "image/svg+xml",
  ".png": "image/png", ".webmanifest": "application/manifest+json" };

createServer(async (req, res) => {
  if (req.url.startsWith("/api/menus")) return handler(req, res);
  if (req.url.startsWith("/api/vision")) return vision(req, res);
  const path = normalize(req.url.split("?")[0]).replace(/^(\.\.[/\\])+/, "");
  const file = path === "/" ? "/index.html" : path;
  try {
    const body = await readFile(new URL("." + file, import.meta.url));
    res.setHeader("Content-Type", TYPES[extname(file)] || "application/octet-stream");
    res.end(body);
  } catch {
    res.statusCode = 404;
    res.end("Not found");
  }
}).listen(3000, () => console.log("http://localhost:3000"));
