/* TI 2026 — Phân tích chỉ số các đội. Đọc data/teams.json + data/meta.json. */
(function () {
  "use strict";
  const css = (v) => getComputedStyle(document.body).getPropertyValue(v).trim();
  const $ = (s) => document.querySelector(s);

  let RAW = null, META = null, TEAMS = [], charts = [];
  let sortKey = "winrate", sortAsc = false;

  const tierOf = (wr) => (wr >= 60 ? "S" : wr >= 50 ? "A" : "B");
  const tierColor = (t) => (t === "S" ? css("--blue") : t === "A" ? css("--aqua") : css("--muted"));
  const fmtPct = (v) => v + "%";
  const S = (t) => t.stats; // shortcut

  // ---------- LOAD ----------
  async function load() {
    try {
      const [t, m] = await Promise.all([
        fetch("data/teams.json").then((r) => r.json()),
        fetch("data/meta.json").then((r) => r.json()).catch(() => null),
      ]);
      RAW = t; META = m;
      TEAMS = (t.teams || []).map((x) => ({ ...x, tier: x.stats ? tierOf(x.stats.winrate) : null }));
      renderSnap(); renderAll();
    } catch (e) {
      $("#err").innerHTML = '<div class="err">Không tải được dữ liệu (data/teams.json). Nếu đang mở bằng file:// trực tiếp, hãy chạy qua một web server (xem README) hoặc dùng GitHub Pages.</div>';
      console.error(e);
    }
  }

  function renderSnap() {
    const withData = TEAMS.filter((t) => t.stats).length;
    let when = META && META.updatedAt ? new Date(META.updatedAt) : null;
    const whenStr = when ? when.toLocaleString("vi-VN", { dateStyle: "medium", timeStyle: "short" }) : "—";
    const seed = META && META.seed;
    $("#snap").innerHTML =
      `<span class="live">●</span> Cập nhật: <b>${whenStr}</b> · ${withData}/${TEAMS.length} đội có dữ liệu` +
      (seed ? " · (dữ liệu seed — chạy scraper để làm mới)" : "");
    $("#footUpdated").textContent = whenStr;
  }

  const withData = () => TEAMS.filter((t) => t.stats);

  // Logo đội: ảnh DLTV + fallback huy hiệu chữ cái đầu
  function teamLogo(t, big) {
    const cm = "mono" + (big ? " mono-lg" : ""), ci = "tlg" + (big ? " tlg-lg" : "");
    const m = '<span class="' + cm + '">' + t.name.charAt(0) + "</span>";
    if (!t.logo) return m;
    return '<span class="lgw"><img class="' + ci + '" src="' + t.logo + '" alt="" loading="lazy" onerror="this.parentElement.classList.add(\'nolg\');this.remove()">' + m + "</span>";
  }

  // ---------- KPI TILES ----------
  function renderTiles() {
    const d = withData(); if (!d.length) { $("#tiles").innerHTML = ""; return; }
    const by = (f) => [...d].sort(f)[0];
    const t = [
      (() => { const x = by((a, b) => S(b).winrate - S(a).winrate); return { l: "Winrate cao nhất", v: S(x).winrate + "%", w: x.name + " · " + S(x).maps + " ván" }; })(),
      (() => { const x = by((a, b) => S(b).killDiff - S(a).killDiff); return { l: "Chênh K–D tốt nhất", v: (S(x).killDiff > 0 ? "+" : "") + S(x).killDiff, w: x.name }; })(),
      (() => { const x = by((a, b) => S(b).winWhenF10 - S(a).winWhenF10); return { l: "Đóng trận chắc nhất", v: S(x).winWhenF10 + "%", w: x.name + " · thắng khi có F10" }; })(),
      (() => { const x = by((a, b) => S(a).duration - S(b).duration); return { l: "Kết trận nhanh nhất", v: S(x).duration + "′", w: x.name }; })(),
      (() => { const x = by((a, b) => S(b).totalKills - S(a).totalKills); return { l: "Trận nhiều máu nhất", v: S(x).totalKills.toFixed(1), w: x.name + " · tổng kills/trận" }; })(),
    ];
    $("#tiles").innerHTML = t.map((x) =>
      `<div class="tile"><div class="lbl">${x.l}</div><div class="val">${x.v}</div><div class="who"><b>${x.w.split(" · ")[0]}</b>${x.w.includes("·") ? " · " + x.w.split(" · ").slice(1).join(" · ") : ""}</div></div>`
    ).join("");
  }

  // ---------- TABLE ----------
  const COLS = [
    { k: "name", t: "Đội", cls: "team", fmt: (v) => v },
    { k: "tier", t: "Tier", noheat: true, fmt: (v) => v ? `<span class="tierbadge t${v}">${v}</span>` : "—" },
    { k: "maps", t: "Ván" }, { k: "winrate", t: "WR%", fmt: fmtPct },
    { k: "kills", t: "Kills", fmt: (v) => v.toFixed(2) }, { k: "deaths", t: "Deaths", fmt: (v) => v.toFixed(2), invert: true },
    { k: "killDiff", t: "Chênh K–D", fmt: (v) => (v > 0 ? "+" : "") + v.toFixed(2) },
    { k: "totalKills", t: "Tổng kills", fmt: (v) => v.toFixed(1) }, { k: "assists", t: "Assists", fmt: (v) => v.toFixed(1) },
    { k: "firstBlood", t: "FB%", fmt: fmtPct }, { k: "f10", t: "F10%", fmt: fmtPct },
    { k: "winWhenFb", t: "Thắng|FB", fmt: fmtPct }, { k: "winWhenF10", t: "Thắng|F10", fmt: fmtPct },
    { k: "duration", t: "Dur′" },
  ];
  const val = (team, k) => (k === "name" ? team.name : k === "tier" ? team.tier : team.stats ? team.stats[k] : null);

  function mix(a, b, tt) {
    const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const [r1, g1, b1] = p(a), [r2, g2, b2] = p(b);
    const r = Math.round(r1 + (r2 - r1) * tt), g = Math.round(g1 + (g2 - g1) * tt), bl = Math.round(b1 + (b2 - b1) * tt);
    return `rgb(${r},${g},${bl})`;
  }
  function heat(col, v) {
    if (col.noheat || col.k === "name" || v == null) return "";
    const vs = withData().map((t) => t.stats[col.k]); const mn = Math.min(...vs), mx = Math.max(...vs);
    let f = (v - mn) / (mx - mn || 1); if (col.invert) f = 1 - f;
    return `background:${mix(css("--heat-lo"), css("--heat-hi"), f * 0.85)};color:#0b0b0b`;
  }
  function renderTable() {
    const rows = [...TEAMS].sort((a, b) => {
      const x = val(a, sortKey), y = val(b, sortKey);
      if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1;
      if (typeof x === "string") return sortAsc ? x.localeCompare(y) : y.localeCompare(x);
      return sortAsc ? x - y : y - x;
    });
    let h = "<thead><tr>" + COLS.map((c) => `<th data-k="${c.k}" class="${c.k === sortKey ? "active " + (sortAsc ? "asc" : "") : ""}">${c.t}</th>`).join("") + "</tr></thead><tbody>";
    h += rows.map((t) => "<tr>" + COLS.map((c) => {
      const v = val(t, c.k);
      if (v == null && c.k !== "name" && c.k !== "tier") return `<td style="color:var(--muted)">—</td>`;
      const fmt = c.fmt || ((x) => x);
      const cell = c.k === "name" ? teamLogo(t) + fmt(v) : fmt(v);
      return `<td class="${c.cls || ""}" style="${heat(c, v)}">${cell}</td>`;
    }).join("") + "</tr>").join("");
    h += "</tbody>";
    const tbl = $("#tbl"); tbl.innerHTML = h;
    tbl.querySelectorAll("th").forEach((th) => th.onclick = () => {
      const k = th.dataset.k; if (k === sortKey) sortAsc = !sortAsc; else { sortKey = k; sortAsc = false; } renderTable();
    });
  }

  // ---------- AUTO INSIGHTS (reports) ----------
  function tagsFor(s) {
    const tags = [];
    if (s.winrate >= 65) tags.push(["Phong độ đỉnh cao", 0]);
    if (s.killDiff >= 5) tags.push(["Áp đảo giao tranh", 0]);
    if (s.firstBlood >= 55 || s.f10 >= 62) tags.push(["Áp nhịp sớm", 0]);
    if (s.assists >= 64) tags.push(["Teamfight gắn kết", 0]);
    if (s.winWhenF10 >= 85) tags.push(["Đóng trận kỷ luật", 0]);
    if (s.duration >= 45) tags.push(["Vận hành muộn", 0]);
    if (s.duration <= 41) tags.push(["Kết trận nhanh", 0]);
    if (s.killDiff <= -3) tags.push(["Bị áp đảo giao tranh", 1]);
    if (s.winWhenFb <= 45) tags.push(["Chuyển hoá lợi thế kém", 1]);
    if (s.winrate < 45) tags.push(["Đang sa sút", 1]);
    return tags.slice(0, 5);
  }
  function insight(t) {
    const s = t.stats;
    const bits = [];
    bits.push(`${t.name} đạt winrate <b>${s.winrate}%</b> qua ${s.maps} ván`);
    bits.push(s.killDiff >= 3 ? `áp đảo giao tranh rõ rệt (chênh K–D <b>+${s.killDiff}</b>)`
      : s.killDiff <= -3 ? `bị lép vế trong giao tranh (chênh K–D <b>${s.killDiff}</b>)`
      : `giao tranh cân bằng (chênh K–D ${s.killDiff > 0 ? "+" : ""}${s.killDiff})`);
    bits.push(s.f10 >= 60 ? `thường chiếm ưu thế sớm (F10 <b>${s.f10}%</b>)`
      : s.f10 <= 48 ? `ít khi thắng nhịp đầu (F10 ${s.f10}%)`
      : `nhịp đầu ở mức trung bình (F10 ${s.f10}%)`);
    bits.push(s.winWhenF10 >= 85 ? `và đóng trận rất chắc khi dẫn trước (thắng khi có F10 <b>${s.winWhenF10}%</b>)`
      : s.winWhenFb <= 45 ? `nhưng chuyển hoá lợi thế còn yếu (thắng khi có FB ${s.winWhenFb}%)`
      : `thời lượng trận trung bình ${s.duration} phút`);
    return bits.join(", ") + ".";
  }
  function renderReports() {
    const sorted = [...TEAMS].sort((a, b) => {
      if (a.stats && b.stats) return b.stats.winrate - a.stats.winrate;
      return a.stats ? -1 : b.stats ? 1 : 0;
    });
    $("#reports").innerHTML = sorted.map((t) => {
      const qCls = t.qualification && t.qualification.includes("Mời") ? "badge-invite" : "badge-qual";
      if (!t.stats) {
        return `<div class="nodata"><div class="thead"><span class="tname" style="font-size:15px">${teamLogo(t, true)}${t.name}</span><span class="pill">${t.region}</span></div>
          <div style="margin-top:8px">Chưa có dữ liệu.${t.slugVerified === false ? " Cần xác minh slug DLTV trong cấu hình." : ""}</div></div>`;
      }
      const s = t.stats;
      const tg = tagsFor(s).map(([txt, warn]) => `<span class="tag${warn ? " warn" : ""}">${txt}</span>`).join("");
      const M = (l, v) => `<div class="metric"><div class="m-l">${l}</div><div class="m-v">${v}</div></div>`;
      return `<div class="tcard">
        <div class="thead"><span class="tname">${teamLogo(t, true)}${t.name} <span class="tierbadge t${t.tier}">${t.tier}</span></span>
          <span class="treg">${t.region} · <span class="${qCls}">${t.qualification}</span></span></div>
        <div class="tags">${tg || '<span class="tag">Cân bằng</span>'}</div>
        <div class="metrics">
          ${M("Winrate", s.winrate + "%")} ${M("Chênh K–D", (s.killDiff > 0 ? "+" : "") + s.killDiff)} ${M("Tổng kills", s.totalKills.toFixed(1))}
          ${M("F10", s.f10 + "%")} ${M("Thắng|F10", s.winWhenF10 + "%")} ${M("Thời lượng", s.duration + "′")}
        </div>
        <div class="insight">${insight(t)}</div>
      </div>`;
    }).join("");
  }

  // ---------- CHARTS ----------
  function destroy() { charts.forEach((c) => c.destroy()); charts = []; }
  function buildCharts() {
    if (typeof Chart === "undefined") {
      document.querySelectorAll(".chart-box").forEach((b) => b.innerHTML =
        '<div style="display:flex;height:100%;align-items:center;justify-content:center;color:var(--muted);font-size:13px;text-align:center;padding:20px">Không tải được thư viện biểu đồ (cần kết nối mạng).</div>');
      return;
    }
    if (!Chart.__dl) { Chart.register(ChartDataLabels); Chart.__dl = true; }
    destroy();
    Chart.defaults.font.family = "system-ui,-apple-system,'Segoe UI',sans-serif";
    const ink = css("--text-primary"), sec = css("--text-secondary"), grid = css("--grid");
    const d = withData(); if (!d.length) return;

    // radar top5
    const top5 = [...d].sort((a, b) => S(b).winrate - S(a).winrate).slice(0, 5);
    const axes = [["winrate", "Winrate"], ["killDiff", "Chênh K–D"], ["f10", "Kiểm soát sớm"], ["winWhenF10", "Đóng trận"], ["assists", "Phối hợp"], ["kills", "Sát thương"]];
    const norm = (k, v) => { const vs = d.map((t) => S(t)[k]); const mn = Math.min(...vs), mx = Math.max(...vs); return Math.round((v - mn) / (mx - mn || 1) * 100); };
    const hues = [css("--blue"), css("--aqua"), css("--yellow"), css("--green"), css("--violet")];
    charts.push(new Chart($("#radar"), {
      type: "radar",
      data: { labels: axes.map((a) => a[1]), datasets: top5.map((t, i) => ({ label: t.name, data: axes.map((a) => norm(a[0], S(t)[a[0]])), borderColor: hues[i], backgroundColor: hues[i] + "22", borderWidth: 2, pointBackgroundColor: hues[i], pointRadius: 3 })) },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom", labels: { color: sec, boxWidth: 12, padding: 14 } }, datalabels: { display: false }, tooltip: { callbacks: { label: (c) => c.dataset.label + ": " + c.raw + "/100" } } }, scales: { r: { angleLines: { color: grid }, grid: { color: grid }, pointLabels: { color: ink, font: { size: 12 } }, ticks: { display: false, stepSize: 25 }, min: 0, max: 100 } } }
    }));

    // winrate bar
    const wr = [...d].sort((a, b) => S(a).winrate - S(b).winrate);
    charts.push(new Chart($("#wr"), {
      type: "bar",
      data: { labels: wr.map((t) => t.short), datasets: [{ data: wr.map((t) => S(t).winrate), backgroundColor: wr.map((t) => tierColor(t.tier)), borderRadius: 4, barThickness: 15 }] },
      options: { indexAxis: "y", responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, datalabels: { anchor: "end", align: "end", color: sec, formatter: (v) => v + "%", font: { size: 11 } }, tooltip: { callbacks: { title: (i) => wr[i[0].dataIndex].name, label: (c) => "Winrate: " + c.raw + "%" } } }, layout: { padding: { right: 30 } }, scales: { x: { grid: { color: grid }, ticks: { color: sec, callback: (v) => v + "%" }, max: 80 }, y: { grid: { display: false }, ticks: { color: ink } } } }
    }));

    // kd diverging
    const kd = [...d].sort((a, b) => S(a).killDiff - S(b).killDiff);
    charts.push(new Chart($("#kd"), {
      type: "bar",
      data: { labels: kd.map((t) => t.short), datasets: [{ data: kd.map((t) => S(t).killDiff), backgroundColor: kd.map((t) => S(t).killDiff >= 0 ? css("--blue") : css("--red")), borderRadius: 4, barThickness: 15 }] },
      options: { indexAxis: "y", responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, datalabels: { anchor: (c) => c.dataset.data[c.dataIndex] >= 0 ? "end" : "start", align: (c) => c.dataset.data[c.dataIndex] >= 0 ? "end" : "start", color: sec, formatter: (v) => (v > 0 ? "+" : "") + v.toFixed(1), font: { size: 11 } }, tooltip: { callbacks: { title: (i) => kd[i[0].dataIndex].name, label: (c) => "Chênh K–D: " + (c.raw > 0 ? "+" : "") + c.raw } } }, layout: { padding: { right: 26, left: 26 } }, scales: { x: { grid: { color: grid }, ticks: { color: sec }, suggestedMin: -6, suggestedMax: 10 }, y: { grid: { display: false }, ticks: { color: ink } } } }
    }));

    // scatter kills vs deaths
    const pt = (t) => ({ x: S(t).kills, y: S(t).deaths, team: t.name, short: t.short });
    charts.push(new Chart($("#scatterKD"), {
      type: "scatter",
      data: { datasets: [{ data: d.map(pt), pointBackgroundColor: d.map((t) => tierColor(t.tier)), pointBorderColor: css("--surface-1"), pointBorderWidth: 1.5, pointRadius: 7, pointHoverRadius: 9 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, datalabels: { color: sec, font: { size: 10 }, align: "right", offset: 4, formatter: (v) => v.short }, tooltip: { callbacks: { label: (c) => c.raw.team + ": " + c.raw.x + " K / " + c.raw.y + " D" } } }, scales: { x: { title: { display: true, text: "Kills / trận", color: sec }, grid: { color: grid }, ticks: { color: sec } }, y: { title: { display: true, text: "Deaths / trận", color: sec }, grid: { color: grid }, ticks: { color: sec } } } }
    }));

    // scatter f10 vs winf10
    const pt2 = (t) => ({ x: S(t).f10, y: S(t).winWhenF10, team: t.name, short: t.short });
    charts.push(new Chart($("#scatterF10"), {
      type: "scatter",
      data: { datasets: [{ data: d.map(pt2), pointBackgroundColor: d.map((t) => tierColor(t.tier)), pointBorderColor: css("--surface-1"), pointBorderWidth: 1.5, pointRadius: 7, pointHoverRadius: 9 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, datalabels: { color: sec, font: { size: 10 }, align: "right", offset: 4, formatter: (v) => v.short }, tooltip: { callbacks: { label: (c) => c.raw.team + ": F10 " + c.raw.x + "% · thắng " + c.raw.y + "%" } } }, scales: { x: { title: { display: true, text: "F10 — giành 10 kill đầu (%)", color: sec }, grid: { color: grid }, ticks: { color: sec, callback: (v) => v + "%" } }, y: { title: { display: true, text: "Thắng khi có F10 (%)", color: sec }, grid: { color: grid }, ticks: { color: sec, callback: (v) => v + "%" } } } }
    }));
  }

  // ---------- RENDER + NAV ----------
  function renderAll() { renderTiles(); renderTable(); renderReports(); buildCharts(); }

  $("#tabs").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-view]"); if (!b) return;
    document.querySelectorAll("nav.tabs button").forEach((x) => x.classList.toggle("active", x === b));
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
    $("#view-" + b.dataset.view).classList.add("active");
    if (b.dataset.view === "overview") buildCharts(); // ensure sizing when shown
  });

  $("#themeBtn").addEventListener("click", function () {
    const dark = document.body.getAttribute("data-theme") === "dark";
    document.body.setAttribute("data-theme", dark ? "light" : "dark");
    this.textContent = dark ? "🌙 Chế độ tối" : "☀️ Chế độ sáng";
    renderAll();
  });
  if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
    document.body.setAttribute("data-theme", "dark");
    $("#themeBtn").textContent = "☀️ Chế độ sáng";
  }

  load();
})();
