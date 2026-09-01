// Generates assets/readme/telemetry.svg and assets/readme/contribution-grid.svg
// from live public GitHub data. Zero dependencies — requires Node 18+.
// Run locally:  node scripts/generate-telemetry.mjs
// Run in CI:    .github/workflows/update-telemetry.yml (nightly)

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const USER = "supriopramanik";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "assets", "readme");

const UA = { "User-Agent": `${USER}-profile-telemetry` };
const ghHeaders = process.env.GITHUB_TOKEN
  ? { ...UA, Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
  : UA;

async function fetchText(url, headers) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}
async function fetchJson(url, headers) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

// ---------- data ----------

async function getContributions() {
  const html = await fetchText(`https://github.com/users/${USER}/contributions`, UA);

  const cells = {};
  const cellRe = /<td[^>]*class="ContributionCalendar-day"[^>]*>/g;
  for (const tag of html.match(cellRe) ?? []) {
    const date = tag.match(/data-date="([\d-]+)"/)?.[1];
    const id = tag.match(/id="([^"]+)"/)?.[1];
    const level = Number(tag.match(/data-level="(\d)"/)?.[1] ?? 0);
    if (date && id) cells[id] = { date, level, count: 0 };
  }
  const tipRe = /<tool-tip[^>]*for="([^"]+)"[^>]*>([^<]*)<\/tool-tip>/g;
  for (const m of html.matchAll(tipRe)) {
    const cell = cells[m[1]];
    if (!cell) continue;
    const n = m[2].match(/^(\d+)\s+contribution/);
    cell.count = n ? Number(n[1]) : 0;
  }
  const days = Object.values(cells).sort((a, b) => a.date.localeCompare(b.date));
  if (days.length < 300) throw new Error(`contribution parse looks wrong: ${days.length} days`);
  return days;
}

function computeStreaks(days) {
  const total = days.reduce((s, d) => s + d.count, 0);
  let longest = 0, run = 0;
  for (const d of days) {
    run = d.count > 0 ? run + 1 : 0;
    if (run > longest) longest = run;
  }
  // current streak: consecutive active days ending at the last day
  // (or the day before it, so an empty "today" doesn't reset the streak)
  let current = 0;
  let i = days.length - 1;
  if (days[i] && days[i].count === 0) i--;
  for (; i >= 0 && days[i].count > 0; i--) current++;
  return { total, longest, current };
}

async function getProfile() {
  return fetchJson(`https://api.github.com/users/${USER}`, ghHeaders);
}

async function getRepoFacts() {
  let stars = 0, repoCount = 0;
  const langs = {};
  for (let page = 1; page <= 3; page++) {
    const repos = await fetchJson(
      `https://api.github.com/users/${USER}/repos?per_page=100&page=${page}`,
      ghHeaders
    );
    for (const r of repos) {
      repoCount++;
      stars += r.stargazers_count;
      if (r.language) langs[r.language] = (langs[r.language] ?? 0) + 1;
    }
    if (repos.length < 100) break;
  }
  const langTotal = Object.values(langs).reduce((a, b) => a + b, 0);
  const topLangs = Object.entries(langs)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([name, n]) => ({ name, pct: Math.round((n / langTotal) * 100) }));
  return { stars, repoCount, topLangs };
}

// ---------- rendering ----------

const MONO = `'Cascadia Code','Consolas','SF Mono',Menlo,monospace`;
const SANS = `'Segoe UI','Helvetica Neue',Arial,sans-serif`;
const LEVEL_COLORS = ["#10161F", "#083344", "#155E75", "#0891B2", "#22D3EE"];

function statModule(x, label, value, sub, accent) {
  return `
  <g>
    <rect x="${x}" y="104" width="180" height="128" rx="12" fill="#0C1322" stroke="#1C2536"/>
    <circle cx="${x + 20}" cy="128" r="3.5" fill="${accent}">
      <animate attributeName="opacity" values="1;0.25;1" dur="3s" repeatCount="indefinite"/>
    </circle>
    <text x="${x + 34}" y="133" font-family="${MONO}" font-size="13" letter-spacing="1" fill="#54627B">${label}</text>
    <text x="${x + 20}" y="188" font-family="${SANS}" font-size="42" font-weight="800" fill="${accent}">${value}</text>
    <text x="${x + 20}" y="214" font-family="${MONO}" font-size="12" letter-spacing="1" fill="#45536A">${sub}</text>
  </g>`;
}

function langBar(x, y, name, pct, delay) {
  const w = Math.max(8, Math.round((pct / 100) * 330));
  return `
  <g>
    <text x="${x}" y="${y + 13}" font-family="${MONO}" font-size="15" fill="#8B96A9">${name}</text>
    <rect x="${x + 140}" y="${y}" width="330" height="16" rx="8" fill="#10161F" stroke="#1C2536"/>
    <rect x="${x + 140}" y="${y}" width="${w}" height="16" rx="8" fill="url(#barGrad)">
      <animate attributeName="width" from="0" to="${w}" dur="1.1s" begin="${delay}s" fill="freeze"/>
    </rect>
    <text x="${x + 486}" y="${y + 13}" font-family="${MONO}" font-size="14" fill="#00D9FF">${pct}%</text>
  </g>`;
}

function renderTelemetry({ profile, repoFacts, streaks, stamp }) {
  const mods =
    statModule(40, "CONTRIBUTIONS", streaks.total.toLocaleString("en-US"), "PAST 12 MONTHS", "#E8EDF5") +
    statModule(228, "CURRENT STREAK", String(streaks.current), "DAYS · ACTIVE", "#00D9FF") +
    statModule(416, "LONGEST STREAK", String(streaks.longest), "DAYS · RECORD", "#00D9FF") +
    statModule(604, "TOTAL STARS", String(repoFacts.stars), "ACROSS REPOS", "#E8EDF5") +
    statModule(792, "FOLLOWERS", String(profile.followers), "ON GITHUB", "#E8EDF5") +
    statModule(980, "PUBLIC REPOS", String(profile.public_repos), "AND COUNTING", "#7C5CFF");

  const bars = (repoFacts.topLangs ?? [])
    .map((l, i) => langBar(i % 2 === 0 ? 40 : 620, i < 2 ? 296 : 336, l.name, l.pct, 0.15 * i))
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="410" viewBox="0 0 1200 410" role="img" aria-labelledby="tlTitle">
  <title id="tlTitle">GitHub telemetry: ${streaks.total} contributions in the past 12 months, current streak ${streaks.current} days, longest streak ${streaks.longest} days, ${repoFacts.stars} stars, ${profile.followers} followers, ${profile.public_repos} public repositories.</title>
  <defs>
    <linearGradient id="barGrad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#00D9FF"/>
      <stop offset="100%" stop-color="#7C5CFF"/>
    </linearGradient>
    <radialGradient id="tlGlowL" cx="0%" cy="0%" r="60%">
      <stop offset="0%" stop-color="#00D9FF" stop-opacity="0.10"/>
      <stop offset="100%" stop-color="#00D9FF" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="tlGlowR" cx="100%" cy="0%" r="60%">
      <stop offset="0%" stop-color="#7C5CFF" stop-opacity="0.10"/>
      <stop offset="100%" stop-color="#7C5CFF" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect x="0.5" y="0.5" width="1199" height="409" rx="16" fill="#0D1117" stroke="#1C2536"/>
  <rect x="0.5" y="0.5" width="1199" height="409" rx="16" fill="url(#tlGlowL)"/>
  <rect x="0.5" y="0.5" width="1199" height="409" rx="16" fill="url(#tlGlowR)"/>
  <circle cx="52" cy="46" r="4" fill="#00D9FF"/>
  <text x="72" y="52" font-family="${MONO}" font-size="19" letter-spacing="4" fill="#00D9FF">SPR·TELEMETRY // LIVE SYSTEM METRICS</text>
  <text x="1160" y="52" font-family="${MONO}" font-size="13" letter-spacing="2" fill="#45536A" text-anchor="end">SYNC · ${stamp}</text>
  <line x1="40" y1="74" x2="1160" y2="74" stroke="#1C2536"/>
  ${mods}
  <text x="40" y="276" font-family="${MONO}" font-size="13" letter-spacing="2" fill="#54627B">LANGUAGE DISTRIBUTION // BY REPOSITORY</text>
  ${bars}
  <line x1="40" y1="380" x2="1160" y2="380" stroke="#1C2536"/>
  <text x="600" y="399" font-family="${MONO}" font-size="11" letter-spacing="2" fill="#37455C" text-anchor="middle">SELF-HOSTED · REGENERATED NIGHTLY BY GITHUB ACTIONS</text>
</svg>
`;
}

function renderGrid({ days, streaks, stamp }) {
  const CELL = 14, PITCH = 18, X0 = 40, Y0 = 92;
  const weeks = Math.ceil(days.length / 7);
  const firstDow = (new Date(days[0].date + "T00:00:00Z")).getUTCDay();

  let cells = "";
  const monthMarks = [];
  let lastMonth = "";
  days.forEach((d, i) => {
    const idx = i + firstDow;
    const col = Math.floor(idx / 7), row = idx % 7;
    const x = X0 + col * PITCH, y = Y0 + row * PITCH;
    cells += `<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="3.5" fill="${LEVEL_COLORS[d.level]}"/>`;
    const month = d.date.slice(0, 7);
    if (month !== lastMonth && row === 0) {
      const label = new Date(d.date + "T00:00:00Z")
        .toLocaleString("en-US", { month: "short", timeZone: "UTC" })
        .toUpperCase();
      monthMarks.push({ x, label });
      lastMonth = month;
    }
  });

  // drop the leading partial-month label when it would collide with the next one
  if (monthMarks.length > 1 && monthMarks[1].x - monthMarks[0].x < 44) monthMarks.shift();
  const months = monthMarks
    .map((m) => `<text x="${m.x}" y="${Y0 - 12}" font-family="${MONO}" font-size="11" letter-spacing="1" fill="#54627B">${m.label}</text>`)
    .join("");

  const gridW = weeks * PITCH - (PITCH - CELL);
  const legend = LEVEL_COLORS
    .map((c, i) => `<rect x="${X0 + gridW - 150 + i * 20}" y="${Y0 + 7 * PITCH + 10}" width="14" height="14" rx="3.5" fill="${c}"/>`)
    .join("");

  const W = X0 * 2 + gridW, H = Y0 + 7 * PITCH + 44;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="cgTitle">
  <title id="cgTitle">Contribution activity grid for the past 12 months: ${streaks.total} total contributions.</title>
  <defs>
    <linearGradient id="scan" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#00D9FF" stop-opacity="0"/>
      <stop offset="50%" stop-color="#00D9FF" stop-opacity="0.22"/>
      <stop offset="100%" stop-color="#00D9FF" stop-opacity="0"/>
    </linearGradient>
    <clipPath id="gridClip">
      <rect x="${X0}" y="${Y0}" width="${gridW}" height="${7 * PITCH - (PITCH - CELL)}" rx="4"/>
    </clipPath>
  </defs>
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="16" fill="#0D1117" stroke="#1C2536"/>
  <circle cx="52" cy="42" r="4" fill="#00D9FF"/>
  <text x="72" y="48" font-family="${MONO}" font-size="18" letter-spacing="4" fill="#00D9FF">ACTIVITY GRID // LAST 12 MONTHS</text>
  <text x="${W - 40}" y="48" font-family="${MONO}" font-size="14" letter-spacing="2" fill="#8B96A9" text-anchor="end">TOTAL · ${streaks.total.toLocaleString("en-US")} CONTRIBUTIONS // ${stamp}</text>
  ${months}
  ${cells}
  <g clip-path="url(#gridClip)">
    <rect x="${X0 - 160}" y="${Y0}" width="150" height="${7 * PITCH}" fill="url(#scan)">
      <animateTransform attributeName="transform" type="translate" from="0 0" to="${gridW + 170} 0" dur="7s" repeatCount="indefinite"/>
    </rect>
  </g>
  <text x="${X0}" y="${Y0 + 7 * PITCH + 22}" font-family="${MONO}" font-size="12" letter-spacing="2" fill="#45536A">SIGNAL STRENGTH</text>
  ${legend}
  <text x="${X0 + gridW - 158}" y="${Y0 + 7 * PITCH + 22}" font-family="${MONO}" font-size="11" fill="#45536A" text-anchor="end">LESS</text>
  <text x="${X0 + gridW - 42}" y="${Y0 + 7 * PITCH + 22}" font-family="${MONO}" font-size="11" fill="#45536A" text-anchor="start">MORE</text>
</svg>
`;
}

// ---------- main ----------

const [days, profile, repoFacts] = await Promise.all([
  getContributions(),
  getProfile(),
  getRepoFacts(),
]);
const streaks = computeStreaks(days);
const stamp = new Date().toISOString().slice(0, 10);

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "telemetry.svg"), renderTelemetry({ profile, repoFacts, streaks, stamp }));
writeFileSync(join(OUT, "contribution-grid.svg"), renderGrid({ days, streaks, stamp }));

console.log(
  `ok: total=${streaks.total} current=${streaks.current} longest=${streaks.longest} ` +
  `stars=${repoFacts.stars} followers=${profile.followers} repos=${profile.public_repos} ` +
  `langs=${repoFacts.topLangs.map((l) => `${l.name}:${l.pct}%`).join(",")}`
);
