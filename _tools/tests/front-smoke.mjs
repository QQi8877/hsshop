import {launch,setup,ORIGIN,checker,ROOT} from "./lib.mjs";
import {readdirSync} from "node:fs";
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
await b.close();ok.done();
