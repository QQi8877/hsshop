import {launch,setup,seedStore,ORIGIN,checker,SHOTS} from "./lib.mjs";
const ok=checker();
const b=await launch();const errs=[];
const store=await seedStore();
// 坐鞋櫃：圖庫放三張不同的照片
const G="sitedata/hsshop-10bd9/products/4mluw50c/gallery/full";
const base=store.get(G).photos[0];
store.set(G,{photos:[base,base.replace(/([^/]+)\.jpg$/,"aaa_$1.jpg"),base.replace(/([^/]+)\.jpg$/,"bbbb_$1.jpg")],photoOriginals:[],batchBackup:null});
for(const [name,vp] of [["desk",{width:1366,height:820}],["mob",{width:390,height:844}]]){
  const ctx=await b.newContext({viewport:vp,deviceScaleFactor:name==="mob"?2:1,hasTouch:name==="mob"});await setup(ctx,{store});
  const pg=await ctx.newPage();pg.on("pageerror",e=>errs.push(name+": "+e.message));
  await pg.goto(ORIGIN+"/#product-4mluw50c");await pg.waitForTimeout(1500);
  await pg.waitForTimeout(2500);
  ok(await pg.locator("#lightbox.open").count()===1,name+" opens");
  ok(await pg.locator(".lb-thumb").count()===3,name+" 3 thumbs");
  ok((await pg.locator("#lbCounter").textContent())==="1 / 3",name+" counter 1/3");
  ok(await pg.locator("#lbNext").isVisible(),name+" next arrow visible");
  await pg.screenshot({path:`${SHOTS}/pageB-${name}-1.png`});
  const src1=await pg.locator("#lbImg").getAttribute("src");
  await pg.click("#lbNext");await pg.waitForTimeout(700);
  ok((await pg.locator("#lbCounter").textContent())==="2 / 3"&&await pg.locator("#lbImg").getAttribute("src")!==src1,name+" arrow → photo 2");
  await pg.locator(".lb-thumb").nth(2).click();await pg.waitForTimeout(700);
  ok((await pg.locator("#lbCounter").textContent())==="3 / 3",name+" thumb → photo 3");
  await pg.keyboard.press("ArrowLeft");await pg.waitForTimeout(500);
  ok((await pg.locator("#lbCounter").textContent())==="2 / 3",name+" keyboard ← → photo 2");
  // 點版面留白不會關掉
  await pg.mouse.click(4,vp.height-6);await pg.waitForTimeout(300);
  ok(await pg.locator("#lightbox.open").count()===1,name+" margin click keeps page open");
  // 往下捲：資訊跟著捲，頂端的返回列還在
  await pg.evaluate(()=>document.getElementById("lightbox").scrollTo(0,500));await pg.waitForTimeout(400);
  ok(await pg.locator(".lb-close").isVisible(),name+" back bar stays");
  await pg.screenshot({path:`${SHOTS}/pageB-${name}-2.png`});
  await pg.click(".lb-close");await pg.waitForTimeout(700);
  ok(await pg.locator("#lightbox.open").count()===0,name+" back closes");
  // 只有一張照片的商品：沒有箭頭、張數、說明
  await pg.locator("#productsGrid .product-card").first().click();await pg.waitForTimeout(1500);
  ok(await pg.locator("#lbNext").isHidden()&&await pg.locator("#lbCounter").isHidden()&&await pg.locator(".lb-hint").isHidden(),name+" single photo: no arrows/counter/hint");
  await pg.keyboard.press("Escape");await pg.waitForTimeout(500);
  ok(await pg.locator("#lightbox.open").count()===0,name+" esc closes");
  await ctx.close();
}
ok(errs.length===0,"no JS errors "+errs.slice(0,2).join("|"));
ok.done();await b.close();
