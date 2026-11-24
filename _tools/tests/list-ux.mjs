// 2026-11 A 版「清爽型錄」的商品列表體驗（手機、電腦都測）：
// 手機：點商品先跳快速預覽（同類推薦換商品、收藏、看完整介紹、按上一頁關掉）、篩選面板、最近看過、
//       分類介紹「更多」、商品頁底部收藏列；電腦：點商品直接開商品頁、左邊的篩選、欄數跟著視窗寬度變、照片框正方形
import {launch,setup,ORIGIN,checker,SHOTS} from "./lib.mjs";
const ok=checker();
const b=await launch();const errs=[];
const watch=pg=>pg.on("pageerror",e=>errs.push(e.message));
const settle=(pg,ms=600)=>pg.waitForTimeout(ms);

/* ── 手機 ── */
{
  const ctx=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});await setup(ctx);
  const pg=await ctx.newPage();watch(pg);
  await pg.goto(ORIGIN+"/c/cat-chair");await settle(pg,2500);
  await pg.addStyleTag({content:"html{scroll-behavior:auto!important}"});
  const url0=await pg.evaluate(()=>location.pathname);
  // 分類介紹先兩行，「更多」展開
  const more=pg.locator("#introMore");
  ok(await more.isVisible(),"phone: long category intro shows the 更多 button");
  const h1=await pg.evaluate(()=>document.getElementById("listingIntro").getBoundingClientRect().height);
  await more.click();await settle(pg,200);
  const h2=await pg.evaluate(()=>document.getElementById("listingIntro").getBoundingClientRect().height);
  ok(h2>h1+10&&(await more.textContent())==="收起","phone: 更多 expands the intro ("+Math.round(h1)+"→"+Math.round(h2)+")");
  await more.click();
  ok(await pg.locator("#appliedChips").count()===0,"phone: the category chip row (duplicate of the rail) is gone");
  // 點商品：快速預覽，不是商品頁
  const card=pg.locator("#productsGrid .product-card").nth(2);
  await card.scrollIntoViewIfNeeded();
  const name=(await card.locator(".product-name").textContent()).trim();
  await card.locator(".product-img-wrap").click({position:{x:30,y:60}});await settle(pg);
  const qv=await pg.evaluate(()=>({open:!!document.querySelector('.sheet.open[data-kind="qv"]'),name:document.querySelector(".qv-name")?.textContent,size:document.querySelector(".qv-size")?.textContent,sims:document.querySelectorAll(".qv-sim-item").length,photo:!!document.querySelector(".qv-photo img"),lb:document.getElementById("lightbox").classList.contains("open")}));
  ok(qv.open&&!qv.lb,"phone: tapping a card opens the quick view, not the product page");
  ok(qv.name===name&&/尺寸/.test(qv.size)&&qv.photo&&qv.sims>0,"phone: quick view shows photo, name, size and similar items "+JSON.stringify(qv));
  await pg.screenshot({path:`${SHOTS}/list-ux-qv.png`});
  // 上一頁＝關掉預覽，不離開這一頁
  await pg.goBack();await settle(pg);
  ok(!(await pg.locator(".sheet.open").count())&&await pg.evaluate(()=>location.pathname)===url0,"phone: Back closes the quick view and stays on the page");
  // 再開一次：同類推薦換商品、收藏
  await card.locator(".product-img-wrap").click({position:{x:30,y:60}});await settle(pg);
  const simName=(await pg.locator(".qv-sim-item .qv-sim-name").first().textContent()).trim();
  await pg.locator(".qv-sim-item").first().click();await settle(pg,500);
  ok((await pg.locator(".qv-name").textContent())===simName,"phone: tapping a similar item switches the quick view to it");
  await pg.locator(".qv-fav").click();await settle(pg,400);
  ok(await pg.locator(".qv-fav.active").count()===1&&(await pg.locator(".qv-fav").textContent()).includes("已收藏"),"phone: favourite button in the quick view works");
  // 看完整介紹 → 商品頁；回商品列表 → 回到列表（不會又跳出預覽）
  await pg.locator(".qv-open").click();await settle(pg,1500);
  const lb=await pg.evaluate(()=>({lb:document.getElementById("lightbox").classList.contains("open"),title:document.getElementById("lbTitle")?.textContent,sheet:!!document.querySelector(".sheet.open")}));
  ok(lb.lb&&lb.title===simName&&!lb.sheet,"phone: 看完整介紹 opens that product's page "+JSON.stringify(lb));
  // 底部收藏列：一打開看不到原本的收藏鈕時出現；捲到原本的收藏鈕時收起來
  const dock0=await pg.evaluate(()=>{const a=document.getElementById("lbAskBtn").getBoundingClientRect();return {show:document.querySelector(".lb-dock")?.classList.contains("show"),askVisible:a.top<innerHeight&&a.bottom>0,txt:document.querySelector(".lb-dock-btn")?.textContent}});
  ok(dock0.askVisible?!dock0.show:dock0.show,"phone: product page dock follows whether the big favourite button is on screen "+JSON.stringify(dock0));
  ok(/已收藏/.test(dock0.txt||""),"phone: dock knows the product is already favourited ("+dock0.txt+")");
  await pg.evaluate(()=>{const lb=document.getElementById("lightbox"),a=document.getElementById("lbAskBtn");lb.scrollTop+=a.getBoundingClientRect().top-300});await settle(pg,500);
  ok(!(await pg.evaluate(()=>document.querySelector(".lb-dock").classList.contains("show"))),"phone: dock hides when the big favourite button is visible");
  await pg.evaluate(()=>{document.getElementById("lightbox").scrollTop=0});await settle(pg,500);
  await pg.screenshot({path:`${SHOTS}/list-ux-dock.png`});
  await pg.click(".lb-close");await settle(pg,900);
  ok(!(await pg.locator("#lightbox.open").count())&&!(await pg.locator(".sheet.open").count())&&await pg.evaluate(()=>location.pathname)===url0,"phone: closing the product page goes back to the list (no quick view popping up again)");
  // 最近看過：剛剛看過的兩件
  await pg.evaluate(()=>{document.getElementById("listingTitle").scrollIntoView();scrollBy(0,-80)});await settle(pg,400);
  const rec=await pg.evaluate(()=>({shown:!document.getElementById("recentStrip").hidden,n:document.querySelectorAll("#recentStrip .recent-item").length,first:document.querySelector("#recentStrip .recent-item")?.getAttribute("aria-label")}));
  ok(rec.shown&&rec.n>=2&&rec.first===simName,"phone: recently viewed strip lists what was just looked at "+JSON.stringify(rec));
  await pg.screenshot({path:`${SHOTS}/list-ux-recent.png`});
  await pg.locator("#recentStrip .recent-item").nth(1).click();await settle(pg);
  ok(await pg.locator('.sheet.open[data-kind="qv"]').count()===1,"phone: tapping a recently viewed item opens its quick view");
  await pg.keyboard.press("Escape");await settle(pg);
  ok(!(await pg.locator(".sheet.open").count()),"phone: Esc closes the quick view");
  // 篩選：收納櫃有標籤；商品格在畫面上才出現篩選鈕
  await pg.locator('#catSidebar .cat-side-btn[data-main="cat-storage"]').click();await settle(pg,900);
  const total=await pg.locator("#productsGrid .product-card").count();
  await pg.evaluate(()=>{document.getElementById("productsGrid").scrollIntoView();scrollBy(0,200)});await settle(pg,300);
  await pg.evaluate(()=>scrollBy(0,-120));await settle(pg,500);
  ok(await pg.locator(".filter-fab.show").count()===1,"phone: filter button shows while the product grid is on screen");
  await pg.locator(".filter-fab").click();await settle(pg);
  const chips=await pg.locator('.sheet.open .filter-chip[data-filter-tag]').allTextContents();
  ok(chips.length>=3,"phone: filter sheet lists the tags used on this page "+chips.join("/"));
  const tw=pg.locator('.sheet.open .filter-chip[data-filter-tag="madeintw"]');
  const twN=+(await tw.locator(".filter-n").textContent());
  await tw.click();await settle(pg,400);
  const after=await pg.locator("#productsGrid .product-card").count();
  ok(after===twN&&after<total&&(await pg.locator(".sheet.open [data-filter-apply]").textContent())===`看 ${twN} 件商品`,"phone: picking a tag filters the grid behind the sheet ("+total+"→"+after+")");
  await pg.screenshot({path:`${SHOTS}/list-ux-filter.png`});
  await pg.locator(".sheet.open [data-filter-apply]").click();await settle(pg);
  ok(!(await pg.locator(".sheet.open").count())&&(await pg.locator(".filter-fab-n").textContent())===String(twN),"phone: 看 N 件商品 closes the sheet; the button shows the count");
  // 換分類清掉篩選
  await pg.locator('#catSidebar .cat-side-btn[data-main="cat-chair"]').click();await settle(pg,900);
  ok(await pg.locator("#productsGrid .product-card").count()===34&&(await pg.locator(".filter-fab-n").textContent())==="","phone: switching category clears the filter");
  // 本月選品（首頁）也是先跳預覽
  await pg.goto(ORIGIN+"/");await settle(pg,2500);
  await pg.locator("#picksGrid .p-card").first().scrollIntoViewIfNeeded();
  await pg.locator("#picksGrid .p-card .p-card__media").first().click({position:{x:30,y:60}});await settle(pg);
  ok(await pg.locator('.sheet.open[data-kind="qv"]').count()===1,"phone: home picks also open the quick view");
  const ov=await pg.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
  ok(!ov,"phone: no sideways scrolling");
  await ctx.close();
}

/* ── 電腦：欄數跟著寬度、照片框正方形、點商品直接開商品頁、左邊篩選 ── */
for(const [w,cols] of [[900,3],[1280,4],[1600,5],[2000,6]]){
  const ctx=await b.newContext({viewport:{width:w,height:900}});await setup(ctx);
  const pg=await ctx.newPage();watch(pg);
  await pg.goto(ORIGIN+"/c/cat-chair");await settle(pg,2200);
  const g=await pg.evaluate(()=>{const cards=[...document.querySelectorAll("#productsGrid .product-card")].slice(0,12);const lefts=new Set(cards.map(c=>Math.round(c.getBoundingClientRect().left)));
    const sq=cards.every(c=>{const r=c.querySelector(".product-img-wrap").getBoundingClientRect();return Math.abs(r.width-r.height)<1.5});
    const inFrame=cards.every(c=>{const r=c.querySelector(".product-img-wrap").getBoundingClientRect();return [...c.querySelectorAll(".product-img-wrap img")].every(i=>{const q=i.getBoundingClientRect();return q.left>=r.left-.5&&q.right<=r.right+.5&&q.top>=r.top-.5&&q.bottom<=r.bottom+.5})});
    const oneLine=cards.every(c=>{const s=c.querySelector(".product-size");return s.scrollHeight<=parseFloat(getComputedStyle(s).lineHeight)*1.5});
    return {cols:lefts.size,sq,inFrame,oneLine,ov:document.documentElement.scrollWidth>innerWidth}});
  ok(g.cols===cols&&g.sq&&g.inFrame&&g.oneLine&&!g.ov,`desktop ${w}px: ${cols} columns, square photo frames, photos inside frames, size on one line, no overflow `+JSON.stringify(g));
  if(w===1280){
    ok(await pg.locator(".filter-fab").isHidden()&&await pg.locator("#sideFilter").isVisible(),"desktop: filter lives in the left column (no floating button)");
    // 滑過有好幾張照片的卡片：第二張還沒載好（假資料只有一張）時封面要留著，照片框不能變空白
    const multi=pg.locator("#productsGrid .product-card:has(.img-primary.has-secondary)").first();
    await multi.scrollIntoViewIfNeeded();await multi.hover();await settle(pg,800);
    const op=await multi.evaluate(c=>getComputedStyle(c.querySelector(".img-primary")).opacity);
    ok(op==="1","desktop: hovering a multi-photo card keeps the cover until the second photo has loaded (opacity "+op+")");
    await pg.mouse.move(5,5);
    await pg.locator("#productsGrid .product-card").nth(1).click();await settle(pg,1200);
    ok(await pg.locator("#lightbox.open").count()===1&&!(await pg.locator(".sheet.open").count()),"desktop: clicking a card opens the product page directly");
    ok(await pg.locator(".lb-dock").isHidden(),"desktop: no bottom dock on the product page");
    await pg.click(".lb-close");await settle(pg,800);
    ok(await pg.evaluate(()=>!document.getElementById("recentStrip").hidden),"desktop: recently viewed strip shows after viewing a product");
    // 全部：特色標籤、排序（排序時不分區）、清除
    await pg.locator('#catSidebar .cat-side-btn[data-main="全部"]').click();await settle(pg,900);
    const heads0=await pg.locator(".products-section-head").count();
    const cust=pg.locator('#sideFilter .filter-chip[data-filter-tag="custom"]');
    const n=+(await cust.locator(".filter-n").textContent());
    await cust.click();await settle(pg,600);
    ok(await pg.locator("#productsGrid .product-card").count()===n,"desktop: tag filter in the left column ("+n+")");
    await pg.locator('#sideFilter .filter-chip[data-filter-tag="custom"]').click();await settle(pg,400);
    await pg.locator('#sideFilter .filter-chip[data-filter-sort="small"]').click();await settle(pg,600);
    const ws=await pg.evaluate(()=>[...document.querySelectorAll("#productsGrid .product-card .product-size")].slice(0,10).map(s=>parseFloat(s.textContent)));
    const asc=ws.filter(x=>!isNaN(x)).every((x,i,a)=>!i||a[i-1]<=x);
    ok(asc&&await pg.locator(".products-section-head").count()===0&&heads0>0,"desktop: 由小到大 sorts by width and drops the section headings "+ws.join(","));
    await pg.locator("#sideFilter [data-filter-clear]").click();await settle(pg,600);
    ok(await pg.locator(".products-section-head").count()===heads0,"desktop: 清除 restores the normal list");
    await pg.screenshot({path:`${SHOTS}/list-ux-desktop.png`});
  }
  await ctx.close();
}
ok(errs.length===0,"no JS errors "+errs.slice(0,3).join(" | "));
ok.done();await b.close();
