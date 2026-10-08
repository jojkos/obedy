import { scrapeAll } from "../lib/sources.js";
import { menusCacheControl } from "../lib/cache.js";

// Vercel serverless funkce. Jak dlouho CDN drží odpověď, viz lib/cache.js.
export default async function handler(req, res) {
  const proto = req.headers["x-forwarded-proto"] || "http";
  const data = await scrapeAll({ origin: `${proto}://${req.headers.host}` });
  // když něco selhalo (typicky přetížené Gemini), zkusíme to znovu za 2 min
  const failed = data.restaurants.some(r => r.error || r.visionError);
  res.setHeader("Cache-Control", menusCacheControl(failed));
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}
