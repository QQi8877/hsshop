// 回到頂端的兩種情況（手機、電腦都要）：
// 1. 商品頁捲到中間 → 回商品列表 → 開別件商品：商品頁要從最上面開始看
// 2. 商品列表往下逛到一半 → 點左邊分類：畫面回到這個分類的標題
import {launch,setup,ORIGIN,checker} from "./lib.mjs";
const ok=checker();
const b=await launch();const errs=[];
for(const [name,w,h] of [["mob",390,844],["desk",1366,900]]){
  const ctx=await b.newContext({viewport:{width:w,height:h},hasTouch:name==="mob"});await setup(ctx);
  const pg=await ctx.newPage();pg.on("pageerror",e=>errs.push(e.message));
  await pg.goto(ORIGIN+"/c/cat-chair");await pg.waitForTimeout(2500);
  await pg.addStyleTag({content:"html{scroll-behavior:auto!important}"});
  const cards=pg.locator("#productsGrid .product-card");
  await cards.nth(0).click();await pg.waitForTimeout(900);
  // 不管是哪一層在捲（整個商品頁、右邊資訊欄），都捲到中間
  const scrolled=await pg.evaluate(()=>{const els=[document.getElementById("lightbox"),document.getElementById("lbInfo"),document.scrollingElement];els.forEach(e=>e.scrollTop=600);return els.map(e=>e.scrollTop)});
  ok(scrolled.some(v=>v>0),`${name}: the first product page can scroll (${scrolled})`);
  await pg.click(".lb-close");await pg.waitForTimeout(700);
  await cards.nth(3).click();await pg.waitForTimeout(900);
  const top=await pg.evaluate(()=>[document.getElementById("lightbox").scrollTop,document.getElementById("lbInfo").scrollTop]);
  ok(top[0]===0&&top[1]===0,`${name}: the next product opens at the top (${top})`);
  await pg.click(".lb-close");await pg.waitForTimeout(700);
  await pg.evaluate(()=>scrollBy(0,1500));await pg.waitForTimeout(500);
  await pg.locator('#catSidebar .cat-side-btn[data-main="cat-table"]').click();await pg.waitForTimeout(900);
  const t=await pg.evaluate(()=>{const nav=document.querySelector("nav").getBoundingClientRect().bottom,h=document.getElementById("listingTitle");return [Math.round(nav),Math.round(h.getBoundingClientRect().top),h.textContent]});
  ok(t[1]>=t[0]&&t[1]<=t[0]+60&&t[2]==="桌子",`${name}: tapping a category while scrolled goes back to its title (${t})`);
  // 標題本來就看得到時不要動
  const before=await pg.evaluate(()=>scrollY);
  await pg.locator('#catSidebar .cat-side-btn[data-main="cat-chair"]').click();await pg.waitForTimeout(700);
  ok(await pg.evaluate(()=>scrollY)===before,`${name}: no jump when the title is already in view`);
  await ctx.close();
}
ok(!errs.length,"no page errors "+errs.join(" | "));
await b.close();ok.done();
