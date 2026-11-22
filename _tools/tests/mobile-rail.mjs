import {launch,setup,ORIGIN,checker,SHOTS} from "./lib.mjs";
const ok=checker();
const b=await launch();const errs=[];
const ctx=await b.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,hasTouch:true});await setup(ctx);
const pg=await ctx.newPage();pg.on("pageerror",e=>errs.push(e.message));
await pg.goto(ORIGIN+"/");await pg.waitForTimeout(3000);
await pg.addStyleTag({content:"html{scroll-behavior:auto!important}"});
await pg.evaluate(()=>{document.querySelector(".cat-layout").scrollIntoView();scrollBy(0,-150)});await pg.waitForTimeout(700);
ok(await pg.locator("#categoriesBar").isHidden()&&await pg.locator("#catSidebar").isVisible(),"top tabs hidden, rail visible");
const g=await pg.evaluate(()=>{const r=document.getElementById("catSidebar").getBoundingClientRect(),c=[...document.querySelectorAll("#productsGrid .product-card")].slice(0,3).map(e=>e.getBoundingClientRect());return {rail:Math.round(r.width),c0:[Math.round(c[0].left),Math.round(c[0].width)],c1:Math.round(c[1].left),sameRow:Math.abs(c[0].top-c[1].top)<2,thirdBelow:c[2].top>c[0].top+10,overflow:document.documentElement.scrollWidth>innerWidth}});
console.log(JSON.stringify(g));
ok(g.rail===104&&g.c0[0]>=104&&g.c0[0]<=112&&g.sameRow&&g.thirdBelow&&!g.overflow,"rail 104px, cards start just right of it, two cards per row, no horizontal overflow");
await pg.screenshot({path:`${SHOTS}/rail-1.png`});
await pg.locator('#catSidebar .cat-side-btn[data-main="cat-chair"]').click();await pg.waitForTimeout(900);
ok(await pg.locator("#catSidebar .cat-subs .cat-sub-btn").count()>=4,"tapping a main category expands its sub-categories");
ok((await pg.locator("#listingTitle").textContent()).includes("椅子"),"title follows");
await pg.screenshot({path:`${SHOTS}/rail-2.png`});
await pg.locator("#catSidebar .cat-sub-btn").filter({hasText:"藤椅"}).click();await pg.waitForTimeout(900);
const n=await pg.locator("#productsGrid .product-card").count();
ok(n===10,"sub-category filters products ("+n+")");
ok(await pg.locator("#catSidebar .cat-sub-btn.active").textContent().then(t=>t.includes("藤椅")),"sub highlighted");
await pg.screenshot({path:`${SHOTS}/rail-3.png`});
// 往下捲：左欄黏在畫面上
await pg.locator('#catSidebar .cat-side-btn[data-main="全部"]').click();await pg.waitForTimeout(800);
await pg.evaluate(()=>scrollBy(0,1600));await pg.waitForTimeout(600);
const top=await pg.evaluate(()=>Math.round(document.getElementById("catSidebar").getBoundingClientRect().top));
ok(top===52,"rail sticks under the nav while scrolling (top "+top+")");
await pg.screenshot({path:`${SHOTS}/rail-4.png`});
// 捲到一半換分類：畫面回到這個分類的標題（標題就在導覽列下面）
await pg.locator('#catSidebar .cat-side-btn[data-main="cat-storage"]').click();await pg.waitForTimeout(900);
const lt=await pg.evaluate(()=>{const nav=document.querySelector("nav").getBoundingClientRect().bottom,t=document.getElementById("listingTitle").getBoundingClientRect();return [Math.round(nav),Math.round(t.top),document.getElementById("listingTitle").textContent]});
ok(lt[1]>=lt[0]&&lt[1]<=lt[0]+40&&lt[2]==="收納櫃/架","switching category while scrolled brings its title to the top ("+lt+")");
await pg.screenshot({path:`${SHOTS}/rail-5.png`});
// 子分類也一樣：先捲下去再點小分類
await pg.evaluate(()=>scrollBy(0,1200));await pg.waitForTimeout(500);
await pg.locator('#catSidebar .cat-sub-btn').first().click();await pg.waitForTimeout(900);
const st=await pg.evaluate(()=>{const nav=document.querySelector("nav").getBoundingClientRect().bottom,t=document.getElementById("listingTitle").getBoundingClientRect();return [Math.round(nav),Math.round(t.top)]});
ok(st[1]>=st[0]&&st[1]<=st[0]+40,"tapping a sub-category while scrolled also goes back to the title ("+st+")");
ok(errs.length===0,"no JS errors "+errs.slice(0,2).join("|"));ok.done();await b.close();
