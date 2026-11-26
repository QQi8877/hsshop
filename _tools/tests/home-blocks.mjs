// 首頁四大區塊・整頁翻頁（2026-11 老闆選的 B）：
// 1. 整頁對齊有開；大圖＝畫面高度－62px、本月選品＋分類磚＝畫面高度－52px（手機、平板、電腦）
// 2. 電腦滑鼠滾輪：大圖 → 第二塊 → 商品列表開頭，一格換一塊；到了商品列表照常捲；往回也是一格一塊
// 3. 右邊小圓點：四塊各一個，跟著捲動換，點了會跳到那一塊
// 4. 原本的功能不受影響：點分類磚到商品列表、開關商品頁、手機快速預覽
// 5. 從 Google 直接進分類頁：沒有第二塊、大圖維持原本大小（商品不會被擠到下一頁）
import {launch,setup,ORIGIN,checker,openCard} from "./lib.mjs";
const ok=checker();
const b=await launch();const errs=[];
const tops=pg=>pg.evaluate(()=>{const nav=document.querySelector("nav").getBoundingClientRect().bottom;
  return {y:Math.round(scrollY),nav:Math.round(nav),blocks:["hero","picks","categories","buyInfo"].map(id=>{const e=document.getElementById(id);return e&&e.offsetParent?Math.round(e.getBoundingClientRect().top):null})}});
const settle=pg=>pg.waitForTimeout(1100);
// 長距離的平滑捲動（跳過整個商品列表）要比較久：等到捲動停下來（0.3 秒沒動），最多 5 秒
const settleLong=async pg=>{let last=-1,same=0;for(let i=0;i<50&&same<3;i++){await pg.waitForTimeout(100);const y=await pg.evaluate(()=>scrollY);same=y===last?same+1:0;last=y}};

// 1. 各種畫面的大小
for(const [w,h,mob] of [[1280,800,false],[1366,657,false],[820,1180,true],[390,844,true],[375,667,true]]){
  const ctx=await b.newContext({viewport:{width:w,height:h},isMobile:mob&&w<761,hasTouch:mob});await setup(ctx);
  const pg=await ctx.newPage();pg.on("pageerror",e=>errs.push(e.message));
  await pg.goto(ORIGIN+"/");await pg.waitForTimeout(2200);
  const r=await pg.evaluate(()=>{const R=id=>document.getElementById(id).getBoundingClientRect();
    return {snap:getComputedStyle(document.documentElement).scrollSnapType,hero:R("hero").height,b2:R("catTiles").bottom-R("picks").top,vh:innerHeight,
      over:[...document.querySelectorAll(".hero-inner,#catTilesGrid .cat-tile")].some(e=>e.scrollHeight>e.clientHeight+1),wide:document.documentElement.scrollWidth>innerWidth}});
  ok(r.snap==="y mandatory",`${w}x${h}: whole-block snapping is on`);
  ok(Math.abs(r.hero-(r.vh-62))<=2&&Math.abs(r.b2-(r.vh-52))<=3,`${w}x${h}: hero and picks+tiles each fill one screen (${Math.round(r.hero)}/${Math.round(r.b2)} vs ${r.vh-62}/${r.vh-52})`);
  ok(!r.over&&!r.wide,`${w}x${h}: nothing overflows the hero or the category tiles, no sideways scroll`);
  await ctx.close();
}

// 2.～4. 電腦
{
  const ctx=await b.newContext({viewport:{width:1280,height:800}});await setup(ctx);
  const pg=await ctx.newPage();pg.on("pageerror",e=>errs.push(e.message));
  await pg.goto(ORIGIN+"/");await pg.waitForTimeout(2200);
  await pg.mouse.move(640,420);
  await pg.mouse.wheel(0,100);await settle(pg);let t=await tops(pg);
  ok(Math.abs(t.blocks[1]-t.nav)<=2,`desktop: one wheel notch from the hero lands exactly on 本月選品 (top ${t.blocks[1]}, nav ${t.nav})`);
  await pg.mouse.wheel(0,100);await settle(pg);t=await tops(pg);
  ok(Math.abs(t.blocks[2]-t.nav)<=2,`desktop: next notch lands on the product list (top ${t.blocks[2]})`);
  const y0=t.y;await pg.mouse.wheel(0,300);await settle(pg);t=await tops(pg);
  ok(t.y>y0+150&&t.blocks[2]<t.nav-150,`desktop: inside the product list the wheel scrolls normally (${y0} → ${t.y})`);
  await pg.mouse.wheel(0,-300);await settle(pg);await pg.mouse.wheel(0,-100);await settle(pg);t=await tops(pg);
  ok(Math.abs(t.blocks[1]-t.nav)<=2,`desktop: scrolling back up from the list start returns to 本月選品 (top ${t.blocks[1]})`);
  await pg.mouse.wheel(0,-100);await settle(pg);t=await tops(pg);
  ok(t.y===0,`desktop: and one more notch returns to the hero (y ${t.y})`);
  // 小圓點
  const dots=await pg.evaluate(()=>[...document.querySelectorAll(".fx-dots button")].map(d=>[d.getAttribute("aria-label"),d.getAttribute("aria-current")]));
  ok(dots.length===4&&dots[0][1]==="true"&&dots.every(d=>d[0]),`desktop: four dots, labelled with each block's title, first one active (${dots.map(d=>d[0]).join("／")})`);
  await pg.click(".fx-dots button:nth-child(4)");await settleLong(pg);t=await tops(pg);
  const cur=await pg.evaluate(()=>[...document.querySelectorAll(".fx-dots button")].findIndex(d=>d.getAttribute("aria-current")==="true"));
  ok(Math.abs(t.blocks[3]-t.nav)<=2&&cur===3,`desktop: clicking the 4th dot goes to 購買須知 and marks it (top ${t.blocks[3]}, active ${cur})`);
  // 選單的「購買須知」「聯繫」：跳過商品列表（途中不會因為多畫一批商品而停在列表中間）
  for(const [text,id] of [["購買須知","buyInfo"],["聯繫","contact"]]){
    await pg.evaluate(()=>scrollTo({top:0,behavior:"instant"}));await settle(pg);
    await pg.click(`.nav-links a[href="#${id}"]`);await settleLong(pg);
    const r=await pg.evaluate(id=>{const s=document.getElementById(id).getBoundingClientRect(),h=document.querySelector(`#${id} h2`).getBoundingClientRect();return {top:Math.round(s.top),head:Math.round(h.top),bottom:Math.round(h.bottom)}},id);
    ok(r.head>=52&&r.bottom<=800,`desktop: the menu's 「${text}」 link lands on its section with the heading in view (heading at ${r.head})`);
  }
  // 最底下（聯繫我們的下半、頁尾）也停得住
  await pg.evaluate(()=>scrollTo({top:document.documentElement.scrollHeight,behavior:"instant"}));await settle(pg);
  const foot=await pg.evaluate(()=>Math.round(document.querySelector("footer").getBoundingClientRect().bottom-innerHeight));
  ok(Math.abs(foot)<=2,`desktop: the page bottom (footer) is reachable with snapping on (footer bottom − window ${foot})`);
  // 點分類磚 → 商品列表（標題看得到，沒有被選單蓋住）
  await pg.evaluate(()=>scrollTo({top:0,behavior:"instant"}));await settle(pg);
  await pg.evaluate(()=>document.getElementById("picks").scrollIntoView({block:"start",behavior:"instant"}));await settle(pg);
  await pg.locator('#catTilesGrid .cat-tile[data-cat="cat-chair"]').click();await settle(pg);
  const lt=await pg.evaluate(()=>{const r=document.getElementById("listingTitle").getBoundingClientRect();return {top:Math.round(r.top),text:document.getElementById("listingTitle").textContent}});
  ok(lt.text.includes("椅子")&&lt.top>=50&&lt.top<400,`desktop: a category tile opens that category in the list, title visible (${lt.text} at ${lt.top})`);
  // 開關商品頁
  await openCard(pg,pg.locator("#productsGrid .product-card").first(),1300);
  ok(await pg.locator("#lightbox.open").count()===1,"desktop: product page opens from the list");
  await pg.click(".lb-close");await settle(pg);
  ok(await pg.locator("#lightbox.open").count()===0&&await pg.locator("#productsGrid .product-card").count()>0,"desktop: product page closes back to the list");
  await ctx.close();
}

// 手機：手指往上滑一小段會對齊到下一塊；快速預覽照常
{
  const ctx=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});await setup(ctx);
  const pg=await ctx.newPage();pg.on("pageerror",e=>errs.push(e.message));
  await pg.goto(ORIGIN+"/");await pg.waitForTimeout(2200);
  await pg.evaluate(()=>scrollBy({top:innerHeight*.3,behavior:"smooth"}));await pg.waitForTimeout(1400);let t=await tops(pg);
  ok(Math.abs(t.blocks[1]-t.nav)<=2,`mobile: a short swipe from the hero snaps to 本月選品 (top ${t.blocks[1]})`);
  await pg.evaluate(()=>scrollBy({top:innerHeight*.3,behavior:"smooth"}));await pg.waitForTimeout(1400);t=await tops(pg);
  ok(Math.abs(t.blocks[2]-t.nav)<=2,`mobile: next swipe snaps to the product list (top ${t.blocks[2]})`);
  await pg.evaluate(()=>scrollBy({top:600,behavior:"smooth"}));await pg.waitForTimeout(1400);t=await tops(pg);
  ok(t.blocks[2]<t.nav-400,`mobile: inside the product list it scrolls freely (list top ${t.blocks[2]})`);
  await pg.locator("#productsGrid .product-card").nth(1).click();await pg.waitForTimeout(800);
  ok(await pg.locator(".sheet.open").count()===1,"mobile: tapping a product still opens the quick view");
  await ctx.close();
}

// 5. 從 Google 直接進分類頁
{
  const ctx=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});await setup(ctx);
  const pg=await ctx.newPage();pg.on("pageerror",e=>errs.push(e.message));
  await pg.goto(ORIGIN+"/c/cat-chair");await pg.waitForTimeout(2200);
  const r=await pg.evaluate(()=>({hero:document.getElementById("hero").getBoundingClientRect().height,dots:document.querySelectorAll(".fx-dots button").length,vh:innerHeight}));
  ok(r.hero<r.vh-62-40&&r.dots===3,`category landing: no second block, hero keeps its own size (${Math.round(r.hero)}px), 3 dots`);
  await ctx.close();
}
ok(!errs.length,"no page errors "+errs.slice(0,2).join(" | "));
ok.done();await b.close();
