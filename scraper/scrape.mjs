/**
 * Scraper dữ liệu chỉ số các đội TI 2026 từ DLTV.org
 * ----------------------------------------------------
 * Đọc scraper/teams.config.json (map đội -> slug DLTV),
 * mở từng trang dltv.org/teams/<slug>, đọc khối STATS
 * (bắt buộc lọc 6 tháng gần nhất qua ?date_range=3) và ghi ra data/teams.json + data/meta.json.
 *
 * Chạy:  node scraper/scrape.mjs
 * Yêu cầu: Node 18+, playwright (npm i && npx playwright install chromium)
 */
import { chromium } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CONFIG = join(__dirname, 'teams.config.json');
const OUT_TEAMS = join(ROOT, 'data', 'teams.json');
const OUT_META = join(ROOT, 'data', 'meta.json');

const num = (s) => (s == null ? null : Number(String(s).replace(/[^0-9.\-]/g, '')));

/** Từ danh sách dòng text, tìm khối STATS và bóc 10 chỉ số cốt lõi. */
function parseStats(rawText) {
  const lines = rawText.split('\n').map((l) => l.trim()).filter(Boolean);
  // Anchor: dòng 'STATS' mà dòng ngay sau là 'MAPS'
  let anchor = -1;
  for (let i = 0; i < lines.length - 1; i++) {
    if (lines[i] === 'STATS' && lines[i + 1] === 'MAPS') { anchor = i; break; }
  }
  if (anchor === -1) return null;

  // Chuỗi nhãn cố định của DLTV, đọc value = dòng ngay sau nhãn.
  const labelKey = [
    ['MAPS', 'maps'], ['WINRATE', 'winrate'],
    ['KILLS AVG.', 'kills'], ['DEATHS AVG.', 'deaths'],
    ['ASSISTS PER GAME', 'assists'],
    ['FB', 'firstBlood'], ['F10', 'f10'],
    ['WIN WHEN FB', 'winWhenFb'], ['WIN WHEN F10', 'winWhenF10'],
    ['AV. DURATION', 'duration'],
  ];
  const out = {};
  let cursor = anchor;
  for (const [label, key] of labelKey) {
    // tìm nhãn kể từ cursor
    let idx = -1;
    for (let i = cursor; i < Math.min(lines.length, anchor + 60); i++) {
      if (lines[i] === label) { idx = i; break; }
    }
    if (idx === -1 || idx + 1 >= lines.length) return null;
    out[key] = num(lines[idx + 1]);
    cursor = idx + 1;
  }
  if (!out.maps || out.maps <= 0) return null;

  // Chỉ số dẫn xuất
  out.totalKills = +(out.kills + out.deaths).toFixed(2);
  out.killDiff = +(out.kills - out.deaths).toFixed(2);
  return out;
}

async function scrapeTeam(page, team) {
  const url = `https://dltv.org/teams/${team.slug}?date_range=3`; // date_range=3 = Last 6 Months
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
  } catch { /* vẫn thử đọc nội dung đã tải */ }
  // đợi khối STATS render
  try { await page.waitForFunction(() => document.body.innerText.includes('KILLS AVG.'), { timeout: 15000 }); } catch {}
  const txt = await page.evaluate(() => document.body.innerText);
  if (/PAGE NOT FOUND/i.test(txt)) {
    return { ok: false, reason: 'not-found (slug sai?)' };
  }
  const stats = parseStats(txt);
  if (!stats) return { ok: false, reason: 'không đọc được khối STATS' };
  return { ok: true, stats };
}

async function main() {
  const cfg = JSON.parse(await readFile(CONFIG, 'utf8'));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64) TI2026-Analytics/1.0' });
  const page = await ctx.newPage();

  const results = [];
  for (const team of cfg.teams) {
    process.stdout.write(`• ${team.name.padEnd(16)} (${team.slug}) … `);
    const r = await scrapeTeam(page, team);
    if (r.ok) {
      console.log(`OK  wr=${r.stats.winrate}%  maps=${r.stats.maps}`);
      results.push({ ...team, stats: r.stats });
    } else {
      console.log(`SKIP (${r.reason})`);
      results.push({ ...team, stats: null, error: r.reason });
    }
  }
  await browser.close();

  await mkdir(join(ROOT, 'data'), { recursive: true });
  await writeFile(OUT_TEAMS, JSON.stringify({ event: cfg.event, source: cfg.source, teams: results }, null, 2));
  const now = new Date();
  await writeFile(OUT_META, JSON.stringify({
    updatedAt: now.toISOString(),
    window: '6 tháng gần nhất (DLTV)',
    source: 'https://dltv.org',
    teamsWithData: results.filter((t) => t.stats).length,
    teamsTotal: results.length,
  }, null, 2));
  console.log(`\nĐã ghi ${OUT_TEAMS} (${results.filter(t=>t.stats).length}/${results.length} đội có dữ liệu).`);
}

main().catch((e) => { console.error(e); process.exit(1); });
