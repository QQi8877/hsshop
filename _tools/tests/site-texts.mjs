// 後台「網站文字」和「分類介紹」：
// 1. index.html 上標了 data-page-field 的字，跟 shop-render.js 的 TEXT_FIELDS 預設文字一樣（沒改過時畫面不會變）
// 2. 後台改過的字，前台、商品頁、收藏清單、分類介紹都換成新的
// 3. 每小時產生的靜態頁也直接寫好新的字
// 4. 後台「網站文字」表單照清單排出來，存了會寫進網站設定；分類管理的 📝 可以寫分類介紹
import {launch,setup,seedStore,ORIGIN,ROOT,checker} from "./lib.mjs";
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from "node:fs";
import {execSync,spawn} from "node:child_process";
import path from "node:path";
import os from "node:os";
const ok=checker();
const {TEXT_FIELDS,textOf,textHtml}=await import(path.join(ROOT,"shop-render.js"));

// 1. HTML 的字 = 預設文字，或每小時更新時寫進去的老闆文字（data/site.json 是同一次更新的資料）
const html=readFileSync(path.join(ROOT,"index.html"),"utf8");
const site0=JSON.parse(readFileSync(path.join(ROOT,"data/site.json"),"utf8"));
const keys=new Set(TEXT_FIELDS.map(f=>f.key));
ok(keys.size===TEXT_FIELDS.length,"text keys are unique");
const marks=[...html.matchAll(/<([a-zA-Z][\w-]*)(?=[^>]*\sdata-page-field="([^"]+)")[^>]*>(.*?)<\/\1>/g)];
ok(marks.length>=25,`index.html has the text markers (${marks.length})`);
const bad=marks.filter(m=>!keys.has(m[2])||(m[3]!==textHtml({},m[2])&&m[3]!==textHtml(site0.meta.pageText,m[2]))).map(m=>m[2]);
ok(!bad.length,"every marked text is the default or the shop's own text "+bad.join(","));

// 店家改過的字（假資料庫）
const custom={navHome:"回首頁",picksTitle:"這個月推薦",lbBack:"返回列表",askBtn:"想要這件",askBtnDone:"清單裡有 {n} 件，去看看",
  askNote:"先**收藏**再一起問",favEmpty:"清單空空的\n快去逛逛",favSend:"用 LINE 問價",contactLead:"歡迎光臨門市",
  tileFavCta:"一次問老闆",favSnackFirst:"收好了！",descTitle:"關於這件",footerCopy:"© 信通",contactLead:"歡迎光臨\n門市在文昌街",
  qvOpen:"看這件的全部",recentTitle:"剛剛看的"};
const CHAIR_INTRO="椅子介紹：各式餐椅、藤椅都有現貨。";
const SUB_INTRO="藤椅介紹：手工編織，透氣耐坐。";
const patchMeta=meta=>{
  meta.pageText={...(meta.pageText||{}),...custom};
  const chair=meta.catalog.find(c=>c.id==="cat-chair");chair.intro=CHAIR_INTRO;
  chair.subs.find(s=>s.id==="sub-4fkg0i44").intro=SUB_INTRO;
  return meta;
};

// 2. 前台
const b=await launch();const errs=[];
{
  const store=await seedStore();
  patchMeta(store.get("sitedata/hsshop-10bd9"));
  const ctx=await b.newContext({viewport:{width:390,height:844},hasTouch:true});await setup(ctx,{store,blockSiteJson:true});
  const pg=await ctx.newPage();pg.on("pageerror",e=>errs.push(e.message));
  await pg.goto(ORIGIN+"/c/cat-chair");await pg.waitForTimeout(2500);
  const t=await pg.evaluate(()=>({
    nav:[...document.querySelectorAll('[data-page-field="navHome"]')].map(e=>e.textContent),
    picks:document.querySelector('[data-page-field="picksTitle"]').textContent,
    lead:document.querySelector('[data-page-field="contactLead"]').textContent,
    copy:document.querySelector('[data-page-field="footerCopy"]').textContent,
    intro:document.getElementById("listingIntro").textContent,
    tile:document.querySelector("#catCta .cta-link")?.textContent}));
  ok(t.nav.length===2&&t.nav.every(x=>x==="回首頁"),"nav text (desktop + phone menu) "+t.nav);
  ok(t.picks==="這個月推薦"&&t.lead==="歡迎光臨門市在文昌街"&&t.copy==="© 信通","section texts replaced");
  ok((await pg.innerHTML('[data-page-field="contactLead"]'))==="歡迎光臨<br>門市在文昌街","line break in a page text shows as a new line");
  ok(t.intro===CHAIR_INTRO,"main category intro from admin: "+t.intro);
  ok(t.tile==="一次問老闆","category tile text: "+t.tile);
  await pg.locator('#catSidebar .cat-sub-btn[data-sub="sub-4fkg0i44"]').click();await pg.waitForTimeout(700);
  ok((await pg.textContent("#listingIntro"))===SUB_INTRO,"sub category intro from admin");
  // 收藏清單空的時候
  await pg.evaluate(()=>toggleFavoritesPanel(true));await pg.waitForTimeout(400);
  ok((await pg.innerHTML(".favorites-empty")).replace(/\s/g,"")==="清單空空的<br>快去逛逛","empty favorites text keeps line breaks");
  ok((await pg.textContent('[data-page-field="favSend"]'))==="用 LINE 問價","favorites send button");
  await pg.evaluate(()=>toggleFavoritesPanel(false));await pg.waitForTimeout(300);
  // 手機點商品先跳快速預覽：按鈕的字也是後台的字；按了進商品頁
  await pg.locator("#productsGrid .product-card").first().click();await pg.waitForTimeout(600);
  ok((await pg.textContent(".sheet.open .qv-open")).startsWith("看這件的全部"),"quick view button text from admin");
  await pg.click(".sheet.open .qv-open");await pg.waitForTimeout(900);
  const lb=await pg.evaluate(()=>({btn:document.querySelector("#lbAskBtn span").textContent,note:document.querySelector(".lb-ask-note").innerHTML,
    back:document.querySelector(".lb-close").textContent,desc:document.querySelector(".lb-desc-title")?.textContent}));
  ok(lb.btn==="想要這件","ask button text");
  ok(lb.note==="先<strong>收藏</strong>再一起問","ask note with bold");
  ok(lb.back.includes("返回列表"),"back button text");
  ok(!lb.desc||lb.desc==="關於這件","description heading");
  await pg.click("#lbAskBtn");await pg.waitForTimeout(500);
  ok((await pg.textContent("#lbAskBtn span"))==="清單裡有 1 件，去看看","added state uses {n}");
  ok((await pg.textContent("#favSnack span"))==="收好了！","first favorite tip");
  await pg.click(".lb-close");await pg.waitForTimeout(700);
  ok((await pg.textContent("#recentStrip .recent-title"))==="剛剛看的","recently viewed title from admin");
  await ctx.close();
}
// 網站設定讀不到時：頁面上已經寫好的字（每小時更新寫進去的老闆文字）不能被換回預設
{
  const store=await seedStore();store.delete("sitedata/hsshop-10bd9");
  const ctx=await b.newContext({viewport:{width:390,height:844}});await setup(ctx,{store,blockSiteJson:true});
  await ctx.addInitScript(()=>document.addEventListener("DOMContentLoaded",()=>document.querySelectorAll('[data-page-field="navHome"]').forEach(e=>e.textContent="老闆的首頁")));
  const pg=await ctx.newPage();pg.on("pageerror",e=>errs.push(e.message));
  await pg.goto(ORIGIN+"/");await pg.waitForTimeout(2500);
  ok((await pg.textContent('[data-page-field="navHome"]'))==="老闆的首頁","texts already on the page are kept when site settings fail to load");
  await ctx.close();
}
// 沒改過的店：還是原本的字
{
  const ctx=await b.newContext({viewport:{width:1366,height:900}});await setup(ctx);
  const pg=await ctx.newPage();pg.on("pageerror",e=>errs.push(e.message));
  await pg.goto(ORIGIN+"/c/cat-chair");await pg.waitForTimeout(2500);
  await pg.locator("#productsGrid .product-card").first().click();await pg.waitForTimeout(900);
  ok((await pg.textContent("#lbAskBtn span"))==="收藏這件，選好一起問","default ask button text unchanged");
  ok((await pg.textContent("#listingIntro")).startsWith("信通家俱行的椅子共"),"auto intro when admin left it blank");
  await ctx.close();
}

// 3. 每小時產生的頁面
{
  const tmp=mkdtempSync(path.join(os.tmpdir(),"hs-texts-"));
  const site=JSON.parse(readFileSync(path.join(ROOT,"data/site.json"),"utf8"));patchMeta(site.meta);
  writeFileSync(path.join(tmp,"site.json"),JSON.stringify(site));
  const port=String(8800+Math.floor(Math.random()*90));
  const db=spawn("node",[path.join(ROOT,"_tools/tests/fake-firestore.mjs"),path.join(tmp,"site.json"),port],{stdio:"ignore"});
  await new Promise(r=>setTimeout(r,800));
  try{execSync(`node _tools/build-pages.mjs --out "${tmp}/out"`,{cwd:ROOT,stdio:"ignore",env:{...process.env,FIRESTORE_BASE:`http://127.0.0.1:${port}`}})}finally{db.kill()}
  const cat=readFileSync(path.join(tmp,"out/c/cat-chair.html"),"utf8");
  const prod=readFileSync(path.join(tmp,"out/p",site.products.find(p=>p.status==="active").id+".html"),"utf8");
  ok(cat.includes(CHAIR_INTRO)&&cat.includes(`content="${CHAIR_INTRO}"`),"static category page has the intro (and Google description)");
  ok((cat.match(/data-page-field="navHome">回首頁</g)||[]).length===2,"static page nav text written in");
  ok(prod.includes(">想要這件<")&&prod.includes("先<strong>收藏</strong>再一起問"),"static product page has the ask texts");
  ok(cat.includes('data-page-field="contactLead">歡迎光臨<br>門市在文昌街<'),"static page keeps the line break");
  rmSync(tmp,{recursive:true,force:true});
}

// 4. 後台
{
  const ctx=await b.newContext({viewport:{width:1400,height:900}});const store=await setup(ctx);
  const pg=await ctx.newPage();pg.on("pageerror",e=>errs.push(e.message));pg.on("dialog",d=>d.accept());
  await pg.goto(ORIGIN+"/manage.html");await pg.waitForSelector("#tbody tr[data-id]");
  await pg.evaluate(()=>openPageTextManage());await pg.waitForTimeout(300);
  ok(await pg.locator("#pageTextFields [data-pt]").count()===TEXT_FIELDS.length,"admin form has every text");
  ok(await pg.getAttribute('#pageTextFields [data-pt="askBtn"]',"placeholder")==="收藏這件，選好一起問","placeholder shows the default");
  await pg.fill('#pageTextFields [data-pt="askBtn"]',"喜歡就收藏");
  await pg.fill('#pageTextFields [data-pt="heroCta"]',"");
  await pg.evaluate(()=>savePageTextManage());await pg.waitForTimeout(600);
  const meta=store.get("sitedata/hsshop-10bd9");
  ok(meta.pageText.askBtn==="喜歡就收藏"&&!("heroCta" in meta.pageText),"saved texts (blank = default, not stored)");
  ok(!("fbTitle" in meta.pageText)&&!("productsTitle" in meta.pageText),"old unused text fields are cleaned on save");
  // 分類介紹
  await pg.evaluate(()=>openCategoryManage());await pg.waitForTimeout(300);
  const row=pg.locator('.catmgr-main-row[data-cat-id="cat-table"]');
  await row.locator('.catmgr-row-top button[title^="分類介紹"]').click();
  const ta=row.locator(".catmgr-intro textarea").first();
  ok((await ta.getAttribute("placeholder")).startsWith("信通家俱行的桌子共"),"intro placeholder shows the automatic text");
  // 灰色那段要跟前台真的會顯示的自動介紹一字不差
  const front=await (async()=>{const c=await b.newContext();await setup(c);const p=await c.newPage();await p.goto(ORIGIN+"/c/cat-table");await p.waitForTimeout(2500);const t=await p.textContent("#listingIntro");await c.close();return t})();
  ok(await ta.getAttribute("placeholder")===front,"admin automatic intro = what the front shows");
  await ta.fill("桌子介紹測試");
  await pg.evaluate(()=>closeCategoryManage());await pg.waitForTimeout(600);
  ok(store.get("sitedata/hsshop-10bd9").catalog.find(c=>c.id==="cat-table").intro==="桌子介紹測試","category intro saved");
  // 分類列只有按住「⠿」才能拖（在輸入框裡反白文字不會變成拖動整列）
  await pg.evaluate(()=>openCategoryManage());await pg.waitForTimeout(300);
  const dragState=await pg.evaluate(()=>{const r=document.querySelector('.catmgr-main-row[data-cat-id="cat-table"]');const before=r.draggable;
    r.querySelector(".catmgr-intro textarea")?.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true}));const onText=r.draggable;
    r.querySelector(".drag-handle").dispatchEvent(new PointerEvent("pointerdown",{bubbles:true}));const onHandle=r.draggable;
    document.dispatchEvent(new PointerEvent("pointerup",{bubbles:true}));return [before,onText,onHandle,r.draggable]});
  ok(JSON.stringify(dragState)==="[false,false,true,false]","category rows drag only from the handle "+dragState);
  await pg.evaluate(()=>closeModal("catMgrModal"));
  // 貼照片連結：只有 Google 雲端的連結才轉換，其他網站的 ?id= 照原樣交給圖床
  const sent=[];
  // 每張照片會上傳兩次（原圖、統一大小後的圖）；這裡只看「直接交出網址」的那一次
  await ctx.route("https://api.cloudinary.com/**",async r=>{const m=(r.request().postDataBuffer()?.toString("latin1")||"").match(/name="file"\r\n\r\n(https?:[^\r]+)/);if(m)sent.push(m[1]);await r.fulfill({contentType:"application/json",body:JSON.stringify({secure_url:"https://res.cloudinary.com/oqcmekau/image/upload/v1/test_paste.jpg"})})});
  const pid=await pg.locator("#tbody tr[data-id]").first().getAttribute("data-id");
  await pg.evaluate(id=>openProductModal(id),pid);await pg.waitForSelector("#productModal.open");await pg.waitForTimeout(600);
  await pg.evaluate(()=>{const b=[...document.querySelectorAll(".upload-method-btn")].find(x=>x.textContent.includes("貼照片連結"));setUploadMethod("url",b)});
  for(const u of ["https://shop.example.com/img.php?id=8812","https://drive.google.com/file/d/AbC123xyz/view?usp=sharing"]){
    await pg.fill("#urlInput",u);await pg.evaluate(()=>addPhotoByUrl());await pg.waitForTimeout(700);
  }
  ok(sent[0]==="https://shop.example.com/img.php?id=8812","ordinary photo link is sent as-is: "+sent[0]);
  ok(/^https:\/\/drive\.google\.com\/thumbnail\?id=AbC123xyz/.test(sent[1]||""),"Google Drive share link is converted: "+sent[1]);
  await pg.evaluate(()=>closeModal("productModal"));
  await ctx.close();
}
ok(!errs.length,"no page errors "+errs.join(" | "));
await b.close();ok.done();
