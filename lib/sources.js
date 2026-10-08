import { visionViaApi } from "./vision.js";

// Scrapery jednotlivých restaurací. Každý vrací { days: [{ date, items }], note?, image? }.
// Položka: { category: "polévka" | "hlavní" | "ostatní", name, price (Kč | null), note? }

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36";
const DAY_INDEX = { monday: 0, tuesday: 1, wednesday: 2, thursday: 3, friday: 4, saturday: 5, sunday: 6 };

async function fetchText(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function decode(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&(\w+);/g, (m, n) => ENTITIES[n] ?? m);
}
const strip = s => decode(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

function htmlToLines(s) {
  s = s.replace(/<(script|style|noscript|svg)[^>]*>[\s\S]*?<\/\1>/gi, "");
  return decode(s.replace(/<[^>]+>/g, "\n")).split("\n").map(l => l.replace(/\s+/g, " ").trim()).filter(Boolean);
}

// "Kulajda 1 3 7" / "Halušky 1,3,7" → "Kulajda" (čísla alergenů na konci)
const cleanName = s => s.replace(/\s+/g, " ").trim().replace(/(\s+\d{1,2}[a-z]?(\s*[,\s]\s*\d{1,2}[a-z]?)*)\s*$/, "").replace(/[ ,]+$/, "");
const isoDate = (y, m, d) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const parsePrice = s => { const m = /(\d+)\s*Kč/.exec(s || ""); return m ? +m[1] : null; };
function mondayOf(today) {
  const d = new Date(today + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d;
}
function weekDate(today, dayIndex) {
  const d = mondayOf(today);
  d.setUTCDate(d.getUTCDate() + dayIndex);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------- K2 Gastro (čisté HTML)
async function k2() {
  const s = await fetchText("https://www.k2gastro.cz/tydenni-menu/");
  const days = [];
  const blocks = s.split(/<h3[^>]*>/).slice(1);
  for (const b of blocks) {
    const dm = /^\s*\S+\s+(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/.exec(b);
    if (!dm) continue;
    const items = [];
    for (const r of b.matchAll(/MenuOrder">(\d+)<\/div>\s*<div class="MenuName">([\s\S]*?)<\/div>[\s\S]*?MenuPrice">([^<]*)</g)) {
      items.push({
        category: r[1] === "0" ? "polévka" : "hlavní",
        name: cleanName(strip(r[2].replace(/<small>[\s\S]*?<\/small>/g, ""))),
        price: parsePrice(r[3]),
        note: r[1] === "0" ? "k hlavnímu jídlu zdarma" : null,
      });
    }
    if (items.length) days.push({ date: isoDate(dm[3], dm[2], dm[1]), items });
  }
  return { days };
}

// ---------------------------------------------------------------- Bistro Šindelář (Elementor, parsujeme řádky textu)
async function sindelar() {
  const lines = htmlToLines(await fetchText("https://bistrosindelar.cz/"));
  const start = lines.findIndex((l, i) => l === "TÝDENNÍ MENU" && lines[i + 1] === "TO JSME MY");
  const days = [];
  let day = null, cat = "hlavní", weight = null;
  for (const l of lines.slice(start + 1)) {
    let m;
    if ((m = /^\S+ (\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(l))) {
      day = { date: isoDate(m[3], m[2], m[1]), items: [] };
      days.push(day);
    } else if (!day) continue;
    else if (l === "Polévky") cat = "polévka";
    else if (l === "Hlavní jídla") cat = "hlavní";
    else if (/^\d+(,\d+)? ?(l|g|ks)$/.test(l)) weight = l;
    else if (/^\d+\.$/.test(l)) continue;
    else if ((m = /^(\d+) Kč$/.exec(l))) { if (day.items.length) day.items.at(-1).price = +m[1]; }
    else if (/^[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ ]{6,}$/.test(l)) { if (days.length >= 5) break; } // další sekce webu (CATERING…)
    else { day.items.push({ category: cat, name: cleanName(l), price: null, note: weight }); weight = null; }
  }
  return { days: days.filter(d => d.items.length) };
}

// ---------------------------------------------------------------- U Badinů (ChoiceQR – data v __NEXT_DATA__)
async function badin(today) {
  const nextData = async url => {
    const s = await fetchText(url);
    const m = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(s);
    if (!m) throw new Error("chybí __NEXT_DATA__");
    return JSON.parse(m[1]).props.app;
  };
  const home = await nextData("https://ubadinu.cz/");
  const sec = home.sections.find(x => /^týdenní menu/i.test(x.name.trim()));
  if (!sec) throw new Error("sekce Týdenní menu nenalezena");
  const app = await nextData(`https://ubadinu.cz/${sec.hurl}`);
  const year = today.slice(0, 4);
  const catDate = {};
  for (const c of app.categories) {
    const m = /(\d{1,2})\.\s*(\d{1,2})\./.exec(c.name);
    if (m) catDate[c._id] = isoDate(year, m[2], m[1]);
  }
  const byDate = {};
  for (const it of app.menu) {
    const date = catDate[it.category];
    if (!date) continue;
    const soup = /^polévka/i.test(it.name);
    const price = it.price ? Math.round(it.price / 100) : null;
    (byDate[date] ??= []).push({
      category: soup ? "polévka" : "hlavní",
      name: it.description.replace(/\s+/g, " ").trim(),
      price,
      included: soup && !price ? "v ceně menu" : undefined,
      note: it.weight && !soup ? `${it.weight} g` : null,
    });
  }
  return {
    days: Object.entries(byDate).sort().map(([date, items]) => ({ date, items })),
    note: sec.name.replace(/\s+/g, " ").trim(),
  };
}

// ---------------------------------------------------------------- Sargam 2 (HTML po dnech v týdnu, bez data)
async function sargam(today) {
  const s = await fetchText("https://sargamrestaurace.cz/Sargam2/DMenuItems");
  const days = [];
  const parts = s.split(/<div class="category" id="(\w+)">/);
  for (let i = 1; i < parts.length; i += 2) {
    const idx = DAY_INDEX[parts[i].toLowerCase()];
    if (idx === undefined) continue;
    const items = [];
    const re = /<div class="dish-number[^"]*">([\s\S]*?)<\/div>\s*<div class="dish-name">([\s\S]*?)<\/div>\s*<div class="dish-number[^"]*">([\s\S]*?)<\/div>[\s\S]*?<div class="dish-info">([\s\S]*?)<\/div>/g;
    for (const m of parts[i + 1].matchAll(re)) {
      const name = strip(m[2]);
      if (!name) continue;
      const info = strip(m[4]);
      const weight = strip(m[1]);
      const buffet = /all you can eat|buffet|bufet/i.test(name);
      items.push({
        category: /soup|polévka|polevka/i.test(name) ? "polévka" : buffet ? "ostatní" : "hlavní",
        name: name.charAt(0).toUpperCase() + name.slice(1),
        price: parsePrice(strip(m[3])),
        note: [info, weight && /\d/.test(weight) ? (/\D$/.test(weight) ? weight : `${weight} g`) : null].filter(Boolean).join(" · ") || null,
      });
    }
    if (items.length) days.push({ date: weekDate(today, idx), items });
  }
  return { days, note: "Denní menu 11–15 h. Dny jsou na webu bez data – předpokládáme aktuální týden." };
}

// ---------------------------------------------------------------- Golden Nepal (týdenní menu jako obrázek → Gemini)
async function goldenNepal(today, ctx) {
  const s = decode(await fetchText("https://www.mount-everest.cz/menu-golden-nepal/"));
  const imgs = [...s.matchAll(/"img":\{"mimeType":"image\/jpeg","src":"(https:[^"]+)"/g)].map(m => m[1]);
  const menu = imgs.find(u => /GNDM|denni|menu/i.test(u) && !/special/i.test(u)) || imgs.at(-1);
  if (!menu) throw new Error("obrázek s menu nenalezen");
  return withVision(ctx, "golden-nepal", [menu], today);
}

// ---------------------------------------------------------------- AnZi (Facebook → poslední příspěvek s menu → Gemini)
// Facebook vrací obsah stránky (včetně příspěvků) jen crawlerům, proto UA Googlebota.
const FB_PAGE_ID = "61574938844352";
async function anzi(today, ctx) {
  const res = await fetch(`https://www.facebook.com/people/AnZi-Brno/${FB_PAGE_ID}/`, {
    headers: { "User-Agent": "Googlebot/2.1 (+http://www.google.com/bot.html)", "Accept-Language": "cs-CZ,cs;q=0.9" },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Facebook HTTP ${res.status}`);
  const s = await res.text();
  // HTML obsahuje pro každý příspěvek: "post_id" → "creation_time" → fotky (media_id) → "message"
  const posts = new Map();
  const chunks = s.split('"post_id":"').slice(1);
  for (const c of chunks) {
    const id = c.slice(0, c.indexOf('"'));
    const p = posts.get(id) ?? { id, time: 0, text: "", images: new Set() };
    const t = /"creation_time":(\d+)/.exec(c.slice(0, 3000));
    if (t && !p.time) p.time = +t[1] * 1000;
    const m = /"message":\{[^{}]*?"text":"((?:[^"\\]|\\.)*)"/.exec(c);
    if (m && !p.text) p.text = JSON.parse(`"${m[1]}"`);
    for (const im of c.matchAll(/media_id=(\d+)/g)) if (im[1] !== FB_PAGE_ID) p.images.add(im[1]);
    posts.set(id, p);
  }
  const post = [...posts.values()]
    .filter(p => p.images.size && /menu|nabídk/i.test(p.text) && Date.now() - p.time < 8 * 864e5)
    .sort((a, b) => b.time - a.time)[0];
  if (!post) return { days: [], note: "Na Facebooku zatím není příspěvek s menu na tento týden." };
  const imgs = [...post.images].slice(0, 4).map(id => `https://lookaside.fbsbx.com/lookaside/crawler/media/?media_id=${id}`);
  const r = await withVision(ctx, "anzi", imgs, today);
  r.menuUrl = `https://www.facebook.com/${FB_PAGE_ID}/posts/${post.id}/`;
  return r;
}

// Obrázky přečte Gemini; když to nejde (chybí klíč, kvóta…), vrátíme aspoň obrázky.
async function withVision(ctx, sourceId, images, today) {
  try {
    const v = await visionViaApi(ctx.origin, sourceId, images, today);
    if (!v.is_menu) return { days: [], images, note: "Na obrázcích není polední menu." };
    for (const d of v.days) for (const i of d.items || []) {
      if (!i.price && /bufet/i.test(i.note || "")) { i.included = "v bufetu"; i.note = i.note.replace(/^\s*v bufetu\s*[·,;-]?\s*/i, "") || null; }
    }
    return { days: v.days.filter(d => d.items?.length), note: v.note, images };
  } catch (e) {
    return { days: [], images, visionError: e.message };
  }
}

// Pěší vzdálenost od Plynárenské 1 (spočítáno jednou přes OSM/Valhalla, adresy se nemění).
export const ORIGIN = "Plynárenská 1, Brno";
export const ORIGIN_GEO = "49.1969507,16.6263491";

export const SOURCES = [
  { id: "k2", name: "K2 Gastro", url: "https://www.k2gastro.cz/tydenni-menu/", kind: "html", walk: { m: 466, min: 6, geo: "49.1992001,16.6250040" }, hours: { menu: ["10:00", "13:30"] }, address: "Cejl 62", fn: k2 },
  { id: "sindelar", name: "Bistro Šindelář", url: "https://bistrosindelar.cz/", kind: "html", walk: { m: 396, min: 5, geo: "49.1990786,16.6242568" }, hours: { menu: ["10:00", "13:00"] }, address: "Cejl 78/60", fn: sindelar },
  { id: "badin", name: "Pivnice U Badinů", url: "https://ubadinu.cz/", kind: "json", walk: { m: 583, min: 7, geo: "49.1991887,16.6314270" }, hours: { open: ["11:00", "23:00"] }, address: "Tomáškova 2", fn: badin },
  { id: "sargam", name: "Sargam 2", url: "https://sargamrestaurace.cz/Sargam2/DMenuItems", kind: "html", walk: { m: 958, min: 12, geo: "49.1913428,16.6220990" }, hours: { menu: ["11:00", "15:00"] }, address: "Křenová, Trnitá", fn: sargam },
  { id: "golden-nepal", name: "Golden Nepal", url: "https://www.mount-everest.cz/menu-golden-nepal/", kind: "obrázek + AI", walk: { m: 774, min: 9, geo: "49.1931662,16.6197318" }, hours: { menu: ["11:00", "16:00"] }, address: "Špitálka, Trnitá", fn: goldenNepal },
  { id: "anzi", name: "AnZi Brno", url: "https://www.facebook.com/people/AnZi-Brno/61574938844352/", kind: "facebook + AI", hours: { menu: ["10:30", "14:30"] }, address: "Špitálka 124/37", walk: { m: 763, min: 9, geo: "49.1919202,16.6210723" }, fn: anzi },
];

export async function scrapeAll({ origin, today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Prague" }) }) {
  const restaurants = await Promise.all(SOURCES.map(async ({ fn, ...src }) => {
    try {
      const r = await fn(today, { origin });
      // weby občas obsahují staré šablony (K2 má v HTML menu z roku 2021)
      r.days = r.days.filter(d => Math.abs(new Date(d.date) - new Date(today)) < 10 * 864e5);
      return { ...src, ...r };
    } catch (e) {
      return { ...src, days: [], error: `Nepodařilo se načíst (${e.message})` };
    }
  }));
  return { today, origin: ORIGIN, originGeo: ORIGIN_GEO, updated: new Date().toISOString(), restaurants };
}
