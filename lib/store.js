// Trvalé úložiště (Vercel Blob): poslední úspěšné menu každé hospody a výsledky čtení obrázků.
// Čte se přes veřejnou URL (levné), zapisuje se jen při změně (pár zápisů týdně).
import { put } from "@vercel/blob";

const token = () => process.env.BLOB_READ_WRITE_TOKEN;

// token má tvar vercel_blob_rw_<storeId>_<secret>, veřejná URL je odvozená ze storeId
function baseUrl() {
  const id = token()?.split("_")[3];
  return id ? `https://${id.toLowerCase()}.public.blob.vercel-storage.com/` : null;
}

export async function loadJson(path) {
  const base = baseUrl();
  if (!base) return null;
  try {
    // ?t= obchází CDN, aby se nečetla stará kopie hned po zápisu
    const res = await fetch(`${base}${path}?t=${Date.now()}`, { signal: AbortSignal.timeout(5000) });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

export async function saveJson(path, data) {
  if (!token()) return;
  try {
    await put(path, JSON.stringify(data), {
      access: "public", addRandomSuffix: false, allowOverwrite: true, contentType: "application/json",
    });
  } catch (e) {
    console.error(`Blob: zápis ${path} selhal: ${e.message}`);
  }
}
