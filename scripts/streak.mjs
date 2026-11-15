// Generates assets/streak-dark.svg and assets/streak-light.svg from the GitHub
// GraphQL API. No third-party service: only the workflow's own GITHUB_TOKEN.
// Usage: GITHUB_TOKEN=... GH_USER=name node scripts/streak.mjs
// Test:  MOCK=1 node scripts/streak.mjs
import { writeFileSync, mkdirSync } from "node:fs";

const USER = process.env.GH_USER || "ECZ-Quantum-Labs";
const TOKEN = process.env.GITHUB_TOKEN;
const MOCK = process.env.MOCK === "1";
const OUT = process.env.OUT_DIR || "assets";

async function gql(query, variables) {
  const r = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${TOKEN}`, "Content-Type": "application/json", "User-Agent": "profile-streak" },
    body: JSON.stringify({ query, variables }),
  });
  if (!r.ok) throw new Error(`GraphQL HTTP ${r.status}`);
  const j = await r.json();
  if (j.errors) throw new Error(JSON.stringify(j.errors));
  return j.data;
}

async function fetchDays() {
  const meta = await gql(`query($u:String!){user(login:$u){createdAt}}`, { u: USER });
  const start = new Date(meta.user.createdAt);
  const now = new Date();
  const days = new Map();
  for (let y = start.getUTCFullYear(); y <= now.getUTCFullYear(); y++) {
    const from = new Date(Date.UTC(y, 0, 1)).toISOString();
    const to = new Date(Math.min(Date.UTC(y, 11, 31, 23, 59, 59), now.getTime())).toISOString();
    const d = await gql(
      `query($u:String!,$f:DateTime!,$t:DateTime!){user(login:$u){contributionsCollection(from:$f,to:$t){contributionCalendar{weeks{contributionDays{date contributionCount}}}}}}`,
      { u: USER, f: from, t: to });
    for (const w of d.user.contributionsCollection.contributionCalendar.weeks)
      for (const c of w.contributionDays) days.set(c.date, c.contributionCount);
  }
  return [...days.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

function mockDays() {
  const out = []; const d0 = new Date(Date.UTC(2026, 0, 1));
  for (let i = 0; i < 319; i++) {
    const d = new Date(d0.getTime() + i * 864e5);
    out.push([d.toISOString().slice(0, 10), (i % 9 === 0 || (i > 200 && i < 230)) ? 0 : 1 + (i % 5)]);
  }
  return out;
}

export function stats(days) {
  const today = new Date().toISOString().slice(0, 10);
  const total = days.reduce((s, [, c]) => s + c, 0);
  let longest = 0, lStart = null, lEnd = null, run = 0, rStart = null;
  for (const [d, c] of days) {
    if (c > 0) { if (run === 0) rStart = d; run++; if (run > longest) { longest = run; lStart = rStart; lEnd = d; } }
    else run = 0;
  }
  // current streak: today may still be empty, so start from yesterday in that case
  let i = days.length - 1;
  if (days[i] && days[i][0] === today && days[i][1] === 0) i--;
  let cur = 0, cEnd = days[i] ? days[i][0] : null, cStart = null;
  for (; i >= 0 && days[i][1] > 0; i--) { cur++; cStart = days[i][0]; }
  if (cur === 0) cEnd = null;
  return { total, since: days[0]?.[0], longest, lStart, lEnd, cur, cStart, cEnd };
}

const fmt = (d) => d ? new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "—";
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

function svg(s, t) {
  const col = (x, big, label, sub, color) => `
  <text x="${x}" y="82" text-anchor="middle" font-size="34" font-weight="700" fill="${color}">${esc(big)}</text>
  <text x="${x}" y="112" text-anchor="middle" font-size="13" fill="${t.sub}">${esc(label)}</text>
  <text x="${x}" y="134" text-anchor="middle" font-size="11" fill="${t.mute}">${esc(sub)}</text>`;
  const curSub = s.cur ? `${fmt(s.cStart)} – ${fmt(s.cEnd)}` : "No active streak";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="495" height="165" viewBox="0 0 495 165" role="img" aria-label="Contribution statistics for ${esc(USER)}">
<style>text{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif}</style>
<rect x="0.5" y="0.5" width="494" height="164" rx="8" fill="${t.bg}" stroke="${t.border}"/>
<line x1="165" y1="30" x2="165" y2="135" stroke="${t.border}"/><line x1="330" y1="30" x2="330" y2="135" stroke="${t.border}"/>
${col(82.5, s.total.toLocaleString("en-US"), "Total Contributions", `${fmt(s.since)} – Present`, t.accent)}
${col(247.5, s.cur, "Current Streak", curSub, t.accent2)}
${col(412.5, s.longest, "Longest Streak", `${fmt(s.lStart)} – ${fmt(s.lEnd)}`, t.accent)}
<text x="247.5" y="154" text-anchor="middle" font-size="9" fill="${t.mute}">Updated ${new Date().toISOString().slice(0, 10)}</text>
</svg>
`;
}

const THEMES = {
  dark:  { bg: "#0d1117", border: "#30363d", accent: "#3fb950", accent2: "#58a6ff", sub: "#c9d1d9", mute: "#8b949e" },
  light: { bg: "#ffffff", border: "#d0d7de", accent: "#1a7f37", accent2: "#0969da", sub: "#24292f", mute: "#57606a" },
};

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!MOCK && !TOKEN) { console.error("GITHUB_TOKEN missing"); process.exit(1); }
  const days = MOCK ? mockDays() : await fetchDays();
  const s = stats(days);
  mkdirSync(OUT, { recursive: true });
  for (const [name, t] of Object.entries(THEMES)) writeFileSync(`${OUT}/streak-${name}.svg`, svg(s, t));
  console.log(JSON.stringify(s));
}
