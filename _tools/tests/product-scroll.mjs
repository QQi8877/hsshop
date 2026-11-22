// 商品頁捲到中間 → 回商品列表 → 開別件商品：要從最上面開始看（手機、電腦都要）
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
  await ctx.close();
}
ok(!errs.length,"no page errors "+errs.join(" | "));
await b.close();ok.done();
