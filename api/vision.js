import { VISION_SOURCES, readMenuFromImages } from "../lib/vision.js";
import { secondsUntil } from "../lib/cache.js";

// GET /api/vision?source=anzi&img=<url> <url>&today=YYYY-MM-DD
export default async function handler(req, res) {
  const q = new URL(req.url, "http://x").searchParams;
  const source = q.get("source");
  const imgs = (q.get("img") || "").split(" ").filter(Boolean).slice(0, 4);
  const today = /^\d{4}-\d{2}-\d{2}$/.test(q.get("today") || "") ? q.get("today") : null;
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  const src = VISION_SOURCES[source];
  const allowed = src && today && imgs.length && imgs.every(u => {
    try { return src.host.test(new URL(u).hostname); } catch { return false; }
  });
  if (!allowed) {
    res.statusCode = 400;
    return res.end(JSON.stringify({ error: "nepovolený zdroj nebo obrázek" }));
  }

  // Gemini se volá nejvýš 1× denně na obrázek: výsledek platí do půlnoci, kdy se mění `today` v URL.
  // Chybu (přetížení, kvóta) držíme 15 min, aby se Gemini při potížích nevolalo pořád dokola.
  // Vrací se se statusem 200, protože CDN chybové statusy necachuje.
  try {
    const data = await readMenuFromImages(source, imgs, today);
    res.setHeader("Cache-Control", `public, s-maxage=${secondsUntil(0)}`);
    res.end(JSON.stringify(data));
  } catch (e) {
    res.setHeader("Cache-Control", "public, s-maxage=900");
    res.end(JSON.stringify({ error: e.message }));
  }
}
