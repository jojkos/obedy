import { ORIGIN, ORIGIN_GEO, sourceMeta } from "../lib/sources.js";

// GET /api/sources – seznam hospod (adresa, otevírací doba, pěší vzdálenost) bez menu.
export default function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=3600, stale-while-revalidate=604800");
  res.end(JSON.stringify({ origin: ORIGIN, originGeo: ORIGIN_GEO, restaurants: sourceMeta() }));
}
