/**
 * Scraper dữ liệu chỉ số các đội TI 2026 từ DLTV.org
 * ----------------------------------------------------
 * Đọc scraper/teams.config.json (map đội -> slug DLTV),
 * mở từng trang dltv.org/teams/<slug> và đọc khối STATS ở hai cửa sổ: 6 tháng (?date_range=3) -> data/teams.json + data/meta.json,
 * và 3 tháng (?date_range=2) -> data/teams-3m.json (dùng cho tab So sánh 2 đội).
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
const OUT_TEAMS_3M = join(ROOT, 'data', 'teams-3m.json');

// Hai cửa sổ thời gian trên DLTV (giá trị của ô DATE RANGE):
//   date_range=3 -> Last 6 Months   (bộ chính, dùng cho toàn trang)
//   date_range=2 -> Last 3 Months   (dùng cho tab So sánh 2 đội)
const WINDOWS = [
  { key: '6m', range: 3, label: '6 tháng gần nhất (DLTV)', out: OUT_TEAMS, meta: OUT_META },
  { key: '3m', range: 2, label: '3 tháng gần nhất (DLTV)', out: OUT_TEAMS_3M, meta: null },
];

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * DLTV render NHÃN của khối STATS trước, SỐ về sau (và chỉ khi khối được cuộn tới).
 * Đợi theo nhãn 'KILLS AVG.' là sai: nhãn có ngay nhưng giá trị vẫn là '-'.
 * Hàm này đợi tới khi ô MAPS thực sự có chữ số.
 */
async function waitForStatValues(page, timeout) {
  await page.waitForFunction(() => {
    const lines = document.body.innerText.split('\n').map((l) => l.trim()).filter(Boolean);
    for (let i = 0; i < lines.length - 2; i++) {
      if (lines[i] === 'STATS' && lines[i + 1] === 'MAPS') return /^\d/.test(lines[i + 2] || '');
    }
    return false;
  }, { timeout });
}

async function scrapeTeam(page, team, dateRange) {
  const url = `https://dltv.org/teams/${team.slug}?date_range=${dateRange}`;
  const TRIES = 3;
  for (let attempt = 1; attempt <= TRIES; attempt++) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    } catch { /* vẫn thử đọc nội dung đã tải */ }
    // Khối STATS nằm dưới màn hình đầu và chỉ nạp khi được cuộn tới.
    try { await page.evaluate(() => window.scrollTo(0, 1200)); } catch {}
    try { await waitForStatValues(page, 25000); } catch { /* hết giờ -> thử lại */ }

    const txt = await page.evaluate(() => document.body.innerText);
    if (/PAGE NOT FOUND/i.test(txt)) return { ok: false, reason: 'not-found (slug sai?)' };

    const stats = parseStats(txt);
    if (stats) return { ok: true, stats, attempt };
    if (attempt < TRIES) await sleep(5000);
  }
  return { ok: false, reason: `không đọc được khối STATS sau ${TRIES} lần thử` };
}

async function main() {
  const cfg = JSON.parse(await readFile(CONFIG, 'utf8'));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64) TI2026-Analytics/1.0' });
  const page = await ctx.newPage();

  const now = new Date();
  const dmy = `${String(now.getUTCDate()).padStart(2, '0')}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${now.getUTCFullYear()}`;
  let failed = 0;

  for (const w of WINDOWS) {
    console.log(`\n=== Cửa sổ ${w.label} (date_range=${w.range}) ===`);
    const results = [];
    for (const team of cfg.teams) {
      process.stdout.write(`• ${team.name.padEnd(16)} (${team.slug}) … `);
      const r = await scrapeTeam(page, team, w.range);
      if (r.ok) {
        console.log(`OK  wr=${r.stats.winrate}%  maps=${r.stats.maps}${r.attempt > 1 ? `  (lần thử ${r.attempt})` : ''}`);
        results.push({ ...team, stats: r.stats });
      } else {
        console.log(`SKIP (${r.reason})`);
        results.push({ ...team, stats: null, error: r.reason });
      }
    }

    // Chốt an toàn: nếu đa số đội không đọc được thì nhiều khả năng DLTV đã đổi
    // giao diện. Bỏ qua cửa sổ này, KHÔNG ghi đè, để giữ nguyên dữ liệu đang chạy.
    const okCount = results.filter((t) => t.stats).length;
    const minOk = Math.ceil(results.length * 0.75);
    if (okCount < minOk) {
      console.error(`Chỉ ${okCount}/${results.length} đội đọc được khối STATS (cần tối thiểu ${minOk}).`);
      console.error(`Huỷ ghi ${w.out} để giữ nguyên dữ liệu cũ.`);
      failed++;
      continue;
    }

    // Giữ lại các trường chỉ có trong file cũ (vd: logo) và dùng lại chỉ số cũ cho
    // những đội lẻ tẻ đọc hỏng, thay vì ghi null làm mất dữ liệu.
    let prev = null;
    try { prev = JSON.parse(await readFile(w.out, 'utf8')); } catch { /* lần chạy đầu */ }
    const prevBy = new Map((prev?.teams || []).map((t) => [t.slug, t]));
    const merged = results.map((r) => {
      const old = prevBy.get(r.slug) || {};
      const out = { ...old, ...r };
      if (r.stats) delete out.error;                    // lần này đọc được -> xoá cờ lỗi cũ
      else if (old.stats) out.stats = old.stats;        // đọc hỏng -> giữ số liệu lần trước
      return out;
    });
    const withStats = merged.filter((t) => t.stats).length;

    await mkdir(join(ROOT, 'data'), { recursive: true });
    await writeFile(w.out, JSON.stringify({
      event: cfg.event,
      source: cfg.source,
      window: w.label,
      updatedAt: now.toISOString(),
      _note: `Dữ liệu chỉ số ${w.label.replace(' (DLTV)', '')} (DLTV, chỉ tính trận đấu giải chính thức), cập nhật ${dmy}. ${withStats}/${merged.length} đội có dữ liệu (TEAM VISION = PARIVISION; HULIGANI = L1GA TEAM). Logo hotlink từ DLTV.`,
      teams: merged,
    }, null, 2) + '\n');

    if (w.meta) {
      await writeFile(w.meta, JSON.stringify({
        updatedAt: now.toISOString(),
        window: w.label,
        source: 'https://dltv.org',
        teamsWithData: withStats,
        teamsTotal: merged.length,
      }, null, 2) + '\n');
    }
    console.log(`Đã ghi ${w.out} (${withStats}/${merged.length} đội có dữ liệu, ${okCount} đội lấy mới lần này).`);
  }

  await browser.close();
  if (failed) {
    console.error(`\n${failed}/${WINDOWS.length} cửa sổ không lấy được dữ liệu — xem log phía trên.`);
    process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
