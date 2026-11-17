import {launch,setup,ORIGIN,checker,SHOTS} from "./lib.mjs";
const ok=checker();
const b=await launch();const errs=[];
for(const [name,vp] of [["desk",{width:1366,height:820}],["mob",{width:390,height:844}]]){
  const ctx=await b.newContext({viewport:vp,deviceScaleFactor:name==="mob"?2:1,hasTouch:name==="mob"});await setup(ctx);
  const pg=await ctx.newPage();pg.on("pageerror",e=>errs.push(name+": "+e.message));
  await pg.goto(ORIGIN+"/");await pg.waitForTimeout(3000);
  await pg.addStyleTag({content:"html{scroll-behavior:auto!important}"});
  // 首頁上直接連到 LINE 的入口只剩聯絡區塊
  const lineLinks=await pg.evaluate(()=>[...document.querySelectorAll('a[href*="lin.ee"],a[href*="line.me"]')].filter(a=>a.offsetParent!==null).map(a=>a.closest("section,footer,aside,nav,div[id]")?.id||a.className));
  console.log(name,"LINE links on home:",JSON.stringify(lineLinks));
  ok(lineLinks.every(x=>x==="contact"||x==="contactActions"||x==="contactItems"),name+" LINE links only in contact");
  ok(await pg.locator(".fx-line.show").count()===0,name+" no floating bar before any favourite");
  // 分類磚 CTA
  await pg.evaluate(()=>document.getElementById("catCta").scrollIntoView({block:"center"}));await pg.waitForTimeout(500);
  await pg.locator("#catTiles").screenshot({path:`${SHOTS}/ask-${name}-tiles.png`});
  // 商品頁
  await pg.locator("#productsGrid .product-card").first().click();await pg.waitForTimeout(1500);
  ok(await pg.locator(".lb-inquire-btn").count()===0,name+" no LINE button in product page");
  ok((await pg.locator("#lbAskBtn").textContent()).includes("收藏這件"),name+" ask button initial");
  await pg.evaluate(()=>document.querySelector(".lb-ask").scrollIntoView({block:"center"}));await pg.waitForTimeout(300);
  await pg.screenshot({path:`${SHOTS}/ask-${name}-1.png`});
  await pg.click("#lbAskBtn");await pg.waitForTimeout(600);
  ok((await pg.locator("#favSnack.show span").textContent()).includes("一次用 LINE 問老闆"),name+" first-time tip explains the flow");
  ok((await pg.locator("#lbAskBtn").textContent()).includes("已收藏・看收藏清單（共 1 件）"),name+" ask button after add");
  ok((await pg.locator("#lbBarFavCount").textContent())==="1",name+" top bar count 1");
  await pg.screenshot({path:`${SHOTS}/ask-${name}-2.png`});
  await pg.click("#lbAskBtn");await pg.waitForTimeout(700);
  ok(await pg.locator("#favoritesPanel.open").count()===1,name+" second click opens list");
  ok(await pg.locator("#favoritesInquireBtn").isVisible(),name+" list has LINE send button");
  await pg.screenshot({path:`${SHOTS}/ask-${name}-3.png`});
  // 在清單裡移除 → 商品頁按鈕變回來
  await pg.evaluate(()=>{state_remove:{const b=document.querySelector("#favoritesList [onclick*='setFavoriteQty'],#favoritesList .favorite-remove,#favoritesList button[aria-label*='移除']");if(b)b.click()}});
  await pg.evaluate(()=>toggleFavoritesPanel(false));await pg.waitForTimeout(500);
  await pg.keyboard.press("Escape");await pg.waitForTimeout(600);
  // 列表上按愛心：第二次之後是短提示
  await pg.locator("#productsGrid .favorite-btn").nth(2).click();await pg.waitForTimeout(500);
  const t=await pg.locator("#favSnack span").textContent();
  ok(/清單裡有 \d+ 件/.test(t),name+" later tip is short: "+t);
  if(name==="mob"){await pg.waitForTimeout(300);ok(await pg.locator(".fx-line.show").count()===1&&(await pg.locator(".fx-line").textContent()).includes("已收藏"),"mob floating bar shows count");await pg.waitForTimeout(4200);await pg.screenshot({path:`${SHOTS}/ask-mob-4.png`});
    await pg.click(".fx-line");await pg.waitForTimeout(600);ok(await pg.locator("#favoritesPanel.open").count()===1,"mob bar opens list")}
  await ctx.close();
}
ok(errs.length===0,"no JS errors "+errs.slice(0,2).join("|"));ok.done();await b.close();
