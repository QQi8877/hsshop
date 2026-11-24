// 全站思源黑體（2026-11 老闆選的 A）：
// 1. 瘦身後的小檔案、標點檔、字單都在，而且真的是小檔案（不會不小心把 1MB 的完整字型給客人下載）；
//    明體只收店名、首頁大標的字，只有十幾 KB
// 2. 網頁的字用的是內嵌的 "HS Sans"，而且有載入；完整字型不會被下載
// 3. 畫面上看得到的每個字（列表、快速預覽、篩選、商品頁、收藏清單）都在字單裡，不會有字掉回裝置內建的字型
// 4. 打開網頁不會「字先小後大」（2026-11 老闆反映）：第一個畫面用到的字型檔都有 preload、而且都用得到；
//    思源字型用 font-display:block（下載完才顯示，不先用裝置內建的字）；網路很慢時 1.5 秒後改用內建字（fonts-late），
//    下載完再換回來；網路正常時不會出現 fonts-late
import {launch,setup,ORIGIN,ROOT,checker,openCard} from "./lib.mjs";
import {readFileSync,statSync,existsSync,readdirSync} from "node:fs";
import path from "node:path";
const ok=checker();
const F=f=>path.join(ROOT,"fonts",f);
const kb=f=>existsSync(f)?Math.round(statSync(f).size/1024):"-";
for(const w of [400,500,600]){
  const sub=F(`noto-sans-tc-${w}-sub.woff2`),punct=F(`noto-sans-tc-${w}-punct.woff2`),serif=F(`noto-serif-tc-${w}-sub.woff2`);
  ok(existsSync(sub)&&statSync(sub).size<250*1024,`sans ${w} subset exists and is small (${kb(sub)} KB)`);
  ok(existsSync(punct)&&statSync(punct).size<30*1024,`sans ${w} punctuation file exists and is small`);
  ok(existsSync(serif)&&statSync(serif).size<40*1024,`serif ${w} subset only has the shop-name characters (${kb(serif)} KB)`);
}
const chars=new Set(readFileSync(F("site-chars.txt"),"utf8"));
ok(chars.size>500,"site-chars.txt lists the site's characters ("+chars.size+")");
const brandChars=new Set(readFileSync(F("heading-chars.txt"),"utf8"));
const heroTitle=JSON.parse(readFileSync(path.join(ROOT,"data/site.json"),"utf8")).meta?.pageText?.heroTitle||"";
ok([..."信通家俱行"+heroTitle].every(c=>brandChars.has(c)),"heading-chars.txt has the shop name and the hero title");
const missing=text=>[...new Set([...text].filter(c=>!/\s/.test(c)&&!chars.has(c)))].join("");

const b=await launch();const errs=[];
for(const [name,vp] of [["mob",{width:390,height:844}],["desk",{width:1280,height:900}]]){
  const ctx=await b.newContext({viewport:vp,hasTouch:name==="mob",isMobile:name==="mob"});await setup(ctx);
  const pg=await ctx.newPage();pg.on("pageerror",e=>errs.push(e.message));
  await pg.goto(ORIGIN+"/c/cat-chair");await pg.waitForTimeout(2500);
  const f=await pg.evaluate(async()=>{await document.fonts.ready;
    const faces=[...document.fonts].filter(x=>x.family.replace(/["']/g,"")==="HS Sans");
    return {body:getComputedStyle(document.body).fontFamily,title:getComputedStyle(document.getElementById("listingTitle")).fontFamily,
      loaded:faces.filter(x=>x.status==="loaded").map(x=>x.weight),
      res:performance.getEntriesByType("resource").map(e=>e.name).filter(n=>/\/fonts\//.test(n)).map(n=>n.replace(/^.*\/fonts\//,""))}});
  ok(/^"?HS Sans/.test(f.body)&&/^"?HS Sans/.test(f.title),`${name}: page text and titles use the embedded HS Sans (${f.body.slice(0,30)})`);
  ok(f.loaded.includes("400"),`${name}: HS Sans 400 is loaded (${f.loaded.join(",")})`);
  ok(f.res.some(n=>/noto-sans-tc-400-sub/.test(n))&&f.res.some(n=>/noto-sans-tc-\d+-punct/.test(n)),`${name}: subset + punctuation files downloaded (${f.res.join(" ")})`);
  ok(!f.res.some(n=>/^noto-sans-tc-\d+\.woff2/.test(n)),`${name}: the 1MB full sans font is not downloaded`);
  let text=await pg.evaluate(()=>document.body.innerText);
  if(name==="mob"){
    await pg.locator("#productsGrid .product-card").nth(1).click();await pg.waitForTimeout(700);
    text+=await pg.evaluate(()=>document.querySelector(".sheet.open")?.innerText||"");
    await pg.locator(".sheet.open .qv-fav").click();await pg.waitForTimeout(400);
    text+=await pg.evaluate(()=>document.getElementById("favSnack")?.innerText||"");
    await pg.locator(".sheet.open .qv-open").click();await pg.waitForTimeout(1300);
  }else{
    await openCard(pg,pg.locator("#productsGrid .product-card").nth(1),1300);
  }
  text+=await pg.evaluate(()=>document.getElementById("lightbox").innerText);
  await pg.evaluate(()=>toggleFavoritesPanel(true));await pg.waitForTimeout(500);
  text+=await pg.evaluate(()=>document.getElementById("favoritesPanel").innerText);
  await pg.evaluate(()=>toggleFavoritesPanel(false));await pg.waitForTimeout(300);
  await pg.click(".lb-close");await pg.waitForTimeout(700);
  if(name==="mob"){
    await pg.locator('#catSidebar .cat-side-btn[data-main="cat-storage"]').click();await pg.waitForTimeout(900);
    await pg.evaluate(()=>{document.getElementById("productsGrid").scrollIntoView();scrollBy(0,-60)});await pg.waitForTimeout(600);
    await pg.locator(".filter-fab").click();await pg.waitForTimeout(500);
    text+=await pg.evaluate(()=>document.querySelector(".sheet.open")?.innerText||"");
  }
  const miss=missing(text);
  ok(!miss,`${name}: every character on screen is in the font's character list ${miss?"(missing: "+miss+")":""}`);
  await ctx.close();
}

// 4. 打開網頁時的字型：首頁、分類頁、商品頁（電腦）＋首頁（手機）
const WANT=["noto-serif-tc-600-sub","noto-sans-tc-400-sub","noto-sans-tc-500-sub","noto-sans-tc-600-sub","noto-sans-tc-400-punct","noto-sans-tc-600-punct"];
const prod="/p/"+readdirSync(path.join(ROOT,"p")).find(f=>f.endsWith(".html")).replace(/\.html$/,"");
const base=s=>s.replace(/^.*\/|\.woff2$/g,"");
// 記下 <html> 有沒有出現過 fonts-late（這時 <html> 可能還沒建好，所以盯整份文件）
const watchLate=()=>{new MutationObserver(()=>{if(document.documentElement?.classList.contains("fonts-late"))window.__late=true})
  .observe(document,{subtree:true,attributes:true,attributeFilter:["class"]})};
// 分類頁、商品頁是照 index.html 產生的：還沒重新產生（專案資料夾裡的是舊的，每小時更新才會換）就跳過，
// 用 stage.mjs 做出來的資料夾測才準
const preloadsIn=f=>[...readFileSync(path.join(ROOT,f),"utf8").matchAll(/<link rel="preload" as="font"[^>]*href="([^"]+)"/g)].map(m=>m[1]).join(" ");
for(const [name,url] of [["desk","/"],["desk","/c/cat-chair"],["desk",prod],["mob","/"]]){
  if(url!=="/"&&preloadsIn(url.slice(1)+".html")!==preloadsIn("index.html")){console.log(`skip ${url}: not regenerated from the current index.html yet`);continue}
  const mob=name==="mob";
  const ctx=await b.newContext({viewport:mob?{width:390,height:844}:{width:1280,height:900},hasTouch:mob,isMobile:mob});await setup(ctx);
  await ctx.addInitScript(watchLate);
  const pg=await ctx.newPage();const warn=[];
  pg.on("pageerror",e=>errs.push(e.message));
  pg.on("console",m=>{if(/preload/i.test(m.text()))warn.push(m.text().slice(0,110))});
  await pg.goto(ORIGIN+url);await pg.waitForTimeout(4500);   // 沒用到的 preload，瀏覽器在網頁載入完幾秒後會提出警告
  const r=await pg.evaluate(()=>({
    preloads:[...document.querySelectorAll("link[rel=preload][as=font]")].map(l=>l.getAttribute("href")),
    fetched:performance.getEntriesByType("resource").filter(e=>/\/fonts\//.test(e.name)).map(e=>[e.name,e.initiatorType]),
    display:[...document.fonts].map(f=>[f.family.replace(/["']/g,""),f.display]),
    late:!!window.__late||document.documentElement.classList.contains("fonts-late")}));
  const tag=`${name} ${url}`;
  if(url==="/"&&!mob)ok(JSON.stringify(r.preloads.map(base).sort())===JSON.stringify(WANT.slice().sort()),"the fonts used on the first screen are preloaded ("+r.preloads.map(base).join(" ")+")");
  const notPre=WANT.filter(f=>!r.fetched.some(([n,how])=>base(n)===f&&how==="link"));
  ok(!notPre.length,`${tag}: first-screen fonts come from the preload ${notPre.length?"(not preloaded: "+notPre.join(" ")+")":""}`);
  ok(!warn.length,`${tag}: no unused / mismatched preload warnings ${warn.join(" | ")}`);
  if(url==="/"&&!mob){
    const bad=r.display.filter(([fam,d])=>/^HS (Sans|Serif)$/.test(fam)?d!=="block":fam==="Noto Serif TC"?d!=="swap":false);
    ok(!bad.length&&r.display.some(([f])=>f==="HS Sans"),"思源 fonts use font-display:block, the full serif fallback keeps swap "+JSON.stringify(bad.slice(0,3)));
  }
  ok(!r.late,`${tag}: normal network never falls back to the device font (no fonts-late)`);
  await ctx.close();
}
// 很慢的網路：黑體的小檔案晚 2.6 秒才到。1.5 秒後先用裝置內建的字顯示（不讓客人對著沒有字的畫面等），到了再換回來
{
  const ctx=await b.newContext({viewport:{width:1280,height:900}});await setup(ctx);
  await ctx.route(/\/fonts\/noto-sans-tc-\d+-sub\.woff2$/,async r=>{await new Promise(res=>setTimeout(res,2600));return r.fallback()});
  await ctx.addInitScript(watchLate);
  const pg=await ctx.newPage();pg.on("pageerror",e=>errs.push(e.message));
  await pg.goto(ORIGIN+"/",{waitUntil:"commit"});
  const at=async ms=>{await pg.waitForFunction(t=>performance.now()>t,ms,{timeout:15000});
    return pg.evaluate(()=>({late:document.documentElement.classList.contains("fonts-late"),hero:document.documentElement.classList.contains("hero-pending"),
      body:getComputedStyle(document.body).fontFamily,title:getComputedStyle(document.querySelector(".sec-head h2")||document.body).fontFamily}))};
  const early=await at(900);
  ok(!early.late,"slow network: still waiting for 思源黑體 before 1.5 s (no device font yet)");
  const mid=await at(1900);
  ok(await pg.evaluate(()=>window.__late===true),"slow network: the fonts-late watcher notices the switch (so the normal-network check above is meaningful)");
  ok(mid.late&&!/HS Sans/.test(mid.body)&&!/HS Sans/.test(mid.title),`slow network: after 1.5 s the text uses the device font (${mid.body.slice(0,24)})`);
  ok(!mid.hero,"slow network: the hero text is shown after 1.5 s");
  const end=await at(4200);
  ok(!end.late&&/^"?HS Sans/.test(end.body)&&/^"?HS Sans/.test(end.title),"slow network: once the fonts arrive it switches back to 思源黑體");
  await ctx.close();
}
ok(!errs.length,"no page errors "+errs.slice(0,2).join(" | "));
ok.done();await b.close();
