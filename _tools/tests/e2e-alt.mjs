// #13 auto alt text on storefront: cards name（分類）, hover empty, lightbox numbered, thumbs labeled.
import {launch,setup,ORIGIN,checker} from "./lib.mjs";
const ok=checker();
const b=await launch();
for(const vp of [{width:1400,height:900},{width:390,height:844}]){
  const ctx=await b.newContext({viewport:vp,hasTouch:vp.width<500});
  await setup(ctx);
  const pg=await ctx.newPage();const errs=[];pg.on("pageerror",e=>errs.push(e.message));pg.on("console",m=>{if(m.type()==="error")errs.push(m.text())});
  await pg.goto(ORIGIN+"/");
  await pg.waitForSelector("#productsGrid img.img-primary",{timeout:15000});
  const alts=await pg.$$eval("#productsGrid img.img-primary",i=>i.map(x=>x.alt));
  ok(alts.length>0&&alts.every(a=>a&&!/hover/.test(a)),"card alts non-empty");
  ok(alts.some(a=>/（.+）$/.test(a)),"card alt has category: "+alts.slice(0,3).join(" / "));
  const pickAlts=await pg.$$eval(".p-card img.img-primary",i=>i.map(x=>x.alt));
  ok(pickAlts.every(Boolean),"picks alts "+pickAlts.slice(0,2));
  if(vp.width>500){
    // hover to load secondary
    const card=pg.locator("#productsGrid .product-card:has(img.has-secondary)").first();
    if(await card.count()){await card.hover();await pg.waitForTimeout(800);
      const h=await pg.$$eval("#productsGrid img.img-secondary",i=>i.map(x=>x.alt));
      ok(h.every(a=>a===""),"hover alts empty "+JSON.stringify(h));}
  }
  // open lightbox for a multi-photo product
  await pg.locator("#productsGrid .product-card").first().click();
  await pg.waitForSelector("#lightbox.open");await pg.waitForTimeout(800);
  const lb=await pg.getAttribute("#lbImg","alt");
  ok(/商品照片 1$/.test(lb),"lightbox alt "+lb);
  const thumbs=await pg.$$eval(".lb-thumb",t=>t.map(x=>x.alt));
  ok(thumbs.every((a,i)=>a===`第 ${i+1} 張照片`),"thumb alts "+JSON.stringify(thumbs));
  const heroAlt=await pg.getAttribute("#heroPhotoImg","alt");
  ok(heroAlt!==null,"hero alt attr "+heroAlt);
  ok(!errs.length,"no errors "+errs.join("|"));
  await ctx.close();
}
await b.close();ok.done();
