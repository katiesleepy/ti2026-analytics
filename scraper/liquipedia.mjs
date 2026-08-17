/**
 * Bóc bảng xếp hạng Swiss + kết quả The International 2026 từ Liquipedia.
 * -----------------------------------------------------------------------
 * Nguồn:  https://liquipedia.net/dota2/The_International/2026/Group_Stage
 * Giấy phép nội dung: CC BY-SA 3.0 — BẮT BUỘC ghi công Liquipedia ở nơi hiển thị.
 *
 * Vì sao đọc bản render chứ không đọc wikitext:
 *   Liquipedia lưu kết quả trận đã đấu trong LPDB, wikitext chỉ còn `|M1={{Match}}` rỗng.
 *   Bản HTML đã render thì có đủ, nên ta đọc DOM.
 *
 * Ghi ra:
 *   data/ti-groups.json  — BXH Swiss + trận đã xong + trận đang đấu + trận sắp đấu
 *   data/h2h.json        — chèn thêm các trận TI mới vào `series` (không đụng khối `st`)
 *
 * Tôn trọng điều khoản API Liquipedia: User-Agent riêng có thông tin liên hệ,
 * mỗi lần chạy chỉ tải đúng MỘT trang, chạy tối đa 1 lần/ngày qua GitHub Actions.
 *
 * Chạy:  node scraper/liquipedia.mjs
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT_GROUPS = join(ROOT, 'data', 'ti-groups.json');
const OUT_H2H = join(ROOT, 'data', 'h2h.json');

const PAGE_TITLE = 'The International/2026/Group Stage';
const PAGE_URL = 'https://liquipedia.net/dota2/The_International/2026/Group_Stage';
// Nhánh playoffs nằm ở trang riêng, bảng trận cùng dạng 5 cột như vòng bảng.
const PLAYOFF_TITLE = 'The International/2026/Main Event';
const PLAYOFF_URL = 'https://liquipedia.net/dota2/The_International/2026/Main_Event';
const EVENT = 'The International 2026';
// Điều khoản Liquipedia: cấm User-Agent chung chung, phải có cách liên hệ.
const UA = 'TI2026-Analytics/1.0 (+https://github.com/katiesleepy/ti2026-analytics) playwright-chromium';

/**
 * Tên đội trên Liquipedia -> slug trong repo.
 * Nhiều đội đổi tên theo nhà tài trợ cá cược khi thi đấu TI, nên phải map tay.
 */
const NAME2SLUG = {
  'Team Falcons': 'team-falcons',
  'Team Liquid': 'team-liquid',
  'Xtreme Gaming': 'xtreme-gaming',
  'Aurora Gaming': 'aurora',
  'Aurora': 'aurora',
  'Team Yandex': 'team-yandex',
  'Team Spirit': 'team-spirit',
  'Nigma Galaxy': 'nigma',
  'Team Resilience': 'team-resilience',
  'Vici Gaming': 'vici-gaming',
  'OG': 'og',
  'LGD Gaming': 'lgd-gaming',
  'GamerLegion': 'gamerlegion',
  // tên thi đấu tại TI (thương hiệu cá cược) và tên gốc, nhận cả hai
  'BoomBoys': 'betboom-team',
  'BetBoom Team': 'betboom-team',
  'Iron Wing': '1win-team',
  '1win Team': '1win-team',
  '1win': '1win-team',
  'TEAM VISION': 'parivision',
  'PARIVISION': 'parivision',
  'HULIGANI': 'l1ga-team',
  'L1GA TEAM': 'l1ga-team',
};

const MONTHS = {
  January: 1, February: 2, March: 3, April: 4, May: 5, June: 6,
  July: 7, August: 8, September: 9, October: 10, November: 11, December: 12,
};

function isoDate(s) {
  const m = /([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/.exec(s || '');
  if (!m || !MONTHS[m[1]]) return null;
  return `${m[3]}-${String(MONTHS[m[1]]).padStart(2, '0')}-${String(+m[2]).padStart(2, '0')}`;
}

/**
 * Số vòng Swiss. Cột "Round" ghi "Round 1" ở vòng đầu, các vòng sau ghi nhánh
 * thành tích ("1-0", "2-1"…) — tổng thắng+thua chính là số trận đã đấu.
 */
function roundOf(label) {
  const t = (label || '').trim();
  const r = /^Round\s+(\d+)/i.exec(t);
  if (r) return +r[1];
  // Vòng thường: nhánh thành tích "1-0", "2-1"…
  const b = /^(\d+)\s*-\s*(\d+)$/.exec(t);
  if (b) return +b[1] + +b[2] + 1;
  // Vòng quyết định sau 5 vòng Swiss: nhãn dạng "[3-2] vs [2-3]".
  const e = /^\[(\d+)\s*-\s*(\d+)\]\s*vs/i.exec(t);
  return e ? +e[1] + +e[2] + 1 : null;
}

/** Bóc hai bảng cần dùng ngay trong trang. */
function extractFromPage() {
  const teamOf = (cell) => {
    const a = cell.querySelector('a[title]');
    return (a ? a.getAttribute('title') : cell.innerText).trim();
  };
  const tables = [...document.querySelectorAll('table')];
  // Bảng BXH: có cột đầu là hạng và ô thứ hai là tên đội.
  const stTable = tables.find((t) => {
    const r = t.rows[1];
    return r && r.cells.length >= 4 && /^\d+$/.test(r.cells[0].innerText.trim());
  });
  // Bảng trận: đủ 5 cột Date | Round | Opponent | Score | vs. Opponent.
  const mtTable = tables.find((t) => {
    const h = t.rows[0];
    return h && /date/i.test(h.innerText) && /score/i.test(h.innerText);
  });

  const standings = stTable ? [...stTable.rows].slice(1).map((r) => {
    if (r.cells.length < 4) return null;
    const c = [...r.cells].map((x) => x.innerText.trim().replace(/\s+/g, ''));
    if (!/^\d+$/.test(c[0])) return null;
    // Liquipedia tự đánh dấu đội đi tiếp / bị loại bằng data-position-status
    // (up = đi tiếp, down = bị loại, stay/staydown = còn đang tranh). Dùng dấu này
    // thay vì tự suy ra từ số trận thắng, vì luật đi tiếp đổi theo từng vòng.
    return { rank: +c[0], team: teamOf(r.cells[1]), matches: c[2], games: c[3],
             pos: r.getAttribute('data-position-status') || '' };
  }).filter(Boolean) : [];

  const rows = mtTable ? [...mtTable.rows].slice(1).map((r) => {
    if (r.cells.length < 5) return null;
    const c = r.cells;
    const ts = c[0].querySelector('[data-timestamp]');
    return {
      date: c[0].innerText.trim(),
      ts: ts ? +ts.getAttribute('data-timestamp') : null,
      round: c[1].innerText.trim(),
      a: teamOf(c[2]),
      score: c[3].innerText.trim(),
      b: teamOf(c[4]),
    };
  }).filter(Boolean) : [];

  return { standings, rows };
}

/**
 * Lấy HTML đã render của trang qua API chính thức `action=parse`.
 *
 * Vì sao không tải thẳng trang: Liquipedia chặn việc cào trang HTML từ IP trung tâm
 * dữ liệu (GitHub Actions runner nằm trong nhóm này) — trang trả về không có bảng nào
 * và `waitForSelector('table')` hết giờ. api.php thì cho phép truy cập tự động, miễn là
 * User-Agent có thông tin liên hệ và tôn trọng giới hạn 1 request/30 giây cho action=parse.
 */
async function fetchParsedHtml(title = PAGE_TITLE) {
  const api = 'https://liquipedia.net/dota2/api.php?action=parse&format=json&formatversion=2'
    + '&prop=text&page=' + encodeURIComponent(title);
  const r = await fetch(api, {
    // Không tự đặt Accept-Encoding: Node đã gửi sẵn gzip/deflate/br và tự giải nén.
    headers: { 'User-Agent': UA, 'Accept': 'application/json' },
  });
  if (!r.ok) {
    const body = (await r.text()).slice(0, 200).replace(/\s+/g, ' ');
    throw new Error(`api.php HTTP ${r.status} — ${body}`);
  }
  const j = await r.json();
  if (j.error) throw new Error(`api.php lỗi: ${j.error.code} — ${j.error.info}`);
  // formatversion=2 trả text là chuỗi; bản cũ trả { '*': '<html>' }.
  const html = typeof j?.parse?.text === 'string' ? j.parse.text : j?.parse?.text?.['*'];
  if (!html) throw new Error('api.php không trả về HTML');
  return html;
}

/**
 * Tải bảng thô từ Liquipedia. Đặt biến môi trường LQ_FIXTURE=<file.json> để nạp
 * dữ liệu mẫu thay vì mở mạng — dùng khi kiểm thử ở máy không ra được Liquipedia.
 */
async function fetchRaw() {
  if (process.env.LQ_FIXTURE) {
    console.log(`Dùng dữ liệu mẫu: ${process.env.LQ_FIXTURE}`);
    return { raw: JSON.parse(await readFile(process.env.LQ_FIXTURE, 'utf8')), browser: null, page: null };
  }
  // Nạp playwright ở đây thôi, để đường chạy bằng dữ liệu mẫu không cần cài trình duyệt.
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ userAgent: UA, locale: 'en-US', timezoneId: 'UTC' });
  const page = await ctx.newPage();

  let raw = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      // Đường chính: API. Trình duyệt ở đây chỉ đóng vai trò bộ phân tích DOM.
      const html = await fetchParsedHtml();
      await page.setContent(`<!doctype html><html><body>${html}</body></html>`,
        { waitUntil: 'domcontentloaded' });
      raw = await page.evaluate(extractFromPage);
      if (raw.standings.length && raw.rows.length) break;
      throw new Error(`API trả về HTML nhưng không có bảng cần tìm (${html.length} ký tự)`);
    } catch (eApi) {
      console.error(`Lần thử ${attempt}/3 — API hỏng: ${eApi.message}`);
      // Đường dự phòng: tải thẳng trang. Thường bị chặn trên runner nhưng chạy được ở máy nhà.
      try {
        const resp = await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
        const st = resp ? resp.status() : 0;
        if (st !== 200) throw new Error(`tải trang trả HTTP ${st}`);
        await page.waitForSelector('table', { timeout: 30000 });
        raw = await page.evaluate(extractFromPage);
        if (raw.standings.length && raw.rows.length) { console.log('Dùng đường dự phòng: tải thẳng trang.'); break; }
        const t = await page.title();
        throw new Error(`trang tải được nhưng không có bảng (tiêu đề: "${t}")`);
      } catch (ePage) {
        console.error(`Lần thử ${attempt}/3 — tải trang hỏng: ${ePage.message}`);
        raw = null;
      }
    }
    // Điều khoản Liquipedia: action=parse tối đa 1 request/30 giây.
    if (attempt < 3) await new Promise((r) => setTimeout(r, 31000));
  }
  // Giữ trình duyệt mở: hàm gọi còn cần `page` để đọc tiếp trang playoffs.
  if (!raw) { await browser.close(); return { raw: null, browser: null, page: null }; }
  return { raw, browser, page };
}

/**
 * Bảng trận của trang Main Event có đúng dạng 5 cột như vòng bảng, nhưng cột Round
 * là tên nhánh ("Upper Bracket Quarterfinals"…) chứ không phải số vòng, và phần lớn
 * các cặp còn là TBD cho tới khi vòng trước đá xong.
 */
async function fetchPlayoffs(page) {
  if (process.env.LQ_FIXTURE_PLAYOFF) {
    return JSON.parse(await readFile(process.env.LQ_FIXTURE_PLAYOFF, 'utf8'));
  }
  if (!page) return [];
  try {
    const html = await fetchParsedHtml(PLAYOFF_TITLE);
    await page.setContent(`<!doctype html><html><body>${html}</body></html>`,
      { waitUntil: 'domcontentloaded' });
    return (await page.evaluate(extractFromPage)).rows;
  } catch (e) {
    console.error(`Không đọc được nhánh playoffs: ${e.message}`);
    return [];
  }
}

async function main() {
  const { raw, browser, page } = await fetchRaw();
  // Điều khoản Liquipedia: action=parse tối đa 1 request/30 giây.
  if (raw && !process.env.LQ_FIXTURE) await new Promise((r) => setTimeout(r, 31000));
  const playoffRows = raw ? await fetchPlayoffs(page) : [];
  if (browser) await browser.close();

  if (!raw) {
    console.error('Không lấy được dữ liệu Liquipedia — giữ nguyên file cũ.');
    process.exit(1);
  }

  // ---- Chuẩn hoá ----
  const unknown = new Set();
  const slug = (n) => {
    const s = NAME2SLUG[n];
    if (!s && n && !/^TBD/i.test(n)) unknown.add(n);
    return s || null;
  };

  const done = [], live = [], upcoming = [];
  for (const r of raw.rows) {
    const a = slug(r.a), b = slug(r.b);
    const d = isoDate(r.date);
    const rd = roundOf(r.round);
    const m = /^(\d+)\s*:\s*(\d+)/.exec(r.score);
    if (!a || !b) {
      if (!m && r.ts) upcoming.push({ ts: r.ts, r: rd, a: null, b: null }); // cặp chưa xác định
      continue;
    }
    if (m) {
      const sa = +m[1], sb = +m[2];
      // Bo3: trận chỉ tính là xong khi một bên đủ 2 ván. Còn lại là đang đấu.
      (Math.max(sa, sb) >= 2 ? done : live).push({ d, r: rd, a, sa, b, sb });
    } else {
      upcoming.push({ ts: r.ts, r: rd, a, b });
    }
  }
  if (unknown.size) console.error(`Cảnh báo: chưa map được tên đội: ${[...unknown].join(', ')}`);

  const standings = raw.standings.map((s) => {
    const t = slug(s.team);
    const [mw, ml] = s.matches.split('-').map(Number);
    const [gw, gl] = s.games.split('-').map(Number);
    return t ? { rk: s.rank, t, mw, ml, gw, gl, pos: s.pos || '' } : null;
  }).filter(Boolean);

  // ---- Chốt an toàn: giao diện Liquipedia đổi thì thà không ghi còn hơn ghi sai ----
  if (standings.length < 12 || done.length < 8) {
    console.error(`Dữ liệu quá mỏng (BXH ${standings.length} dòng, ${done.length} trận đã xong) — huỷ ghi.`);
    process.exit(1);
  }

  // ---- Đối chiếu chéo: BXH phải khớp với tổng hợp từ chính các trận bóc được ----
  // Bảng BXH của Liquipedia chỉ tính 5 vòng Swiss; vòng quyết định (r > 5) nằm
  // ở bảng riêng nên phải loại ra, không thì đối chiếu sẽ báo lệch giả.
  const SWISS_ROUNDS = 5;
  const acc = {};
  const bump = (t) => (acc[t] ||= { mw: 0, ml: 0, gw: 0, gl: 0 });
  for (const m of [...done, ...live].filter((m) => !m.r || m.r <= SWISS_ROUNDS)) {
    const A = bump(m.a), B = bump(m.b);
    A.gw += m.sa; A.gl += m.sb; B.gw += m.sb; B.gl += m.sa;
    if (Math.max(m.sa, m.sb) >= 2) { // trận đang đấu chưa tính vào thắng/thua trận
      if (m.sa > m.sb) { A.mw++; B.ml++; } else { B.mw++; A.ml++; }
    }
  }
  let mismatch = 0;
  for (const s of standings) {
    const a = acc[s.t] || { mw: 0, ml: 0, gw: 0, gl: 0 };
    if (a.mw !== s.mw || a.ml !== s.ml || a.gw !== s.gw || a.gl !== s.gl) {
      console.error(`  lệch ${s.t}: BXH ${s.mw}-${s.ml} (${s.gw}-${s.gl}) vs tính lại ${a.mw}-${a.ml} (${a.gw}-${a.gl})`);
      mismatch++;
    }
  }
  console.log(mismatch ? `Đối chiếu BXH: ${mismatch} đội lệch (vẫn ghi, xem log).` : 'Đối chiếu BXH: khớp hoàn toàn.');

  // ---- Chuẩn hoá nhánh playoffs ----
  const playoffs = [];
  for (const r of playoffRows) {
    const m = /^(\d+)\s*:\s*(\d+)/.exec(r.score);
    const bo = /Bo(\d)/i.exec(r.score);
    const A = NAME2SLUG[r.a] || null, B = NAME2SLUG[r.b] || null;
    const e = { ts: r.ts || null, round: r.round, a: A, b: B, bo: bo ? +bo[1] : 3 };
    if (m) { e.sa = +m[1]; e.sb = +m[2]; e.done = Math.max(+m[1], +m[2]) >= Math.ceil(e.bo / 2) ? 1 : 0; }
    playoffs.push(e);
  }
  // Đội đã có tên trong nhánh playoffs thì chắc chắn đi tiếp. Trang vòng bảng đôi khi
  // còn để dấu "stay" một thời gian sau khi vòng cuối kết thúc, nên lấy nhánh làm chuẩn.
  const inPlayoffs = new Set(playoffs.flatMap((p) => [p.a, p.b]).filter(Boolean));
  for (const s of standings) if (inPlayoffs.has(s.t)) s.pos = 'up';
  if (playoffs.length) {
    const withTeams = playoffs.filter((p) => p.a && p.b).length;
    console.log(`Nhánh playoffs: ${playoffs.length} trận (${withTeams} trận đã biết cặp, ${inPlayoffs.size} đội vào nhánh).`);
  }

  // Kết quả playoffs cũng là trận TI, gộp vào danh sách để ghi tiếp vào lịch sử đối đầu.
  const playoffDone = playoffs
    .filter((p) => p.done && p.a && p.b)
    .map((p) => ({ d: p.ts ? new Date(p.ts * 1000).toISOString().slice(0, 10) : null,
                   r: null, a: p.a, sa: p.sa, b: p.b, sb: p.sb }))
    .filter((p) => p.d);

  // ---- Ghi data/ti-groups.json ----
  const now = new Date();
  await mkdir(join(ROOT, 'data'), { recursive: true });
  await writeFile(OUT_GROUPS, JSON.stringify({
    updatedAt: now.toISOString(),
    event: EVENT,
    stage: 'Vòng bảng (Swiss, 5 vòng, Bo3)',
    source: 'Liquipedia',
    sourceUrl: PAGE_URL,
    license: 'CC BY-SA 3.0',
    crossCheck: mismatch ? `${mismatch} đội lệch` : 'khớp',
    standings,
    matches: done.sort((x, y) => (x.d === y.d ? x.r - y.r : x.d < y.d ? -1 : 1)),
    live,
    upcoming,
    playoffs,
    playoffUrl: PLAYOFF_URL,
  }) + '\n');
  console.log(`Đã ghi ${OUT_GROUPS}: ${standings.length} dòng BXH, ${done.length} trận xong, ${live.length} đang đấu, ${upcoming.length} sắp đấu.`);

  // ---- Chèn trận TI mới vào data/h2h.json ----
  let h2h = null;
  try { h2h = JSON.parse(await readFile(OUT_H2H, 'utf8')); } catch { /* chưa có */ }
  if (!h2h || !h2h.pairs) {
    console.error('Không đọc được data/h2h.json — bỏ qua bước cập nhật lịch sử đối đầu.');
    return;
  }
  let added = 0;
  for (const m of [...done, ...playoffDone]) {
    const [k0, k1] = [m.a, m.b].sort();
    const key = `${k0}|${k1}`;
    const s0 = m.a === k0 ? m.sa : m.sb;
    const s1 = m.a === k0 ? m.sb : m.sa;
    const p = (h2h.pairs[key] ||= { n: 0, series: [] });
    p.series ||= [];
    const dup = p.series.some((e) => e[0] === m.d && e[1] === EVENT && e[2] === s0 && e[3] === s1);
    if (dup) continue;
    p.series.push([m.d, EVENT, s0, s1]);
    p.series.sort((x, y) => (x[0] < y[0] ? 1 : x[0] > y[0] ? -1 : 0)); // mới nhất lên đầu
    added++;
  }
  if (added) {
    h2h.updatedAt = now.toISOString();
    const all = [...done, ...playoffDone].sort((x, y) => (x.d < y.d ? -1 : 1));
    const last = all[all.length - 1];
    h2h.note = `Lịch sử đối đầu tự cập nhật từ Liquipedia, tới hết ${last.d.slice(8, 10)}/${last.d.slice(5, 7)}/${last.d.slice(0, 4)}. `
      + `Khối "chỉ số khi đối đầu" (n, st) vẫn tính trên các ván tới ${h2h.statsUntil} — chưa bóc được chỉ số từng ván của các trận TI.`;
    await writeFile(OUT_H2H, JSON.stringify(h2h) + '\n');
  }
  console.log(added ? `Đã thêm ${added} trận TI vào data/h2h.json.` : 'data/h2h.json đã đủ, không có trận mới.');
}

main().catch((e) => { console.error(e); process.exit(1); });
