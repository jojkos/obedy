import { SOURCES, scrapeOne, pragueToday } from "../lib/sources.js";
import { menusCacheControl } from "../lib/cache.js";

// GET /api/menu?source=k2 – menu jedné hospody. Stránka se ptá na každou zvlášť,
// takže hotové hospody se ukážou hned a pomalé (čtení obrázků) nezdržují ostatní.
export default async function handler(req, res) {
  const id = new URL(req.url, "http://x").searchParams.get("source");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (!SOURCES.some(s => s.id === id)) {
    res.statusCode = 400;
    return res.end(JSON.stringify({ error: "neznámá hospoda" }));
  }
  const today = pragueToday();
  const restaurant = await scrapeOne(id, today);
  res.setHeader("Cache-Control", menusCacheControl(Boolean(restaurant.error || restaurant.visionError)));
  res.end(JSON.stringify({ today, updated: new Date().toISOString(), restaurant }));
}
