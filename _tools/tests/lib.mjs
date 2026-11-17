import {readFile} from "node:fs/promises";
import path from "node:path";
import {createRequire} from "node:module";
import {mkdirSync} from "node:fs";
import os from "node:os";
// Playwright：先找專案自己裝的，找不到再用雲端環境預先裝好的那份
function loadPlaywright(){
  for(const base of [import.meta.url,"file:///opt/node-tools/node_modules/"]){try{return createRequire(base)("playwright")}catch(e){}}
  throw new Error("找不到 Playwright：npm i -D playwright（雲端環境已預先裝在 /opt/node-tools）");
}
export const {chromium}=loadPlaywright();
const H=path.dirname(new URL(import.meta.url).pathname);
// ROOT：要測的網站資料夾（預設是這個專案；測「重新產生後的頁面」時指向 stage.mjs 做出來的資料夾）
export const ROOT=process.env.ROOT||path.resolve(H,"../..");
// 截圖存這裡（不放進專案）
export const SHOTS=process.env.SHOTS||path.join(os.tmpdir(),"hsshop-shots");
mkdirSync(SHOTS,{recursive:true});
export const ORIGIN="http://hs.test";
const SITE="sitedata/hsshop-10bd9";
const MIME={".html":"text/html",".js":"text/javascript",".mjs":"text/javascript",".css":"text/css",".json":"application/json",".woff2":"font/woff2",".svg":"image/svg+xml",".jpg":"image/jpeg",".png":"image/png",".xml":"application/xml",".txt":"text/plain"};
const SVG=c=>`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><rect width="800" height="800" fill="#fffaf3"/><rect x="200" y="300" width="400" height="260" fill="${c}"/></svg>`;

export async function seedStore(){
  const site=JSON.parse(await readFile(path.join(ROOT,"data/site.json"),"utf8"));
  const store=new Map();
  store.set(SITE,structuredClone(site.meta));
  for(const p of site.products){
    store.set(`${SITE}/products/${p.id}`,structuredClone(p));
    store.set(`${SITE}/products/${p.id}/gallery/full`,{photos:p.photos.slice(),photoOriginals:[],batchBackup:null});
  }
  return store;
}
export function dbStats(){return stats}
const stats={reads:0,writes:0,log:[]};

function match(d,cons){return cons.every(c=>c.op==="=="?d?.[c.f]===c.v:true)}
export async function setup(context,{store,blockSiteJson=false}={}){
  store=store||await seedStore();
  await context.route("**/*",async route=>{
    const req=route.request();const u=new URL(req.url());
    if(u.hostname==="www.gstatic.com"&&u.pathname.includes("firebasejs")){
      const f=u.pathname.endsWith("firebase-app.js")?"mock-app.js":u.pathname.endsWith("firebase-auth.js")?"mock-auth.js":"mock-fs.js";
      return route.fulfill({contentType:"text/javascript",body:await readFile(path.join(H,f),"utf8"),headers:{"access-control-allow-origin":"*"}});
    }
    if(u.hostname==="res.cloudinary.com"){
      const colors=["#8a6a4a","#5b6746","#4d5d6b","#905229","#696255"];
      const c=colors[[...u.pathname].reduce((a,ch)=>a+ch.charCodeAt(0),0)%colors.length];
      return route.fulfill({contentType:"image/svg+xml",body:SVG(c),headers:{"access-control-allow-origin":"*"}});
    }
    if(u.hostname==="api.cloudinary.com"){
      stats.log.push("cloudinary-upload");
      if(context.__failUpload)return route.fulfill({status:500,body:"fail"});
      return route.fulfill({contentType:"application/json",body:JSON.stringify({secure_url:`https://res.cloudinary.com/oqcmekau/image/upload/v1/test_${Date.now()}_${Math.random().toString(36).slice(2,6)}.jpg`}),headers:{"access-control-allow-origin":"*"}});
    }
    if(u.origin!==ORIGIN)return route.abort();
    if(u.pathname.startsWith("/__db/")){
      const op=u.pathname.slice(6);const body=JSON.parse(req.postData()||"{}");
      let result=null;
      if(op==="get"){stats.reads++;result=store.get(body.path)??null}
      else if(op==="list"){
        const pre=body.path+"/";
        result=[...store].filter(([k,v])=>k.startsWith(pre)&&!k.slice(pre.length).includes("/")&&match(v,body.cons));
        stats.reads+=result.length;
      }else if(op==="set"){
        if(context.__failWrites)return route.fulfill({contentType:"application/json",body:JSON.stringify({error:"simulated write failure"})});
        for(const w of body.writes){
          stats.writes++;stats.log.push("write:"+w.path);
          if(w.data==null)store.delete(w.path);
          else store.set(w.path,w.merge?{...store.get(w.path),...w.data}:w.data);
        }
      }
      return route.fulfill({contentType:"application/json",body:JSON.stringify({result})});
    }
    if(blockSiteJson&&u.pathname.startsWith("/data/site.json"))return route.abort();
    let p=decodeURIComponent(u.pathname);
    if(p.endsWith("/"))p+="index.html";
    if(/^\/[pc]\/[^.]+$/.test(p))p+=".html";
    try{
      const body=await readFile(path.join(ROOT,p));
      return route.fulfill({body,contentType:MIME[path.extname(p)]||"application/octet-stream"});
    }catch{return route.fulfill({status:404,body:"nf"})}
  });
  return store;
}
export async function launch(){return chromium.launch({executablePath:"/opt/pw-browsers/chromium-1194/chrome-linux/chrome",args:["--no-proxy-server"]})}
export function checker(){
  let pass=0,fail=0;const fails=[];
  const ok=(cond,msg)=>{if(cond){pass++;}else{fail++;fails.push(msg);console.log("FAIL:",msg)}};
  ok.done=()=>{console.log(`${pass} passed, ${fail} failed`);if(fail)process.exitCode=1};
  return ok;
}
