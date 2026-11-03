// Přečtení menu z obrázků přes Gemini (free tier Google AI Studio).
// Výsledek se ukládá natrvalo (Vercel Blob) podle zdroje + obrázků + týdne,
// takže Gemini se na stejný obrázek zeptá jen jednou (menu jsou týdenní).
import { createHash } from "node:crypto";
import { loadJson, saveJson } from "./store.js";

// Zkouší se postupně; při přetížení (503) nebo vyčerpané kvótě (429) jde na další model.
// Každý model má ve free tieru vlastní denní kvótu.
const MODELS = (process.env.GEMINI_MODELS || "gemini-3.5-flash,gemini-3.5-flash-lite,gemini-flash-latest").split(",");
const DOW = ["pondělí", "úterý", "středa", "čtvrtek", "pátek", "sobota", "neděle"];

// Povolené zdroje: id → odkud smí obrázky pocházet a co o menu víme.
export const VISION_SOURCES = {
  "golden-nepal": {
    name: "Golden Nepal",
    host: /\.clvaw-cdnwnd\.com$/,
    hint: `Menu je týdenní tabulka Po–Pá bez data → dny přiřaď k datům aktuálního týdne.
Položky 1–8 jsou bufet za společnou cenu: dej je jednotlivě s note „v bufetu“ a price null.
Pak přidej položky (category „ostatní“): „Bufet – jez kolik můžeš“ s cenou bufetu,
„Non-buffet menu (1 jídlo)“ a „Mix Thali“ s jejich cenami a výčtem jídel v note.`,
  },
  anzi: {
    name: "AnZi Brno",
    host: /^lookaside\.fbsbx\.com$/,
    hint: `Menu bývá týdenní fotka („Polední nabídka 5.10. – 9.10.“).
Název jídla nech vietnamsky a do note dej český popis. Nápoje k menu dej jako category „ostatní“.`,
  },
  "matyho-chalka": {
    name: "Matyho chálka",
    host: /^lookaside\.fbsbx\.com$/,
    hint: `Na začátku týdne dávají týdenní menu s cenami jako fotku, pak každé ráno příspěvek
„Dobré ráno, dnes vám nabízíme: …“ se seznamem jídel (bez cen). Dezerty a snídaně dej jako category „ostatní“.`,
  },
};

// Společná pravidla, když menu hledáme v příspěvcích z Facebooku (může jich být víc a ne všechny jsou menu).
const FB_RULES = `Jak z příspěvků poskládat menu:
- Příspěvky, které nejsou polední menu (akce, fotky jídla, interiér, pozvánky), ignoruj – stejně tak obrázky bez menu.
- Denní menu („dnes vám nabízíme“, „dnešní menu“) platí jen pro den zveřejnění příspěvku, i když zmiňuje nový týden.
- Týdenní menu (rozsah dat, „menu na tento týden“, dny Po–Pá) platí pro každý den, který uvádí; bez dnů pro všechny pracovní dny týdne, kdy vyšlo.
- Když pro stejný den existuje víc příspěvků, platí ten novější (oprava, změna).
- Příspěvky kombinuj: týdenní menu (často fotka) vrať pro všechny dny, které uvádí – i pro dny, ke kterým denní
  příspěvek ještě není. Pro den, který má denní příspěvek, určuje nabídku ten denní příspěvek a ceny (a gramáže)
  k jeho jídlům doplň z týdenního menu, pokud je tam stejné jídlo.
- Vrať všechny dny, pro které z příspěvků menu znáš – minulé i budoucí dny tohoto týdne.`;

const SCHEMA = {
  type: "OBJECT",
  properties: {
    is_menu: { type: "BOOLEAN", description: "false, pokud na obrázcích žádné polední menu není" },
    note: { type: "STRING", nullable: true, description: "krátká obecná poznámka: platnost, čas podávání, co je v ceně" },
    days: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          date: { type: "STRING", description: "YYYY-MM-DD" },
          items: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                category: { type: "STRING", enum: ["polévka", "hlavní", "ostatní"] },
                name: { type: "STRING" },
                price: { type: "INTEGER", nullable: true },
                note: { type: "STRING", nullable: true },
              },
              required: ["category", "name"],
            },
          },
        },
        required: ["date", "items"],
      },
    },
  },
  required: ["is_menu", "days"],
};

export function mondayOf(today) {
  const d = new Date(today + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

function weekOf(monday) {
  const d = new Date(monday + "T12:00:00Z");
  return DOW.map((name, i) => {
    const x = new Date(d);
    x.setUTCDate(d.getUTCDate() + i);
    return `${name} ${x.toISOString().slice(0, 10)}`;
  });
}

async function toInlinePart(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "Googlebot/2.1 (+http://www.google.com/bot.html)" },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`obrázek HTTP ${res.status}`);
  const mime = res.headers.get("content-type")?.split(";")[0] || "image/jpeg";
  return { inline_data: { mime_type: mime, data: Buffer.from(await res.arrayBuffer()).toString("base64") } };
}

// text = text příspěvku (Facebook), když je menu napsané přímo v něm a ne na obrázku
async function readMenuFromImages(sourceId, imageUrls, monday, text) {
  const src = VISION_SOURCES[sourceId];
  if (!src) throw new Error("neznámý zdroj");
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("chybí GEMINI_API_KEY");

  const prompt = `Přečti polední menu restaurace „${src.name}“ z ${text ? "jejích příspěvků na Facebooku a přiložených obrázků" : "přiložených obrázků"}.
Aktuální týden: ${weekOf(monday).join(", ")}.${text ? `
${FB_RULES}

Příspěvky za poslední týden (od nejnovějšího):
"""
${text}
"""` : ""}
Pro každý den vrať položky: category (polévka / hlavní / ostatní), name (bez čísel alergenů),
price v Kč jako celé číslo (pokud chybí, null), note (popis jídla česky, gramáž apod., jinak null).
Alergenové legendy, wifi a běžné nápoje vynech. Opisuj přesně, nic si nevymýšlej.
${src.hint}`;

  const parts = [{ text: prompt }, ...(await Promise.all(imageUrls.map(toInlinePart)))];
  // opis menu nepotřebuje dlouhé přemýšlení – s „low“ je odpověď několikrát rychlejší;
  // skládání víc příspěvků (denní + týdenní menu) s „low“ ale náhodně vynechává dny/položky
  const thinkingLevel = text ? "medium" : "low";
  const timeout = text ? 40000 : 25000;
  const errors = [];
  for (const model of MODELS) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          responseMimeType: "application/json", responseSchema: SCHEMA, temperature: 0,
          thinkingConfig: { thinkingLevel },
        },
      }),
      signal: AbortSignal.timeout(timeout),
    }).catch(e => ({ ok: false, status: 0, json: async () => ({ error: { message: e.message } }) }));
    const body = await res.json();
    const text = body.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("");
    if (res.ok && text) return { ...JSON.parse(text), model: body.modelVersion || model };
    errors.push(`${model}: ${res.status} ${body.error?.message?.slice(0, 80) || "prázdná odpověď"}`);
  }
  // klíč nikdy nesmí skončit ve veřejné odpovědi
  throw new Error(`Gemini selhal – ${errors.join(" | ")}`.replaceAll(key, "***").replace(/AIza[\w-]{20,}|AQ\.[\w-]{20,}/g, "***"));
}

// Uložený výsledek → jinak Gemini. Když Gemini selže, použije se poslední výsledek
// téže hospody z téhož týdne (např. když restaurace jen vyměnila fotku).
const memo = new Map();
export async function readMenuCached(sourceId, imageUrls, today, text) {
  const monday = mondayOf(today);
  // bez textu stejný klíč jako dřív, ať se uložené výsledky nepřepočítávají
  const hash = createHash("sha256").update(JSON.stringify(text ? [sourceId, imageUrls, text] : [sourceId, imageUrls])).digest("hex").slice(0, 20);
  const path = `vision/${sourceId}/${monday}-${hash}.json`;
  const lastPath = `vision/${sourceId}/${monday}-last.json`;
  if (memo.has(path)) return memo.get(path);

  const stored = await loadJson(path);
  if (stored) { memo.set(path, stored); return stored; }

  try {
    const fresh = await readMenuFromImages(sourceId, imageUrls, monday, text);
    if (fresh.is_menu && fresh.days?.length) {
      memo.set(path, fresh);
      await Promise.all([saveJson(path, fresh), saveJson(lastPath, fresh)]);
    }
    return fresh;
  } catch (e) {
    const last = await loadJson(lastPath);
    if (last) return last;
    throw e;
  }
}
