// Minimal Firestore REST stand-in for _tools/build-pages.mjs, fed from a site.json file (+ optional overrides).
import http from "node:http";
import {readFileSync} from "node:fs";
const [,,siteJson,port="8971",overrides=""]=process.argv;
const site=JSON.parse(readFileSync(siteJson,"utf8"));
if(overrides)Object.entries(JSON.parse(readFileSync(overrides,"utf8"))).forEach(([id,patch])=>Object.assign(site.products.find(p=>p.id===id),patch));
const toValue=v=>v===null||v===undefined?{nullValue:null}:Array.isArray(v)?{arrayValue:{values:v.map(toValue)}}:typeof v==="object"?{mapValue:{fields:toFields(v)}}:typeof v==="number"?(Number.isInteger(v)?{integerValue:String(v)}:{doubleValue:v}):typeof v==="boolean"?{booleanValue:v}:{stringValue:String(v)};
const toFields=o=>Object.fromEntries(Object.entries(o).map(([k,v])=>[k,toValue(v)]));
const T="2026-10-01T00:00:00Z";
http.createServer((req,res)=>{
  const send=(code,body)=>{res.writeHead(code,{"content-type":"application/json"});res.end(JSON.stringify(body))};
  if(req.url.includes(":runQuery"))return send(200,site.products.filter(p=>p.status==="active").map(p=>({document:{fields:toFields(p),updateTime:T}})));
  if(req.url.includes("/gallery/"))return send(404,{});
  if(/sitedata\/hsshop-10bd9(\?|$)/.test(req.url))return send(200,{fields:toFields(site.meta),updateTime:T});
  send(404,{});
}).listen(Number(port),()=>console.log("fake firestore on",port));
