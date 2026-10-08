// Pomocné výpočty doby cache podle pražského času.

function pragueSeconds() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Prague", hour: "numeric", minute: "numeric", second: "numeric", hourCycle: "h23",
  }).formatToParts(new Date());
  const get = type => +parts.find(p => p.type === type).value;
  return get("hour") * 3600 + get("minute") * 60 + get("second");
}

// Kolik sekund zbývá do nejbližší celé hodiny `hour` pražského času (min. 60 s).
export function secondsUntil(hour) {
  let diff = hour * 3600 - pragueSeconds();
  if (diff <= 0) diff += 86400;
  return Math.max(60, diff);
}

// Dopoledne se menu ještě mění (restaurace je zveřejňují/opravují) → obnovujeme po 30 min.
// Od poledne platí menu do zítřka → držíme až do 6:00.
// Vždy se stale-while-revalidate: návštěvník hned dostane poslední známá data a nová se
// stáhnou na pozadí – nikdo nečeká na stažení webů ani na Gemini.
const SWR = 172800;
export function menusCacheControl(failed) {
  if (failed) return `public, max-age=0, s-maxage=120, stale-while-revalidate=${SWR}`;
  const hour = Math.floor(pragueSeconds() / 3600);
  if (hour >= 6 && hour < 12) return `public, max-age=0, s-maxage=1800, stale-while-revalidate=${SWR}`;
  return `public, max-age=0, s-maxage=${secondsUntil(6)}, stale-while-revalidate=${SWR}`;
}
