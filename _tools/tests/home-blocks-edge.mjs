// 首頁四大區塊・整頁翻頁的特殊情況（2026-11 審查找到、修好的 15 項，壞回去這裡會抓到）：
// 1. 矮手機停得到「聯繫我們」標題和 LINE 按鈕；選單按「聯繫」也看得到
// 2. 重新整理、在第四塊重新整理：回到原本位置（不會被拉回本月選品）
// 3. 電腦在商品列表底部、購買須知用滾輪照常捲（不會被彈回）
// 4. 顧客傳來的收藏清單視窗、可以捲的分類欄：滾輪捲的是它們，不會翻動後面整頁
// 5. 觸控板左右滑不會翻頁
// 6. 網頁放大（大圖比畫面高）：滾輪照常捲，看得到「探索商品」按鈕
// 7. 手機在商品列表開頭看得到「篩選」鈕
// 8. 本月選品有標價、分類磚五格、後台關掉選品或分類磚：第二塊還是一個畫面、分類磚不被切、不爆框
// 9. 手機橫拿：第二塊比畫面高時分類磚滑得到
// 10. 矮手機有收藏時，第二塊的分類磚不被底部收藏條、回頂端鈕蓋住
// 11. 直立平板的大圖、選品照片下載夠大
// 12. 小圓點每顆都有名稱（分類頁、選品關掉時）
import {launch,setup,seedStore,ORIGIN,checker} from "./lib.mjs";
const ok=checker();
const b=await launch();const errs=[];
const settle=async pg=>{let last=-1,same=0;for(let i=0;i<60&&same<4;i++){await pg.waitForTimeout(110);const y=await pg.evaluate(()=>scrollY);same=y===last?same+1:0;last=y}};
async function open(w,h,{mob=w<761,store,path="/",favs=0,dpr=1,blockSiteJson=!!store}={}){
  const ctx=await b.newContext({viewport:{width:w,height:h},deviceScaleFactor:dpr,isMobile:mob&&w<761,hasTouch:mob});
  await setup(ctx,{store,blockSiteJson});
  if(favs)await ctx.addInitScript(n=>{try{const ids=["25wiond0","e6scjcdl","b2y4l1gb","4mluw50c"].slice(0,n);
    localStorage.setItem("xintong_favorites_v1",JSON.stringify({items:ids.map(id=>({id,qty:1,note:"",addedAt:Date.now()})),savedAt:Date.now()}))}catch(e){}},favs);
  const pg=await ctx.newPage();pg.on("pageerror",e=>errs.push(e.message));
  await pg.goto(ORIGIN+path);await pg.waitForTimeout(2300);
  return {ctx,pg};
}
const box=(pg,sel)=>pg.evaluate(s=>{const e=document.querySelector(s);if(!e)return null;const r=e.getBoundingClientRect();return {top:Math.round(r.top),bottom:Math.round(r.bottom),h:Math.round(r.height)}},sel);
const at=(pg,sel)=>pg.evaluate(s=>document.querySelector(s).getBoundingClientRect().top+scrollY,sel);

// 1. 矮手機：聯繫我們
for(const [w,h] of [[375,667],[390,664],[360,640]]){
  const {ctx,pg}=await open(w,h);
  await pg.evaluate(()=>document.dispatchEvent(new Event("hs:gridall")));
  await pg.evaluate(()=>scrollTo({top:document.getElementById("contact").getBoundingClientRect().top+scrollY-52,behavior:"instant"}));
  const y0=await pg.evaluate(()=>scrollY);await settle(pg);
  const y1=await pg.evaluate(()=>scrollY),head=await box(pg,".contact-heading"),btn=await box(pg,".contact-btn--primary");
  ok(Math.abs(y1-y0)<=2&&head.top>=52&&btn.bottom<=h,`${w}x${h}: 聯繫我們 stays put with its heading and LINE button on screen (y ${y0}→${y1}, heading ${head.top}, LINE ${btn.top}–${btn.bottom})`);
  await ctx.close();
}
{
  const {ctx,pg}=await open(375,667);
  await pg.click(".nav-toggle, .hamburger, #mobileNavToggle").catch(()=>{});
  await pg.evaluate(()=>{const a=document.querySelector('a[href="#contact"]');a.click()});await settle(pg);
  const head=await box(pg,".contact-heading"),btn=await box(pg,".contact-btn--primary");
  ok(head.top>=48&&btn.bottom<=667,`375x667: the 「聯繫」 link shows the 聯繫我們 heading and LINE button (heading ${head.top}, LINE bottom ${btn.bottom})`);
  await ctx.close();
}

// 2. 重新整理：回到原本的位置
for(const [w,h,mob] of [[1280,800,false],[390,844,true]]){
  const {ctx,pg}=await open(w,h,{mob});
  for(const where of ["list","contact"]){
    await pg.evaluate(where=>{if(where==="contact")document.dispatchEvent(new Event("hs:gridall"));
      const t=where==="list"?document.getElementById("productsGrid").getBoundingClientRect().top+scrollY+1500:document.getElementById("contact").getBoundingClientRect().top+scrollY-52;
      scrollTo({top:t,behavior:"instant"})},where);
    await settle(pg);const before=await pg.evaluate(()=>scrollY);
    await pg.reload();await pg.waitForTimeout(2600);await settle(pg);
    const after=await pg.evaluate(()=>({y:scrollY,snap:document.documentElement.classList.contains("snap")}));
    ok(Math.abs(after.y-before)<=4&&after.snap,`${w}x${h}: reloading in the ${where==="list"?"product list":"contact block"} returns to the same spot (${before} → ${after.y}), snapping back on`);
  }
  await ctx.close();
}

// 3. 電腦：商品列表底部、購買須知照常用滾輪捲
{
  const {ctx,pg}=await open(1280,800);
  await pg.mouse.move(700,420);
  await pg.evaluate(()=>document.dispatchEvent(new Event("hs:gridall")));await pg.waitForTimeout(300);
  await pg.evaluate(()=>{const c=document.getElementById("categories").getBoundingClientRect();scrollTo({top:c.bottom+scrollY-innerHeight,behavior:"instant"})});await settle(pg);
  const y0=await pg.evaluate(()=>scrollY);
  await pg.mouse.wheel(0,100);await settle(pg);await pg.mouse.wheel(0,100);await settle(pg);
  const y1=await pg.evaluate(()=>scrollY);
  ok(y1>=y0+150,`desktop: two wheel notches at the end of the list keep scrolling down (${y0} → ${y1})`);
  await pg.evaluate(()=>scrollTo({top:document.getElementById("buyInfo").getBoundingClientRect().top+scrollY-52,behavior:"instant"}));await settle(pg);
  const y2=await pg.evaluate(()=>scrollY);await pg.mouse.wheel(0,-100);await settle(pg);const y3=await pg.evaluate(()=>scrollY);
  await pg.mouse.wheel(0,100);await settle(pg);await pg.mouse.wheel(0,100);await settle(pg);const y4=await pg.evaluate(()=>scrollY);
  ok(y3<=y2-60&&y4>=y3+150,`desktop: at 購買須知 the wheel scrolls up and down normally (${y2} → ${y3} → ${y4})`);
  await ctx.close();
}

// 4. 收藏清單視窗、分類欄
{
  const store=await seedStore();
  const ids=[...store.keys()].filter(k=>/\/products\/[^/]+$/.test(k)).slice(0,16).map(k=>k.split("/").pop());
  const {ctx,pg}=await open(1280,800,{path:"/#wishlist="+ids.join(",")});
  const open1=await pg.locator("#wishlistModal.open").count();
  await pg.mouse.move(640,420);
  await pg.mouse.wheel(0,120);await settle(pg);await pg.mouse.wheel(0,120);await settle(pg);
  const r=await pg.evaluate(()=>({y:scrollY,list:document.querySelector("#wishlistModal .modal-scroll").scrollTop}));
  ok(open1===1&&r.y===0&&r.list>100,`desktop: wheel over a customer's shared wishlist scrolls the list, not the page behind (page ${r.y}, list ${r.list})`);
  await ctx.close();
}
{
  const {ctx,pg}=await open(1280,600);
  await pg.evaluate(()=>document.getElementById("categories").scrollIntoView({block:"start",behavior:"instant"}));await settle(pg);
  const side=await pg.evaluate(()=>{const s=document.getElementById("catSidebar"),r=s.getBoundingClientRect();s.style.maxHeight="200px";s.style.overflowY="auto";return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+60)}});
  await pg.mouse.move(side.x,side.y);
  await pg.mouse.wheel(0,80);await settle(pg);
  const y0=await pg.evaluate(()=>scrollY),s0=await pg.evaluate(()=>document.getElementById("catSidebar").scrollTop);
  await pg.mouse.wheel(0,-60);await settle(pg);
  const y1=await pg.evaluate(()=>scrollY),s1=await pg.evaluate(()=>document.getElementById("catSidebar").scrollTop);
  ok(s0>0&&s1<s0&&Math.abs(y1-y0)<=2,`desktop: wheel up over a scrollable category sidebar scrolls the sidebar, page stays (sidebar ${s0}→${s1}, page ${y0}→${y1})`);
  await ctx.close();
}

// 5. 觸控板左右滑；6. 網頁放大
{
  const {ctx,pg}=await open(1280,800);
  await pg.mouse.move(640,420);
  await pg.mouse.wheel(100,2);await settle(pg);await pg.mouse.wheel(-100,-2);await settle(pg);
  ok(await pg.evaluate(()=>scrollY)===0,"desktop: a sideways trackpad swipe on the hero does not flip the page");
  await ctx.close();
}
for(const [w,h] of [[683,328],[640,360]]){
  const {ctx,pg}=await open(w,h,{mob:false});
  await pg.mouse.move(w/2,h/2);
  let seen=false;
  for(let i=0;i<8&&!seen;i++){await pg.mouse.wheel(0,100);await settle(pg);const btn=await box(pg,".hero-line-cta");seen=btn.top>=0&&btn.bottom<=h}
  ok(seen,`${w}x${h} (zoomed in): wheeling down the tall hero passes over the 「探索商品」 button instead of skipping it`);
  await ctx.close();
}

// 7. 手機：商品列表開頭的「篩選」鈕
{
  const {ctx,pg}=await open(390,844);
  await pg.evaluate(()=>document.getElementById("homeRest").scrollIntoView({block:"start",behavior:"smooth"}));await settle(pg);await pg.waitForTimeout(300);
  ok(await pg.locator(".filter-fab.show").count()===1,"mobile: arriving at the top of the product list shows the 篩選 button");
  await ctx.close();
}

// 8. 第二塊：有標價、五格、關掉選品／分類磚
const b2=pg=>pg.evaluate(()=>{const g=document.getElementById("homeB2").getBoundingClientRect(),t=document.getElementById("catTilesGrid").getBoundingClientRect(),p=document.getElementById("picks");
  return {h:g.height,tilesBottom:t.bottom-g.top,picksH:p.offsetHeight,vh:innerHeight,over:[...document.querySelectorAll("#catTilesGrid .cat-tile")].some(e=>e.scrollHeight>e.clientHeight+1)}});
{
  const store=await seedStore();
  const meta=store.get("sitedata/hsshop-10bd9");
  for(const id of meta.layout.picksProductIds){const k=`sitedata/hsshop-10bd9/products/${id}`;store.set(k,{...store.get(k),price:"12800"})}
  for(const [w,h] of [[375,667],[390,664],[360,640],[768,1024],[1280,800],[1366,657]]){
    const {ctx,pg}=await open(w,h,{store});
    const n=await pg.locator("#picksGrid .price").count(),r=await b2(pg);
    ok(n===4&&Math.abs(r.h-(r.vh-52))<=2&&r.tilesBottom<=r.h+1,`${w}x${h}: with prices on 本月選品 block 2 is still one screen and the tiles fit (${Math.round(r.h)} vs ${r.vh-52}, tiles end ${Math.round(r.tilesBottom)})`);
    await ctx.close();
  }
}
{
  const store=await seedStore();
  const any=[...store.keys()].find(k=>/\/products\/[^/]+$/.test(k));
  store.set("sitedata/hsshop-10bd9/products/bedtest1",{...store.get(any),id:"bedtest1",name:"測試床架",mainCat:"cat-bed",subCat:"sub-bed-frame",status:"active"});
  for(const [w,h] of [[375,667],[360,740],[390,844]]){
    const {ctx,pg}=await open(w,h,{store});
    const tiles=await pg.locator("#catTilesGrid .cat-tile").count(),r=await b2(pg);
    ok(tiles===5&&!r.over&&Math.abs(r.h-(r.vh-52))<=2,`${w}x${h}: five category tiles fit in one row without spilling out (${tiles} tiles)`);
    await ctx.close();
  }
}
for(const [flag,label] of [["showPicks","本月選品"],["showCatTiles","分類磚"]]){
  const store=await seedStore();
  const meta=store.get("sitedata/hsshop-10bd9");store.set("sitedata/hsshop-10bd9",{...meta,layout:{...meta.layout,[flag]:false}});
  for(const [w,h] of [[1280,800],[390,844]]){
    const {ctx,pg}=await open(w,h,{store});
    const r=await b2(pg);
    await pg.evaluate(()=>document.getElementById("homeB2").scrollIntoView({block:"start",behavior:"instant"}));await settle(pg);
    const cur=await pg.evaluate(()=>[...document.querySelectorAll(".fx-dots button")].findIndex(d=>d.getAttribute("aria-current")==="true"));
    const labels=await pg.evaluate(()=>[...document.querySelectorAll(".fx-dots button")].map(d=>d.getAttribute("aria-label")));
    ok(Math.abs(r.h-(r.vh-52))<=2&&cur===1&&labels.every(Boolean),`${w}x${h}: with ${label} turned off, block 2 still fills one screen and the 2nd dot is active (${Math.round(r.h)} vs ${r.vh-52}; ${labels.join("／")})`);
    await ctx.close();
  }
}

// 9. 手機橫拿：第二塊比畫面高時，分類磚滑得到
for(const [w,h] of [[844,390],[667,375]]){
  const {ctx,pg}=await open(w,h,{mob:true});
  await pg.evaluate(()=>{const g=document.getElementById("homeB2").getBoundingClientRect();scrollTo({top:g.bottom+scrollY-innerHeight,behavior:"instant"})});
  const y0=await pg.evaluate(()=>scrollY);await settle(pg);
  const y1=await pg.evaluate(()=>scrollY),t=await box(pg,"#catTilesGrid");
  ok(Math.abs(y1-y0)<=2&&t.top>=52&&t.bottom<=h,`${w}x${h} (phone sideways): the category tiles can rest fully on screen (y ${y0}→${y1}, tiles ${t.top}–${t.bottom})`);
  await ctx.close();
}

// 10. 矮手機有收藏：分類磚不被蓋住
for(const [w,h] of [[375,667],[360,640]]){
  const {ctx,pg}=await open(w,h,{favs:1});
  await pg.evaluate(()=>document.getElementById("homeB2").scrollIntoView({block:"start",behavior:"instant"}));await settle(pg);await pg.waitForTimeout(400);
  const hit=await pg.evaluate(()=>[...document.querySelectorAll("#catTilesGrid .cat-tile")].map(t=>{const r=t.getBoundingClientRect();const e=document.elementFromPoint(r.left+r.width/2,r.top+r.height*.75);return !!(e&&t.contains(e))}));
  ok(hit.length&&hit.every(Boolean),`${w}x${h} with a favorite: every category tile is tappable at block 2 (${hit.join(",")})`);
  await pg.evaluate(()=>document.getElementById("homeRest").scrollIntoView({block:"start",behavior:"instant"}));await settle(pg);await pg.waitForTimeout(400);
  ok(await pg.locator(".fx-line.show").count()===1,`${w}x${h} with a favorite: the 「已收藏 N 件」 bar comes back in the product list`);
  await ctx.close();
}

// 11. 直立平板的照片尺寸
{
  const {ctx,pg}=await open(1024,1366,{mob:true,dpr:2});
  const r=await pg.evaluate(()=>[document.getElementById("heroPhotoImg"),document.querySelector("#picksGrid img")].map(e=>{const r=e.getBoundingClientRect(),m=(e.currentSrc||"").match(/w_(\d+)/);return {need:Math.min(r.width,r.height)*devicePixelRatio,got:m?+m[1]:0}}));
  ok(r[0].got>=r[0].need*.95&&r[1].got>=r[1].need*.95,`1024x1366@2x: hero and 本月選品 photos are downloaded big enough (hero ${r[0].got}/${Math.round(r[0].need)}, pick ${r[1].got}/${Math.round(r[1].need)})`);
  await ctx.close();
}

// 12. 小圓點的名稱
for(const path of ["/c/cat-chair","/p/15t3sbhy"]){
  const {ctx,pg}=await open(1280,800,{path});
  if(path.startsWith("/p/")){await pg.click(".lb-close").catch(()=>{});await pg.waitForTimeout(800)}
  const labels=await pg.evaluate(()=>[...document.querySelectorAll(".fx-dots button")].map(d=>d.getAttribute("aria-label")));
  ok(labels.length>=3&&labels.every(Boolean),`${path}: every side dot has a name (${labels.join("／")})`);
  await ctx.close();
}

ok(!errs.length,"no page errors "+errs.slice(0,2).join(" | "));
ok.done();await b.close();
