// 全站思源黑體（2026-11 老闆選的 A）：
// 1. 瘦身後的小檔案、標點檔、字單都在，而且真的是小檔案（不會不小心把 1MB 的完整字型給客人下載）
// 2. 網頁的字用的是內嵌的 "HS Sans"，而且有載入；完整字型不會被下載
// 3. 畫面上看得到的每個字（列表、快速預覽、篩選、商品頁、收藏清單）都在字單裡，不會有字掉回裝置內建的字型
import {launch,setup,ORIGIN,ROOT,checker,openCard} from "./lib.mjs";
import {readFileSync,statSync,existsSync} from "node:fs";
import path from "node:path";
const ok=checker();
const F=f=>path.join(ROOT,"fonts",f);
for(const w of [400,500,600]){
  const sub=F(`noto-sans-tc-${w}-sub.woff2`),punct=F(`noto-sans-tc-${w}-punct.woff2`);
  ok(existsSync(sub)&&statSync(sub).size<250*1024,`sans ${w} subset exists and is small (${existsSync(sub)?Math.round(statSync(sub).size/1024):"-"} KB)`);
  ok(existsSync(punct)&&statSync(punct).size<30*1024,`sans ${w} punctuation file exists and is small`);
}
const chars=new Set(readFileSync(F("site-chars.txt"),"utf8"));
ok(chars.size>500,"site-chars.txt lists the site's characters ("+chars.size+")");
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
ok(!errs.length,"no page errors "+errs.slice(0,2).join(" | "));
ok.done();await b.close();
