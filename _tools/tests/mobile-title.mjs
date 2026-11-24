import {launch,setup,ORIGIN,checker} from "./lib.mjs";
const ok=checker();
const b=await launch();const errs=[];
import {SHOTS as S} from "./lib.mjs";
for(const [name,w] of [["mob",390],["desk",1366]]){
  const ctx=await b.newContext({viewport:{width:w,height:844},deviceScaleFactor:name==="mob"?2:1,hasTouch:name==="mob"});await setup(ctx);
  const pg=await ctx.newPage();pg.on("pageerror",e=>errs.push(e.message));
  // 直接打開子分類頁（自動產生的靜態頁），再看前台接手後的樣子
  await pg.goto(ORIGIN+"/c/sub-4fkg0i44");await pg.waitForTimeout(2500);
  await pg.addStyleTag({content:"html{scroll-behavior:auto!important}"});
  const t=await pg.evaluate(()=>{const h=document.getElementById("listingTitle"),i=document.getElementById("listingIntro");const vis=[...h.children].filter(c=>getComputedStyle(c).display!=="none").map(c=>c.textContent);
    const r=i.getBoundingClientRect(),p=i.parentElement.getBoundingClientRect();return {tag:h.tagName,vis,align:getComputedStyle(i).textAlign,introRight:Math.round(p.right-r.right)}});
  console.log(name,JSON.stringify(t));
  if(name==="mob"){
    ok(t.vis.join("")==="椅子»藤椅","mobile title shows 椅子 » 藤椅");
    ok(t.align==="justify","mobile intro justified");
    await pg.evaluate(()=>{document.getElementById("listingTitle").scrollIntoView({block:"start"});scrollBy(0,-70)});await pg.waitForTimeout(400);
    await pg.screenshot({path:`${S}/title-mob.png`});
    await pg.click("#listingTitle .lt-main");await pg.waitForTimeout(800);
    ok((await pg.locator("#listingTitle").textContent())==="椅子"&&new URL(pg.url()).pathname==="/c/cat-chair","tapping 椅子 goes back to the main category");
    // 全部：椅子區的欄線
    await pg.locator('#catSidebar .cat-side-btn[data-main="全部"]').click();await pg.waitForTimeout(800);
    const cols=await pg.evaluate(()=>{const g=document.getElementById("productsGrid").getBoundingClientRect();return [...document.querySelectorAll("#productsGrid .product-card")].slice(12,17).map(c=>{const r=c.getBoundingClientRect(),w=c.querySelector(".product-img-wrap");return [r.left-g.left<20?"L":"R",getComputedStyle(w).borderRadius,getComputedStyle(c).borderLeftWidth,Math.round(r.right),getComputedStyle(c).backgroundColor]})});
    console.log(JSON.stringify(cols));
    // 奇數件分類後面：左右欄照樣交替、每張都是同樣的卡（照片圓角框、卡片本身沒有底色和框線）、不超出螢幕
    ok(cols.every(([,rad,bl,,bg])=>rad==="12px"&&bl==="0px"&&bg==="rgba(0, 0, 0, 0)")&&cols.every(c=>c[3]<=390)&&new Set(cols.map(c=>c[0])).size===2,"cards after an odd-sized category keep the same look, nothing past the screen edge");
    await pg.evaluate(()=>{[...document.querySelectorAll("#productsGrid .products-section-head")][1].scrollIntoView({block:"start"});scrollBy(0,-60)});await pg.waitForTimeout(500);
    await pg.screenshot({path:`${S}/cols-mob.png`});
  }else{
    ok(t.vis.join("")==="椅子»藤椅","desktop title also shows 椅子 » 藤椅");
  }
  await ctx.close();
}
ok(errs.length===0,"no errors "+errs.join("|"));ok.done();await b.close();
