// Two tabs editing the same data: stale full-saves must ask; field-only writes must not clobber.
import {launch,setup,ORIGIN,checker} from "./lib.mjs";
const ok=checker();
const b=await launch();const ctx=await b.newContext({viewport:{width:1400,height:900}});
const store=await setup(ctx);
const P=id=>store.get(`sitedata/hsshop-10bd9/products/${id}`);
async function open(){
  const pg=await ctx.newPage();pg.errs=[];pg.dialogs=[];pg.answer=true;
  pg.on("pageerror",e=>pg.errs.push(e.message));
  pg.queue=[];pg.on("dialog",d=>{pg.dialogs.push(d.message());const a=pg.queue.length?pg.queue.shift():pg.answer;a?d.accept():d.dismiss()});
  await pg.goto(ORIGIN+"/manage.html");await pg.waitForSelector("#tbody tr[data-id]");
  return pg;
}
async function editName(pg,id,name){
  await pg.evaluate(id=>openProductModal(id),id);await pg.waitForSelector("#productModal.open");await pg.waitForTimeout(400);
  await pg.fill("#pName",name);await pg.click("#productSaveBtn");await pg.waitForTimeout(700);
}
const A=await open(),B=await open();
const ids=await A.$$eval("#tbody tr[data-id]",t=>t.map(r=>r.dataset.id));
const [x,y]=ids;
// plain save, no other tab involved → no question, stamped
await editName(A,x,"A第一次");
ok(A.dialogs.length===0,"no prompt without conflict");
ok(typeof P(x).updatedAt==="number","updatedAt stamped");
// B (stale) edits same product → asked; cancel keeps A's version and modal open
B.answer=false;await editName(B,x,"B過期版本");
ok(B.dialogs.length===1&&B.dialogs[0].includes("A第一次")===false&&B.dialogs[0].includes("別的裝置"),"B asked: "+B.dialogs[0]);
ok(P(x).name==="A第一次","cancel keeps A version");
ok(await B.locator("#productModal.open").count()===1,"B modal stays open after cancel");
ok((await B.textContent("#toast")).includes("重新整理"),"B told to reload");
// B confirms → overwrites
B.answer=true;B.dialogs=[];await B.click("#productSaveBtn");await B.waitForTimeout(700);
ok(B.dialogs.length===1&&P(x).name==="B過期版本","confirm overwrites");
ok(await B.locator("#productModal.open").count()===0,"B modal closed");
// B saves again immediately → own write is not a conflict
B.dialogs=[];await editName(B,x,"B第二次");ok(B.dialogs.length===0&&P(x).name==="B第二次","own consecutive saves no prompt");
// A (now stale on x) applies sort order → only sortOrder written, B's name survives, no prompt
A.dialogs=[];
await A.evaluate(()=>syncOrderToFrontend());await A.waitForTimeout(700);
ok(A.dialogs.length===1&&A.dialogs[0].includes("重新排列前台"),"sync asks only its own confirm");
ok(P(x).name==="B第二次","sort sync didn't clobber B's name");
// bulk action via saveProductsChange on stale product → asked; cancel = no write, memory rolled back
await editName(B,y,"B改y");
A.queue=[true,false];A.dialogs=[];
await A.evaluate(()=>toggleQuickCatMode(true));
await A.locator(`#tbody tr[data-id="${y}"] .qc-cell input`).check();
await A.selectOption("#bulkAction","archive");
await A.click('#quickCatBar button:has-text("套用")');await A.waitForTimeout(700);
ok(A.dialogs.some(d=>d.includes("別的裝置")),"bulk archive asked "+JSON.stringify(A.dialogs));
ok(P(y).status==="active"&&P(y).name==="B改y","bulk cancel: nothing written");
ok(await A.evaluate(()=>document.getElementById("fc-archived").textContent.trim())==="0","bulk cancel: memory rolled back");
await A.evaluate(()=>toggleQuickCatMode(false));
// site settings: B saves contact, stale A saves page text → asked
B.answer=true;
await B.evaluate(()=>openContactManage());await B.waitForTimeout(300);
await B.evaluate(()=>saveContactManage());await B.waitForTimeout(600);
const metaStamp=store.get("sitedata/hsshop-10bd9").updatedAt;
ok(typeof metaStamp==="number","meta stamped");
A.answer=false;A.dialogs=[];
await A.evaluate(()=>openPageTextManage());await A.waitForTimeout(300);
await A.evaluate(()=>savePageTextManage());await A.waitForTimeout(600);
ok(A.dialogs.some(d=>d.includes("網站設定")),"meta conflict asked");
ok(store.get("sitedata/hsshop-10bd9").updatedAt===metaStamp,"meta cancel: not written");
ok(!A.errs.length&&!B.errs.length,"no js errors "+A.errs+B.errs);
await b.close();ok.done();
