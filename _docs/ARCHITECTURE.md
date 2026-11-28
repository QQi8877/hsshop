# 系統架構與修改規則

給之後接手的人或模型看的，照這份就能改，不用把整個專案讀一遍。
`CLAUDE.md` 放的是一定要遵守的規則和工作流程；這份是「東西在哪、怎麼改、改完怎麼驗」。

## 1. 先看這裡：省用量的讀法

- **不要讀、不要改** `p/`、`c/`、`data/site.json`、`sitemap.xml`、`llms.txt`、`fonts/`：都是每小時自動產生的。
- 大檔案先用搜尋找段落標題，再只讀那一段。每個檔案都用 `/* ── 標題 ──` 分段（見第 3 節的段落表）。
- 改畫面通常只要動 `index.html` 的 `<style>`；改前台行為通常只要動 `site.js` 某一段；
  改「商品頁右邊那欄、卡片、尺寸」這類文字內容才動 `shop-render.js`。
- 不確定一段樣式或程式有沒有人用：先搜尋 class 名或函式名，再決定。

## 2. 檔案分工（誰負責什麼、誰依賴誰）

| 檔案 | 負責 | 可以用 document／window | 誰在用 |
|---|---|---|---|
| `index.html` | 首頁的 HTML、全部樣式（`<style>`）、開頭幾段要最早跑的小程式 | 是 | 瀏覽器；也是 `p/`、`c/` 的版型 |
| `site.js` | 前台主程式：載資料、畫商品格、分類、搜尋、收藏、商品頁、siteFx 互動 | 是 | `index.html` 和所有產生的頁面 |
| `shop-render.js` | 共用的顯示規則（純函式：吃資料、吐 HTML 字串） | **不行** | `site.js`、後台、`build-pages.mjs` |
| `dim-figures.js` | 尺寸示意圖（線稿 SVG） | 不行 | `shop-render.js`、後台 |
| `manage.html` + `admin/` | 後台（商品、分類、照片、設定） | 是 | 老闆 |
| `_tools/build-pages.mjs` | 每小時：讀 Firestore → 產生 `p/`、`c/`、首頁填資料、sitemap、llms.txt | Node | GitHub Actions |
| `_tools/subset-fonts.py` | 把思源黑體（全站）、明體（店名）瘦身成只含網站用到的字 | — | GitHub Actions |
| `_tools/tests/` | 測試工具（不會發佈到網站） | — | 改完驗證用 |
| `404.html` | 舊網址轉址 | — | — |

依賴方向只能往下：`index.html → site.js → shop-render.js → dim-figures.js`。
`shop-render.js` 不能 import `site.js`，也不能碰畫面，否則後台和 `build-pages.mjs`（Node，沒有畫面）會壞。

資料流：後台寫 Firestore → 每小時 `build-pages.mjs` 讀 Firestore 產生靜態頁 → 前台先用 `data/site.json` 畫、
再換成 Firestore 的最新資料。照片在 Cloudinary，網址存在商品資料裡。

## 3. 段落表（找東西用）

`site.js`（約 2000 行）：Firebase 整合 → 分類頁路由 → 商品標籤 → 搜尋 → 商品格 → 商品列表的體驗（快速預覽、篩選、最近看過、
分類介紹「更多」、手機商品頁底部收藏列）→ 捲動進場 → 每件商品的網址／上一頁
→ 照片飛進商品頁 → 流量統計 → 掛到 window 的函式清單 → 啟動流程 → siteFx（最後面）。

`index.html <style>`（約 1500 行，由上往下是「越後面越優先」）：
1. 基本樣式（導覽列、首頁大圖、本月選品、分類磚、商品格、收藏清單、商品頁、聯絡我們）
2. `設計系統 2.0`：統一色票、尺寸的覆蓋
3. `視覺 2.1`：黑體標題、字級、siteFx 用的樣式
4. `視覺 2.2`：商品頁整頁式
5. `詢問方式`：收藏按鈕、按愛心後的提示
6. `手機版商品列表`：手機左邊兩層分類
7. `視覺 3.0`：A 版「清爽型錄」——商品卡的暖灰照片框、各寬度的欄數、篩選、最近看過、快速預覽、手機商品頁底部收藏列
8. `首頁四大區塊・整頁翻頁`（B 版）：整頁對齊（scroll-snap，`html.snap` 由 site.js 打開）、大圖和「本月選品＋分類磚」各剛好一個畫面
   （`#homeB2` 包住兩塊，--b2-* 算照片框、分類磚多高；`.b2-no-picks`／`.b2-no-tiles`／`.b2-none` 是後台關掉時）、
   `#homeRest` 包住商品列表＋購買須知＋聯繫我們（比畫面高，裡面自由捲）、右邊小圓點。手機首頁分類磚五格時 `.cat-grid.many` 縮小字

色票、尺寸用 `:root` 的變數（`--text`、`--brand`、`--bg`、`--line`…），不要寫死顏色。

## 4. 會壞的接點（改之前一定要看）

這些是不同檔案之間約好的東西，改了一邊另一邊會跟著壞。

**(1) 產生頁面靠的 id**：`build-pages.mjs` 只認下面這些 id／屬性，版面可以隨便改，但這些要留著、不能重複：
`structuredData`、`contactItems`、`contactActions`、`categoriesBar`、`catSidebar`、`listingTitle`、`listingIntro`、
`subCategoriesBar`、`productsGrid`、`lightbox`、`lbPrev`、`lbNext`、`lbImg`、`lbInfo`、`data-page-field="heroTitle"`、
`navBuyItem`、`mobileNavBuyItem`、`picksTotalCount`（首頁第二塊、第三＋四塊的外框 `homeB2`、`homeRest` 是 CSS 和 siteFx 用的，也不要拿掉），以及 `<title>`、`<body>`、`</head>`、`<meta name="description">`、`og:*`、`twitter:*`、`<link rel="canonical">`。
找不到時 `build-pages.mjs` 會直接停下來報錯，不會產生壞頁面。

**(2) HTML 的 onclick**：`site.js` 是 module，函式不會自動變成全域。HTML 上 `onclick="xxx()"` 要能用，
`xxx` 必須加進 `site.js` 裡 `Object.assign(window,{...})` 那份清單。

**(3) siteFx 跟主程式只用事件溝通**：`hs:favcount`（收藏件數）、`hs:favpanel`（收藏清單開關）、
`hs:gridall`（siteFx 送給主程式：跳到購買須知／聯繫之前，先把商品格還沒畫的商品一次畫完）、
`hs:landed`（主程式送給 siteFx：開頁第一次畫好商品，重新整理／上一頁回到原本位置也做完了，siteFx 這時才打開整頁對齊；
位置記在 sessionStorage 的 `hs_scroll_v1`）。siteFx 不要去讀主程式的變數；例外是「3. 整頁翻頁」要看首頁幾個區塊
（`#hero`、`#homeB2`、`#categories`、`#buyInfo`、`#contact`）的位置和選單的字（小圓點的名稱），改這些 id 時要一起改。

**(4) 版本號 `?v=`**：瀏覽器會快取，改了檔案就要把「引用它的地方」的數字加一：

| 改了 | 要加一的地方 |
|---|---|
| `site.js` | `index.html` 兩處（modulepreload、script） |
| `shop-render.js` | `index.html`、`site.js`、`admin/manage.js`、`admin/rich-text.js` |
| `dim-figures.js` | `index.html`、`shop-render.js`、`admin/manage.js` |
| `admin/*.js`、`manage.css` | 引用它的那一行（`manage.html` 或 `admin/manage.js`） |

一個檔案的 import 網址變了，它自己的內容也算改了，要再往上加一層（例如 `shop-render.js` 改版號 → `admin/rich-text.js` 內容變了 → `admin/manage.js` 裡 `rich-text.js?v=` 也要加）。
目前版本：site 7、shop-render 16、dim-figures 4、manage.js 12、rich-text 9、image-tools 3、manage.css 5、csv 1、util 1。

**(5) 網站文字（後台「網站文字」）**：給客人看的固定文字都登記在 `shop-render.js` 的 `TEXT_FIELDS`（key、預設文字、後台分組）。
HTML 裡整段固定的字加 `data-page-field="key"`（改程式時寫預設文字；每小時更新會把根目錄 `index.html` 換成老闆的字，所以 main 上看到的可能是老闆改過的字），前台 `applyPageText` 和 `build-pages.mjs` 的 `fillPageText` 都會換成後台填的字；
程式畫出來的字用 `textOf(pageText,key)`／`textHtml(...)`。後台表單照 `TEXT_FIELDS` 自動排出來。分類介紹另外存在 catalog 每個分類的 `intro`（後台分類管理的 📝）。
`_tools/tests/site-texts.mjs` 會檢查 HTML 的字是預設文字或老闆的字。

**(6) 每小時更新的觸發**：`.github/workflows/build-pages.yml` 的 `paths`。新增一個「產生頁面會用到」的檔案要加進去。

**(7) 商品格的欄數 ↔ 照片大小**：`index.html`「視覺 3.0」的 `--grid-cols` 斷點（手機 2 欄；電腦 761／1100／1500／1900px 起 3～6 欄）
跟 `shop-render.js` 的 `GRID_IMG_SIZES` 是一組：欄數改了沒跟著改，照片會抓太小（糊）或太大（慢）。

## 5. 常見修改要動哪裡

| 想改 | 動這裡 | 注意 |
|---|---|---|
| 網站上的固定文字（標題、按鈕、提示） | `shop-render.js` 的 `TEXT_FIELDS` 加一筆，HTML 加 `data-page-field` 或程式用 `textOf` | 不要把客人看的字直接寫死在程式裡，老闆要能在後台改 |
| 顏色、字級、間距 | `index.html <style>`：直接改原本那條規則 | 不要在最後面再加一條蓋掉它 |
| 手機版排版 | `<style>` 裡 `@media(max-width:760px)` 的區塊 | 手機／電腦的分界是 760／761px |
| 商品卡片、商品頁右邊那欄、尺寸區、價格格式 | `shop-render.js` | 改完 `p/` 要等每小時更新才會換 |
| 首頁互動、收藏、搜尋、分類切換 | `site.js` 對應段落 | 新的 onclick 記得掛 window |
| 快速預覽、篩選、最近看過、底部收藏列 | `site.js`「商品列表的體驗」段落；樣式在 `<style>`「視覺 3.0」 | 手機（760px 以下）、電腦擺的位置不同，兩種都要測（`_tools/tests/list-ux.mjs`） |
| 尺寸示意圖 | `dim-figures.js`（`FIGURES` 加一筆） | 後台選單會自動多一項 |
| 後台功能 | `admin/manage.js` 對應段落、`manage.html` | 不能寫正式 Firestore 來測 |
| 產生頁面的內容（SEO、麵包屑） | `_tools/build-pages.mjs` | 用第 4 節的 id 找位置，不要比對整段 HTML |

## 6. 寫法規則

- **樣式**：改原本的規則，不要用「後面再加一條覆蓋」的方式疊；真的要整批改版時，在 `<style>` 最後開一個有日期的段落並寫清楚蓋掉什麼，之後找時間併回去。用變數，不寫死顏色。字型只有 400／500／600（說明在 `index.html` 開頭的字型註解）。
- **程式**：沿用現在的寫法（不用框架、不用打包工具，原生 JS module）。新功能放進對應段落，段落開頭用一兩行中文寫「做什麼、為什麼」。
- **刪東西**：拿掉功能時，它專用的 class、函式、import 要一起刪（先搜尋確定沒人用）。
- **不要做的**：不要加 LINE 按鈕（見 `CLAUDE.md` 詢問方式）；不要在 `shop-render.js` 碰畫面；不要手改 `p/`、`c/`。
- **註解**：寫給不是工程師的人也看得懂的中文；不要留「改了什麼」的歷史，那個看 git。

## 7. 改完怎麼驗（不碰正式資料）

需要 Node 和 Playwright（雲端環境已預先裝好）。

```bash
node _tools/tests/run.mjs                         # 測專案現在的樣子（只改樣式、site.js 時夠用）
ROOT=$(node _tools/tests/stage.mjs 暫存資料夾 | tail -1) node _tools/tests/run.mjs   # 改了 index.html 結構、shop-render.js、build-pages.mjs 時用：先用 data/site.json 重新產生全部頁面再測
node _tools/tests/run.mjs front-smoke mobile-rail # 只跑幾個
```

- 測試用假的 Firebase、假的照片（色塊），不會寫進正式資料庫。截圖存在系統暫存資料夾（可用 `SHOTS=` 指定）。
- **重構（畫面不該變）時**：改之前、改之後各跑一次 `node _tools/tests/ui-snapshot.mjs 輸出.json`（同樣可加 `ROOT=`），
  再 `node _tools/tests/ui-diff.mjs 前.json 後.json` 比對約 60 個元件實際算出來的樣式和位置。
  `margin-left/right` 是 auto 的那幾項每次跑會略有不同，可以忽略。
- **改 `build-pages.mjs` 時**：改前改後各產生一次，用 `python3 _tools/tests/compare-generated.py 前 後` 比對（會忽略屬性順序）。
- 新功能請在 `_tools/tests/` 加一個測試檔（照現有的寫法，最後印 `N passed, M failed`）。

## 8. 已知可以再改善的地方（還沒做）

- `<style>` 還有一些「後段蓋掉前段」的覆蓋（設計系統 2.0、視覺 2.1／2.2）。要併回去時，一次只併一個段落，
  每次都用第 7 節的 ui-snapshot 比對，確定畫面沒變再做下一段。
- `admin/manage.js` 約 3600 行，之後可以依段落拆成幾個檔案（照片、分類、設定…），拆法同 2026-11 把前台主程式抽成 `site.js`。
