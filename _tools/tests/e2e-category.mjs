// Category pages (/c/…), crawlable nav links, static store data, product-name links, h1s, favicon.
import {launch,setup,ORIGIN,checker,ROOT} from "./lib.mjs";
import {readFileSync,existsSync} from "node:fs";
const ok=checker();
const b=await launch();
const HOME_TITLE="信通家俱行｜台北大安區家具行・讓家更有溫度";
async function page(vp={width:1400,height:900},opts={}){
  const ctx=await b.newContext({viewport:vp,...opts});await setup(ctx);
  const pg=await ctx.newPage();pg.errs=[];
  pg.on("pageerror",e=>pg.errs.push(e.message));pg.on("console",m=>{if(m.type()==="error")pg.errs.push(m.text())});
  return pg;
}
// ── static HTML (no JS): what Google gets before rendering ──
{
  const pg=await page(undefined,{javaScriptEnabled:false});
  await pg.goto(ORIGIN+"/");
  const links=await pg.$$eval("#categoriesBar a, #catSidebar a",a=>a.map(x=>x.getAttribute("href")));
  ok(links.includes("/c/cat-chair")&&links.includes("/c/cat-table"),"home has static category links "+links.slice(0,4));
  ok((await pg.textContent("#contactItems")).includes("文昌街184號"),"home has static address");
  const ld=JSON.parse(await pg.textContent("#structuredData"));
  ok(ld["@type"]==="FurnitureStore"&&ld.address.addressLocality==="大安區"&&ld.openingHoursSpecification[0].opens==="10:00","static store JSON-LD");
  ok(await pg.locator("h1").count()===1&&(await pg.textContent("h1")).includes("信通家俱行"),"home single h1 = shop");
  ok(await pg.title()===HOME_TITLE,"home title with location");
  await pg.goto(ORIGIN+"/c/sub-vsz2vbta");
  // 子分類頁的大標題是「桌子 » 摺疊桌」（電腦版只顯示子分類那段）
  ok(await pg.locator("h1").count()===1&&(await pg.textContent("h1 .lt-sub")).trim()==="摺疊桌"&&(await pg.textContent("h1 .lt-main")).trim()==="桌子","category h1 = 桌子 » 摺疊桌");
  const cards=await pg.$$eval("#productsGrid .product-card a",a=>a.map(x=>x.getAttribute("href")));
  ok(cards.length===9&&cards.every(h=>/^\/p\//.test(h)),"category static product links "+cards.length);
  ok((await pg.textContent("#listingIntro")).includes("摺疊桌共 9 款"),"category intro static");
  ok(await pg.getAttribute("link[rel=canonical]","href")==="https://hsintong.cc/c/sub-vsz2vbta","category canonical");
  const p=readFileSync(ROOT+"/c/sub-vsz2vbta.html","utf8");
  ok(/"@type":"CollectionPage"/.test(p)&&/"@type":"BreadcrumbList"/.test(p),"category JSON-LD");
  await pg.context().close();
}
// ── homepage interactions ──
{
  const pg=await page();
  await pg.goto(ORIGIN+"/");await pg.waitForSelector("#productsGrid .product-card");
  await pg.evaluate(()=>window.__marker=1);
  await pg.click('#catSidebar a[data-main="cat-chair"]');await pg.waitForTimeout(300);
  ok(new URL(pg.url()).pathname==="/c/cat-chair","url follows category");
  ok(await pg.evaluate(()=>window.__marker)===1,"no page reload on category click");
  ok((await pg.title()).startsWith("椅子｜"),"title follows category: "+await pg.title());
  ok(await pg.isVisible("#listingIntro")&&(await pg.textContent("#listingIntro")).includes("椅子共 34 款"),"intro shown");
  ok(await pg.locator("#productsGrid .product-card").count()>=20,"chair grid rendered");
  await pg.click('#catSidebar a.cat-sub-btn >> nth=0');await pg.waitForTimeout(300);
  ok(/^\/c\/sub-/.test(new URL(pg.url()).pathname),"sub url "+pg.url());
  await pg.click('#appliedChips .chip-applied >> nth=1');await pg.waitForTimeout(300);
  ok(new URL(pg.url()).pathname==="/c/cat-chair","chip clear sub → main url");
  await pg.click('#clearAllChips');await pg.waitForTimeout(300);
  ok(new URL(pg.url()).pathname==="/"&&await pg.title()===HOME_TITLE,"clear all → home url/title");
  ok(await pg.isHidden("#listingIntro"),"intro hidden on 全部");
  // product name link: plain click opens lightbox in place
  await pg.click("#productsGrid .product-card .product-name a >> nth=0");await pg.waitForTimeout(600);
  ok(await pg.evaluate(()=>window.__marker)===1&&await pg.locator("#lightbox.open").count()===1,"name link opens lightbox without reload");
  ok(/^\/p\//.test(new URL(pg.url()).pathname),"product url");
  await pg.keyboard.press("Escape");await pg.waitForTimeout(500);
  ok(new URL(pg.url()).pathname==="/","back to home url");
  // cat tile
  await pg.click('#catTilesGrid a.cat-tile[data-cat="cat-table"]');await pg.waitForTimeout(500);
  ok(new URL(pg.url()).pathname==="/c/cat-table","cat tile → category url");
  ok(await pg.locator("#structuredData").count()===1,"single store JSON-LD (no JS duplicate)");
  ok(!pg.errs.length,"no errors home "+pg.errs.join("|"));
  await pg.context().close();
}
// ── landing on a category page ──
{
  const pg=await page();
  await pg.goto(ORIGIN+"/c/sub-vsz2vbta");await pg.waitForTimeout(2000);
  ok(await pg.evaluate(()=>document.body.classList.contains("cat-landing")),"landing class");
  ok(await pg.isHidden("#picks")&&await pg.isHidden("#catTiles"),"picks/tiles hidden on landing");
  ok(await pg.locator("#productsGrid .product-card").count()===9,"JS keeps category (9)");
  ok((await pg.textContent("#listingTitle .lt-sub")).trim()==="摺疊桌","title element kept");
  ok(await pg.locator('#subCategoriesBar a.sub-tab.active[data-sub="sub-vsz2vbta"]').count()===1,"active sub tab");
  // open a product then close → back to the category url/title
  await pg.locator("#productsGrid .product-card").first().click();await pg.waitForTimeout(600);
  ok(/^\/p\//.test(new URL(pg.url()).pathname),"product opened");
  await pg.keyboard.press("Escape");await pg.waitForTimeout(500);
  ok(new URL(pg.url()).pathname==="/c/sub-vsz2vbta"&&(await pg.title()).startsWith("摺疊桌｜"),"close → category url+title "+pg.url());
  await pg.click('#catSidebar a[data-main="全部"]');await pg.waitForTimeout(500);
  ok(!(await pg.evaluate(()=>document.body.classList.contains("cat-landing")))&&await pg.isVisible("#picks"),"全部 restores picks");
  ok(new URL(pg.url()).pathname==="/","全部 → /");
  ok(!pg.errs.length,"no errors landing "+pg.errs.join("|"));
  await pg.context().close();
}
// ── mobile tabs + hash fallback from 404 ──
{
  const pg=await page({width:390,height:844},{hasTouch:true});
  await pg.goto(ORIGIN+"/#cat-sub-4fkg0i44");await pg.waitForTimeout(2000);
  ok(new URL(pg.url()).pathname==="/c/sub-4fkg0i44"&&!new URL(pg.url()).hash,"hash route rewritten "+pg.url());
  ok(await pg.locator("#productsGrid .product-card").count()===10,"藤椅 10");
  // 手機版（2026-11 起）：上方兩排分類鈕收起來，改用左邊的兩層分類欄
  ok(await pg.isHidden("#categoriesBar")&&await pg.isVisible("#catSidebar"),"mobile uses the left category rail");
  ok(await pg.locator('#catSidebar a.cat-sub-btn.active[data-sub="sub-4fkg0i44"]').count()===1,"mobile rail shows the active sub");
  await pg.click('#catSidebar a.cat-side-btn[data-main="cat-table"]');await pg.waitForTimeout(400);
  ok(new URL(pg.url()).pathname==="/c/cat-table"&&await pg.locator("#catSidebar .cat-sub-btn").count()>0,"mobile rail nav expands subs");
  ok(!pg.errs.length,"no errors mobile "+pg.errs.join("|"));
  await pg.context().close();
}
// ── product page h1 + files ──
{
  const pg=await page(undefined,{javaScriptEnabled:false});
  const id=readFileSync(ROOT+"/c/sub-vsz2vbta.html","utf8").match(/href="\/p\/([^"]+)"/)[1];
  ok(["favicon.ico","favicon.svg","apple-touch-icon.png","icon-512.png","llms.txt"].every(f=>existsSync(ROOT+"/"+f)),"icon files + llms.txt exist");
  await pg.context().close();
}
await b.close();ok.done();
