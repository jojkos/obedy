import { scrapeAll } from "../lib/sources.js";
import { menusCacheControl } from "../lib/cache.js";

// GET /api/menus – všechny hospody najednou (stránka používá /api/menu po jedné).
export default async function handler(req, res) {
  const data = await scrapeAll();
  const failed = data.restaurants.some(r => r.error || r.visionError);
  res.setHeader("Cache-Control", menusCacheControl(failed));
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}
