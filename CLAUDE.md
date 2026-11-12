# 信通家俱行網站（hsintong.cc）

## 關於店家與合作方式
- 店家：信通家俱行，台北市大安區文昌街184號。老闆自己一個人經營網站，不是工程師。
- 一律用繁體中文回覆，用白話解釋，不要丟一堆技術名詞。
- 有好幾種做法時，先給建議並說明原因。

## 專案架構
- GitHub Pages 從 `main` 發佈，網域 hsintong.cc。
- 前台：`index.html` ＋ `shop-render.js`（前台、後台、自動產生頁面共用的顯示規則，不能用 document／window）。
- 後台：`manage.html` ＋ `admin/`（manage.css、manage.js、image-tools.js、rich-text.js、csv.js、util.js）。
- 資料：Firebase Firestore（商品、分類、聯繫資訊）；照片：Cloudinary 圖床。
- 每小時自動更新（`.github/workflows/build-pages.yml` → `_tools/build-pages.mjs`）：
  - 產生商品頁 `p/*.html`、分類頁 `c/*.html`、`sitemap.xml`、`data/site.json`、`llms.txt`。
  - 把店家資料（structuredData）、聯繫資訊（contactItems、contactActions）、分類按鈕（categoriesBar、catSidebar）填進 `index.html`；改版型照常直接改 index.html。
  - `_tools/subset-fonts.py` 會把標題字型瘦身成只含網站用到的字。
- 改了 `shop-render.js` 或 `admin/` 底下的檔案，引用它的地方 `?v=` 數字要加一（目前 shop-render.js 是 v=10）。
- 改版前先讀最近的 PR（#28、#29、#30）和程式裡的註解，了解目前的做法。

## 工作流程
1. 老闆說要改什麼：先在工作分支上改好，截圖給他看，等他確認。
2. 他沒說「push」之前：只推到工作分支，不動 main、不開 PR。
3. 他說「push」時：
   1. 先把工作分支 rebase 到最新的 `origin/main`（自動更新的機器人每小時會往 main 提交）。
   2. 開 PR，用 squash 合併，`expectedHeadSha` 填完整 40 碼。
   3. 幾分鐘後確認 GitHub Pages 部署和「更新商品頁」workflow 都成功（合併當下那次 Pages 顯示 cancelled 是正常的，會被機器人那次取代）。
   4. 確認機器人的「自動更新商品頁」commit 內容正確。
   5. 把工作分支重設到最新的 `origin/main`。
   6. 用白話跟老闆回報結果。

## 一定要遵守
- 不要寫入正式的 Firestore 資料；測試請用模擬資料（`data/site.json` 可以當測試資料，`FIRESTORE_BASE` 可以讓 build-pages 讀本機的假資料庫）。
- 絕對不要 force push 到 main。
- 不要刪除專案以外的東西。
- 收藏清單的保存時間（4 小時，`FAVORITES_TTL_MS`）不要改。
- 字重限制：標題字型只有 400／500／600。
- 視覺 2.1（2026-11）：標題改用裝置內建的黑體，只有店名、首頁大標保留明體（`--font-brand`）；調整都集中在 index.html `<style>` 最後「視覺 2.1」那段，互動在檔案最後的 siteFx。

## 目前狀態（2026 年 11 月初）
已完成：設計系統 2.0、商品卡片價格格式（特價與原價同一行，原價 10px 加刪除線）、頁面速度優化、
後台拆檔、兩台裝置同時編輯的提醒、每個商品可自訂 Google 搜尋說明、照片替代文字、
16 個分類頁、店家結構化資料（含經緯度 25.032357, 121.554016，寫在 shop-render.js 的 STORE_GEO）、網站小圖示、llms.txt。

還沒做、等老闆決定：
- 57 件商品沒有標價，Google 的商品搜尋結果不顯示，要決定要不要標參考價。
- 21 頁商品說明重複、說明普遍太短，要補寫。
- 大多數商品只有 1 張照片，建議補到 3 張。
- Google 商家檔案、Bing 地標（Bing Places）是老闆自己要處理的。
