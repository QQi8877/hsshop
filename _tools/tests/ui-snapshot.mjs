// 把一批元素的「實際算出來的樣式」存成 JSON，整理 CSS 前後各跑一次，比對有沒有任何差異
import {launch,setup,seedStore,ORIGIN} from "./lib.mjs";
import fs from "fs";
const out=process.argv[2];
const SEL=["#lightbox",".lb-bar",".lb-close",".lb-bar-fav",".lb-layout",".lb-left",".lb-stage-wrap",".lb-stage","#lbImg","#lbPrev","#lbNext","#lbCounter",".lb-thumbs",".lb-thumb",".lb-thumb.active",".lb-hint",".lb-info",".lb-product-title",".lb-product-cat",".lb-spec-title",".lb-dim",".lb-product-note",".lb-ask",".lb-ask-btn",".lb-ask-note",".lb-similar",".lb-favorite",
 "nav",".hero-inner",".hero-title",".hero-actions",".hero-line-cta",".hero-photo","#picks .sec-head h2",".p-card",".p-card__title",".p-card__foot",".cat-tile",".cat-tile--cta",".cat-side-btn",".cat-tab",".product-card",".product-info",".product-name",".product-size",".product-img-wrap",".favorite-btn",".favorites-fab",".favorites-panel",".favorites-inquire-btn",".favorites-empty",".fx-line",".fx-top",".fx-progress","#buyInfoLine",".contact-btn","footer",".products-section-head",".listing-title"];
const b=await launch();const res={};
const store=await seedStore();
const G="sitedata/hsshop-10bd9/products/4mluw50c/gallery/full";const base=store.get(G).photos[0];
store.set(G,{photos:[base,base.replace(/([^/]+)\.jpg$/,"aaa_$1.jpg"),base.replace(/([^/]+)\.jpg$/,"bbbb_$1.jpg")],photoOriginals:[],batchBackup:null});
for(const [name,vp] of [["desk",{width:1366,height:820}],["tab",{width:800,height:900}],["mob",{width:390,height:844}]]){
  const ctx=await b.newContext({viewport:vp,hasTouch:name==="mob",reducedMotion:"reduce"});await setup(ctx,{store});
  const pg=await ctx.newPage();
  const grab=tag=>pg.evaluate(SEL=>{const o={};for(const s of SEL){const e=document.querySelector(s);if(!e){o[s]=null;continue}const cs=getComputedStyle(e),d={};for(const p of cs)d[p]=cs.getPropertyValue(p);for(const ps of ["::before","::after"]){const c=getComputedStyle(e,ps);if(c.content&&c.content!=="none")for(const p of c)d[ps+p]=c.getPropertyValue(p)}const r=e.getBoundingClientRect();d.__rect=[r.x,r.y,r.width,r.height].map(Math.round).join(",");o[s]=d}return o},SEL).then(o=>{res[name+":"+tag]=o});
  await pg.goto(ORIGIN+"/");await pg.waitForTimeout(3000);
  await grab("home");
  await pg.goto(ORIGIN+"/#product-4mluw50c");await pg.reload();await pg.waitForTimeout(3500);
  await grab("product");
  await pg.click("#lbAskBtn");await pg.waitForTimeout(5000);
  await pg.click("#lbAskBtn");await pg.waitForTimeout(900);
  await grab("list");
  await ctx.close();
}
fs.writeFileSync(out,JSON.stringify(res));
console.log("saved",out,Object.keys(res).length);await b.close();
