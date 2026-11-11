// Daily updater: Spotify Global Daily Top 20 -> site/index.html (+ history/<date>.json)
// Source: kworb.net mirror of the official Spotify Charts global daily chart.
// Run: node --experimental-strip-types scripts/update-chart.ts   (Node 22, no dependencies)
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = "https://kworb.net/spotify/country/global_daily.html";

type Track = {
  pos: number;
  move: string;
  artist: string;
  title: string;
  feat: string;
  id: string;
  days: number | null;
  peak: number | null;
  streams: number | null;
  delta: number | null;
};

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}
const clean = (s: string): string => decode(s.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
const num = (s: string): number | null => {
  const c = clean(s).replace(/[^\d-]/g, "");
  return c === "" || c === "-" ? null : Number(c);
};

async function main(): Promise<void> {
  const res = await fetch(SOURCE, { headers: { "User-Agent": "Mozilla/5.0 chart-updater" } });
  if (!res.ok) throw new Error(`Source returned HTTP ${res.status}`);
  const html = await res.text();

  const dm = html.match(/Spotify Daily Chart - Global - (\d{4})\/(\d{2})\/(\d{2})/);
  if (!dm) throw new Error("Chart date not found on source page");
  const chartDate = `${dm[1]}-${dm[2]}-${dm[3]}`;

  const tbody = html.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1] ?? "";
  const tracks: Track[] = [];
  for (const row of tbody.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1]);
    if (cells.length < 8) continue;
    const tm = cells[2].match(/^([\s\S]*?)<a href="\.\.\/track\/(\w+)\.html">([\s\S]*?)<\/a>([\s\S]*)$/);
    if (!tm) continue;
    tracks.push({
      pos: Number(clean(cells[0])),
      move: clean(cells[1]),
      artist: clean(tm[1]).replace(/\s*-\s*$/, ""),
      title: clean(tm[3]),
      feat: clean(tm[4]),
      id: tm[2],
      days: num(cells[3]),
      peak: num(cells[4]),
      streams: num(cells[6]),
      delta: num(cells[7]),
    });
    if (tracks.length >= 20) break;
  }
  if (tracks.length < 20) throw new Error(`Only ${tracks.length} tracks parsed - source layout may have changed`);

  const data = {
    chartDate,
    updatedAt: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    source: "Spotify Charts - Global Daily (via kworb.net)",
    tracks,
  };
  const json = JSON.stringify(data);

  mkdirSync(join(root, "history"), { recursive: true });
  mkdirSync(join(root, "site"), { recursive: true });
  writeFileSync(join(root, "history", `${chartDate}.json`), JSON.stringify(data, null, 2) + "\n");

  const template = readFileSync(join(root, "template.html"), "utf8");
  const filled = template.replace('"__CHART_DATA__"', () => json.replace(/</g, "\\u003c"));
  const split = filled.indexOf('<div class="crt">');
  if (split < 0) throw new Error("template.html: body start marker not found");
  const headPart = filled.slice(0, split);
  const page = filled.slice(split);
  const doc = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="Spotify Global Daily Top 20 — ${chartDate}. A terminal chart by Reinold Zaale.">
<meta property="og:title" content="REINOLD :: TOP 20 SPOTIFY">
<meta property="og:description" content="Spotify Global Daily Top 20 — ${chartDate}">
<style>*,*::before,*::after{box-sizing:border-box}body{margin:0}p,h1,pre{margin:0}</style>
${headPart}</head>
<body>
${page}
</body>
</html>
`;
  writeFileSync(join(root, "site", "index.html"), doc);
  writeFileSync(join(root, "site", "CNAME"), "top20.reinold.uk\n");
  console.log(`OK chart=${chartDate} tracks=${tracks.length} #1=${tracks[0].artist} - ${tracks[0].title}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
