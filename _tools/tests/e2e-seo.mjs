// #12 Google 搜尋說明: field saves/loads, preview follows shared rules, copy clears it, dirty tracking.
import {launch,setup,ORIGIN,checker,SHOTS} from "./lib.mjs";
const ok=checker();
const b=await launch();const ctx=await b.newContext({viewport:{width:1400,height:1000}});
const store=await setup(ctx);
const pg=await ctx.newPage();const errs=[];pg.on("pageerror",e=>errs.push(e.message));
const dialogs=[];pg.on("dialog",d=>{dialogs.push(d.message());d.accept()});
await pg.goto(ORIGIN+"/manage.html");await pg.waitForSelector("#tbody tr[data-id]");
const KEY="sitedata/hsshop-10bd9/products/";
// pick a product that has a description
const id=[...store.keys()].filter(k=>k.startsWith(KEY)&&!k.includes("/gallery")).map(k=>store.get(k)).find(p=>p.desc&&p.desc.length>40).id;
const prod=store.get(KEY+id);
await pg.evaluate(id=>openProductModal(id),id);await pg.waitForSelector("#productModal.open");await pg.waitForTimeout(500);
ok(await pg.inputValue("#pSeoDesc")==="","empty initially");
ok((await pg.textContent("#pSeoCount")).includes("自動產生"),"auto label");
ok((await pg.textContent("#pSeoTitle")).startsWith(prod.name)&&(await pg.textContent("#pSeoTitle")).endsWith("｜信通家俱行"),"title preview "+await pg.textContent("#pSeoTitle"));
ok((await pg.textContent("#pSeoId"))===id,"url shows id");
const auto=await pg.textContent("#pSeoPreview");
ok(auto.length>10,"auto desc preview: "+auto.slice(0,40));
const custom="台灣製鋁合金三層架，寬39公分，防鏽好清潔，適合廚房浴室收納，歡迎到台北大安區門市看實品。";
await pg.fill("#pSeoDesc",custom);
ok((await pg.textContent("#pSeoPreview"))===custom,"preview uses custom text");
ok(/\d+ 字（建議 50–80 字）/.test(await pg.textContent("#pSeoCount")),"count shown "+await pg.textContent("#pSeoCount"));
await pg.fill("#pSeoDesc","字".repeat(100));
ok(await pg.locator("#pSeoCount.over").count()===1,"over-length warning");
ok((await pg.textContent("#pSeoPreview")).endsWith(" …"),"preview truncated like Google");
ok(await pg.evaluate(()=>document.getElementById("pSeoDesc").maxLength)===150,"maxlength 150");
await pg.fill("#pSeoDesc",custom+"  ");
await pg.click("#productSaveBtn");await pg.waitForTimeout(700);
ok(store.get(KEY+id).seoDesc===custom,"saved trimmed");
// reopen shows it; closing without change → no unsaved prompt; changing it → prompt
await pg.evaluate(id=>openProductModal(id),id);await pg.waitForSelector("#productModal.open");await pg.waitForTimeout(500);
ok(await pg.inputValue("#pSeoDesc")===custom,"loads saved");
await pg.fill("#pSeoDesc",custom+"改");dialogs.length=0;
await pg.evaluate(()=>requestCloseProductModal());await pg.waitForTimeout(300);
ok(dialogs.length===1,"dirty tracking includes SEO field");
// copy clears it
await pg.evaluate(id=>openProductModal(id,{copy:true}),id);await pg.waitForSelector("#productModal.open");await pg.waitForTimeout(500);
ok(await pg.inputValue("#pSeoDesc")==="","copy clears SEO text");
ok((await pg.textContent("#pSeoId"))==="商品編號","copy url placeholder");
await pg.evaluate(()=>closeModal("productModal"));
// new product: name typed → title follows live
await pg.evaluate(()=>openProductModal(null));await pg.waitForSelector("#productModal.open");await pg.waitForTimeout(300);
await pg.fill("#pName","測試餐椅");await pg.fill("#pWidth","45");
ok((await pg.textContent("#pSeoTitle")).startsWith("測試餐椅"),"live title");
ok((await pg.textContent("#pSeoPreview")).includes("測試餐椅")&&(await pg.textContent("#pSeoPreview")).includes("45"),"fallback desc uses name+size: "+await pg.textContent("#pSeoPreview"));
await pg.locator(".seo-preview").screenshot({path:`${SHOTS}/seo-preview.png`});
ok(!errs.length,"no errors "+errs);
await b.close();ok.done();
