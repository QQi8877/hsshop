import {launch,setup,ORIGIN,checker,ROOT} from "./lib.mjs";
import {readdirSync,readFileSync} from "node:fs";
import path from "node:path";
const ok=checker();
const b=await launch();const ctx=await b.newContext({viewport:{width:1400,height:900}});
await setup(ctx);
for(const url of ["/","/p/"+readdirSync(ROOT+"/p")[0].replace(".html","")]){
  const pg=await ctx.newPage();const errs=[];pg.on("pageerror",e=>errs.push(e.message));pg.on("console",m=>{if(m.type()==="error")errs.push(m.text())});
  await pg.goto(ORIGIN+url);await pg.waitForTimeout(2500);
  ok(await pg.locator("#productsGrid .product-card").count()>0,url+" grid rendered");
  if(url!=="/")ok(await pg.locator("#lightbox.open #lbInfo").count()===1,"product page open");
  ok(!errs.length,url+" no errors "+errs.join("|"));
}
// 重新產生過的首頁 HTML 一打開就是對的（選單「購買須知」、本月選品旁的商品總數），不用等程式跑完才變、
// 不會第一秒看到選單被擠開、「全部 0 件」變成「全部 59 件」。專案裡的 index.html 要等每小時更新才會填好，
// 所以只在測 stage.mjs 做出來的資料夾（有設 ROOT）時檢查
if(process.env.ROOT){
  const html=readFileSync(path.join(ROOT,"index.html"),"utf8");
  const site=JSON.parse(readFileSync(path.join(ROOT,"data/site.json"),"utf8"));
  const hasBuy=(site.meta.buyInfo||[]).some(i=>String(i?.q||"").trim()&&String(i?.a||"").trim());
  const navHidden=[...html.matchAll(/<li\b[^>]*\bid="(?:navBuyItem|mobileNavBuyItem)"[^>]*>/g)].map(m=>/\shidden\b/.test(m[0]));
  ok(navHidden.length===2&&navHidden.every(h=>h===!hasBuy),"static home page: 購買須知 menu items already "+(hasBuy?"shown":"hidden"));
  const total=readdirSync(path.join(ROOT,"p")).filter(f=>f.endsWith(".html")).length;
  ok(new RegExp(`id="picksTotalCount">${total}<`).test(html),"static home page: product total is already "+total);
}
await b.close();ok.done();
