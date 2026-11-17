// Broad regression over the admin: every menu opens, product edit saves, bulk + filters + CSV export work, no JS errors.
import {launch,setup,ORIGIN,checker,dbStats} from "./lib.mjs";
const ok=checker();
const b=await launch();const ctx=await b.newContext({viewport:{width:1400,height:900},acceptDownloads:true});
const store=await setup(ctx);
const pg=await ctx.newPage();const errs=[];
pg.on("pageerror",e=>errs.push(e.message));pg.on("console",m=>{if(m.type()==="error")errs.push(m.text())});
pg.on("dialog",d=>d.accept());
await pg.goto(ORIGIN+"/manage.html");
await pg.waitForSelector("#tbody tr[data-id]");
const rows=()=>pg.locator("#tbody tr[data-id]").count();
ok(await rows()===59,"59 rows");
const openCount=()=>pg.locator(".modal-overlay.open").count();
for(const [menu,label,id] of [["settingsDropdown","分類管理","catMgrModal"],["settingsDropdown","標籤管理","tagMgrModal"],["settingsDropdown","聯繫資訊","contactModal"],["settingsDropdown","頁面文字","pageTextModal"],["settingsDropdown","購買須知","buyInfoModal"],["settingsDropdown","首頁版面","layoutModal"],["toolsDropdown","詢價熱度","heatModal"]]){
  await pg.click(`#${menu} > button`);
  await pg.click(`#${menu} .dropdown-menu button:has-text("${label}")`);
  await pg.waitForTimeout(300);
  ok(await pg.locator(`#${id}.open`).count()===1,`${label} opens`);
  await pg.keyboard.press("Escape");await pg.waitForTimeout(250);
  if(await openCount()){await pg.evaluate(id=>closeModal(id),id)}
}
// filters/search
await pg.click('[data-filter="noSize"]');ok(await rows()===11,"noSize filter 11");
await pg.click('[data-filter="all"]');
await pg.fill("#searchBox","鋁架");ok(await rows()>0&&await rows()<59,"search narrows");
await pg.fill("#searchBox","");
// edit product
const id=await pg.locator("#tbody tr[data-id]").first().getAttribute("data-id");
await pg.evaluate(id=>openProductModal(id),id);
await pg.waitForSelector("#productModal.open");await pg.waitForTimeout(500);
await pg.fill("#pName","測試改名商品");
await pg.click("#productSaveBtn");await pg.waitForTimeout(800);
ok(store.get(`sitedata/hsshop-10bd9/products/${id}`).name==="測試改名商品","product saved to store");
ok(await pg.locator("#productModal.open").count()===0,"modal closed after save");
// new product
await pg.evaluate(()=>openProductModal(null));await pg.waitForSelector("#productModal.open");await pg.waitForTimeout(300);
await pg.fill("#pName","全新測試商品");await pg.fill("#pPrice","1234");
await pg.click("#productSaveBtn");await pg.waitForTimeout(800);
ok([...store.values()].some(v=>v&&v.name==="全新測試商品"),"new product stored");
ok(await rows()===60,"60 rows");
// bulk archive one
await pg.evaluate(()=>toggleQuickCatMode(true));
await pg.locator("#tbody tr[data-id] .qc-cell input").first().check();
await pg.selectOption("#bulkAction","archive");
await pg.click('#quickCatBar button:has-text("套用")');await pg.waitForTimeout(600);
ok(await pg.textContent("#fc-archived").then(t=>t.trim())==="1","archived count 1");
await pg.evaluate(()=>toggleQuickCatMode(false));
// CSV export
const [dl]=await Promise.all([pg.waitForEvent("download"),pg.evaluate(()=>exportProductsCSV())]);
{const fs=await import("node:fs");const t=fs.readFileSync(await dl.path(),"utf8");ok(t.split("\n").length>=60&&t.includes("測試改名商品"),"csv content "+t.split("\n").length);}
// drag-mode sort sync button
await pg.click("#syncBtn");await pg.waitForTimeout(600);
ok(errs.length===0,"no js errors: "+errs.join(" | "));
await b.close();ok.done();
