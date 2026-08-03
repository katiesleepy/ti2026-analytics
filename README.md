# TI 2026 — Phân tích chỉ số các đội

Trang web tĩnh phân tích **16 đội tham dự The International 2026**, dùng chỉ số thi đấu **6 tháng gần nhất** (nguồn: [DLTV.org](https://dltv.org)). Có **báo cáo tự sinh cho từng đội**, **biểu đồ tương tác** (radar, xếp hạng, bản đồ phong cách), **bảng nhiệt sắp xếp được**, dark mode, và **tự động cập nhật** qua GitHub Actions.

![tabs](https://img.shields.io/badge/TI-2026-blue) ![data](https://img.shields.io/badge/data-DLTV-green)

## Cấu trúc

```
ti2026-analytics/
├── index.html                 # Trang chính (4 tab: Tổng quan / Bảng xếp hạng / Chi tiết đội / Về trang)
├── assets/
│   ├── app.js                 # Logic: đọc data, dựng biểu đồ + báo cáo
│   └── styles.css
├── data/
│   ├── teams.json             # Dữ liệu 16 đội (scraper ghi đè)
│   └── meta.json              # Thời điểm cập nhật gần nhất
├── scraper/
│   ├── scrape.mjs             # Cào DLTV bằng Playwright
│   ├── teams.config.json      # Map 16 đội → slug DLTV
│   └── package.json
└── .github/workflows/
    └── update-data.yml        # Cron hằng ngày: scrape → commit
```

## Triển khai lên GitHub Pages (một lần)

1. Tạo repo mới trên GitHub (ví dụ `ti2026-analytics`).
2. Đẩy toàn bộ thư mục này lên nhánh `main`:
   ```bash
   cd ti2026-analytics
   git init
   git add .
   git commit -m "init: TI2026 analytics site"
   git branch -M main
   git remote add origin https://github.com/<tài-khoản>/ti2026-analytics.git
   git push -u origin main
   ```
3. Vào **Settings → Pages**, mục *Build and deployment*: chọn **Deploy from a branch**, nhánh `main`, thư mục `/ (root)`, rồi **Save**.
4. Sau ~1 phút, trang sẽ chạy tại `https://<tài-khoản>.github.io/ti2026-analytics/`.

> Trang tải Chart.js từ CDN nên **cần mạng** khi mở. Mở trực tiếp bằng `file://` sẽ chặn `fetch()` — hãy dùng GitHub Pages hoặc một web server (xem bên dưới).

## Tự động cập nhật dữ liệu

Workflow `.github/workflows/update-data.yml` chạy **mỗi ngày 02:00 UTC** (và có nút chạy tay trong tab **Actions**). Nó cài Playwright, chạy scraper, rồi commit `data/*.json` nếu có thay đổi — GitHub Pages tự phục vụ bản mới.

Cần bật quyền ghi cho Actions: **Settings → Actions → General → Workflow permissions → Read and write permissions**.

## Cập nhật thủ công (tuỳ chọn)

```bash
cd scraper
npm install            # cài Playwright + Chromium
node scrape.mjs        # ghi ../data/teams.json và ../data/meta.json
cd ..
git add data && git commit -m "chore: cập nhật dữ liệu" && git push
```

## Xem thử tại máy (local)

```bash
# từ thư mục gốc repo
python3 -m http.server 8080
# mở http://localhost:8080
```

## ⚠️ Xác minh slug DLTV

Một số đội trong `scraper/teams.config.json` có `"slugVerified": false` — slug đang là **phỏng đoán**. Nếu một đội không hiện dữ liệu sau khi scrape:

1. Mở `https://dltv.org/teams/<slug>` trên trình duyệt.
2. Nếu 404, tìm đúng đội trên DLTV và lấy slug thật từ URL.
3. Sửa `slug` trong `teams.config.json`, commit lại. Lần scrape sau sẽ điền dữ liệu.

**Đã xác minh (16/16 đội có dữ liệu):** Team Falcons, Team Liquid, Xtreme Gaming, Aurora Gaming, BetBoom Team, Team Yandex, 1win Team, Team Spirit, Nigma Galaxy, Team Resilience, Vici Gaming, OG, LGD Gaming, GamerLegion.

**Đã giải quyết:** **TEAM VISION** = `parivision` và **HULIGANI** = `l1ga-team` (hai đội đã đổi tên). Cả 16/16 đội đều có dữ liệu.

## Các chỉ số

| Chỉ số | Ý nghĩa |
|---|---|
| Winrate | Tỉ lệ thắng 6 tháng gần nhất |
| Kills / Deaths / Assists | Trung bình mỗi trận (của đội) |
| Chênh K–D | Kills − Deaths (dương = áp đảo giao tranh) |
| Tổng kills | Kills + Deaths (tổng mạng mỗi trận) |
| First Blood % | Tần suất giành mạng đầu tiên |
| F10 | Tần suất giành 10 kill đầu |
| Thắng \| FB / F10 | Tỉ lệ thắng khi có First Blood / khi giành 10 kill đầu |
| Dur | Thời lượng trận trung bình (phút) |

Tier suy ra từ winrate: **S ≥ 60%**, **A ≥ 50%**, còn lại **B**.

## Ghi chú

- Dữ liệu và bản quyền chỉ số thuộc về DLTV.org; trang này chỉ tổng hợp/trực quan hoá cho mục đích phân tích.
- Nếu DLTV đổi cấu trúc trang, hàm `parseStats()` trong `scrape.mjs` có thể cần chỉnh lại.
