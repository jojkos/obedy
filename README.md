# Obědy u Plynárenské

Dnešní polední menu z hospod a bister kolem Plynárenské 1 v Brně na jedné stránce – s cenami, časem výdeje, pěší vzdáleností, mapou a kostkou pro nerozhodné.

**Živě:** https://www.obedy.space

## Jak to funguje

- `api/menus.js` – Vercel funkce, která při načtení stáhne weby restaurací a vrátí jednotné JSON menu. CDN ho drží 30 min dopoledne, odpoledne do dalšího rána (`lib/cache.js`).
- `lib/sources.js` – parser pro každou restauraci:
  - **K2 Gastro, Bistro Šindelář, Sargam 2** – HTML
  - **Pivnice U Badinů** – JSON z jejich menu systému (ChoiceQR)
  - **Golden Nepal** – menu je jen obrázek → přečte ho Gemini
  - **AnZi** – menu je fotka v příspěvku na Facebooku → najde se poslední příspěvek s menu a fotku přečte Gemini
- `api/vision.js` + `lib/vision.js` – čtení obrázků přes Gemini (free tier). Výsledek se cachuje do půlnoci podle URL obrázku, takže Gemini se ptá max. jednou denně na obrázek.
- `index.html` – celá stránka (bez frameworku), PWA (`manifest.webmanifest`, `sw.js`).

## Lokálně

```sh
echo "GEMINI_API_KEY=…" > .env.local   # klíč z https://aistudio.google.com/apikey
node dev.js                           # http://localhost:3000
```

Bez klíče fungují všechny restaurace kromě Golden Nepal a AnZi.

## Nasazení

Vercel, bez build kroku. V projektu nastav proměnnou prostředí `GEMINI_API_KEY`.

## Přidání restaurace

Přidej funkci do `lib/sources.js`, která vrátí `{ days: [{ date: "YYYY-MM-DD", items: [{ category, name, price, note }] }] }`, a záznam do `SOURCES` (adresa, otevírací doba, pěší vzdálenost).
