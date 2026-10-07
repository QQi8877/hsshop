/* ── 每件商品一個網址：自動產生商品頁、網站地圖、首頁先用的商品資料 ─────────────
   從 Firebase 讀出上架中的商品（跟前台讀的是同一份公開資料），產生：
   - p/<商品編號>.html：每件商品自己的網頁（https://hsintong.cc/p/商品編號）。內容就是首頁＋已經打開的
     那件商品，Google 可以一件一件收錄；分享到 LINE／Facebook 時顯示那件商品的照片、名稱、介紹。
   - sitemap.xml：告訴 Google 有哪些網址、什麼時候更新過。
   - data/site.json：第一次來的客人先用這份資料畫商品，不用等 Firebase（見 index.html 的啟動流程）。
   由 .github/workflows/build-pages.yml 每小時跑一次（index.html 等版型檔案改了也會馬上跑），店家照常在
   後台改商品就好，不用做任何事；網站本身一直是直接讀 Firebase，改了馬上看得到，這裡產生的頁面最晚一小時跟上。
   後台「分類管理」設成隱藏的分類、垃圾桶／封存的商品都不產生頁面，也不放進網站地圖。

   本機測試（不碰正式資料）：FIRESTORE_BASE=http://127.0.0.1:埠號 node _tools/build-pages.mjs --out 輸出資料夾
   需要 Node 20 以上（內建 fetch）；網站根目錄的 package.json（"type": "module"）讓 Node 把 shop-render.js 當成 ES module。 */
import{readFile,writeFile,mkdir,readdir,unlink}from"node:fs/promises";
import{fileURLToPath}from"node:url";
import path from"node:path";
import{SITE_ORIGIN,SITE_NAME,escapeHTML,normalizeProduct,isListedProduct,isSafeProductId,catalogOrderCompare,productInfoHtml,productDescText,productPath,normalizePhotoUrl,shareImageUrl,activeSalePrice,priceDigits,mainNameOf,subNameOf,getSizeSummary}from"../shop-render.js";

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const outArg=process.argv.indexOf("--out");
const OUT=outArg>0?path.resolve(process.argv[outArg+1]):ROOT;
const PROJECT="hsshop-10bd9",SITE_DOC="hsshop-10bd9";
const API_KEY="AIzaSyBssTXYLERqDDcuW62MkGxdydPR_hfMBrw"; // 跟 index.html 的 firebaseConfig 同一把公開金鑰
const BASE=(process.env.FIRESTORE_BASE||"https://firestore.googleapis.com").replace(/\/$/,"");
const DOCS=`${BASE}/v1/projects/${PROJECT}/databases/(default)/documents`;
// 首頁先用的資料只放前台用得到的設定欄位
const META_FIELDS=["catalog","contact","pageText","layout","tagDefs"];

/* ── 讀 Firebase（REST，不用登入，讀的是本來就公開的資料）─────────── */
const withKey=url=>`${url}${url.includes("?")?"&":"?"}key=${API_KEY}`;
// 讀公開資料本來不用金鑰，先不帶；被拒絕（401／403）才改帶網站的公開金鑰再試一次
let useKey=false;
async function request(url,init={}){
  let lastError;
  for(let attempt=1;attempt<=3;attempt++){
    try{
      const res=await fetch(useKey?withKey(url):url,{...init,signal:AbortSignal.timeout(30000)});
      if(res.status===404)return null;
      if((res.status===401||res.status===403)&&!useKey){useKey=true;attempt--;continue}
      if(!res.ok)throw new Error(`${res.status} ${res.statusText}：${(await res.text()).slice(0,300)}`);
      return await res.json();
    }catch(e){
      lastError=e;
      if(attempt<3)await new Promise(r=>setTimeout(r,attempt*4000));
    }
  }
  throw new Error(`讀取 Firebase 失敗（${url}）：${lastError.message}`);
}
// Firestore REST 的欄位格式（{stringValue:"…"}、{mapValue:{fields:…}}…）→ 一般的 JavaScript 值
function fromValue(v){
  if(!v||typeof v!=="object")return null;
  if("stringValue" in v)return v.stringValue;
  if("integerValue" in v)return Number(v.integerValue);
  if("doubleValue" in v)return Number(v.doubleValue);
  if("booleanValue" in v)return v.booleanValue;
  if("nullValue" in v)return null;
  if("timestampValue" in v)return v.timestampValue;
  if("mapValue" in v)return fromFields(v.mapValue.fields);
  if("arrayValue" in v)return (v.arrayValue.values||[]).map(fromValue);
  if("referenceValue" in v)return v.referenceValue;
  if("geoPointValue" in v)return v.geoPointValue;
  if("bytesValue" in v)return v.bytesValue;
  return null;
}
function fromFields(fields){
  const out={};
  for(const [k,v] of Object.entries(fields||{}))out[k]=fromValue(v);
  return out;
}
async function loadMeta(){
  const doc=await request(`${DOCS}/sitedata/${SITE_DOC}`);
  if(!doc)throw new Error("找不到網站設定文件");
  return {data:fromFields(doc.fields),updateTime:doc.updateTime};
}
// 跟前台一樣只拿 status=="active" 的商品
async function loadActiveProducts(){
  const rows=await request(`${DOCS}/sitedata/${SITE_DOC}:runQuery`,{
    method:"POST",
    headers:{"content-type":"application/json"},
    body:JSON.stringify({structuredQuery:{from:[{collectionId:"products"}],where:{fieldFilter:{field:{fieldPath:"status"},op:"EQUAL",value:{stringValue:"active"}}}}})
  });
  if(!Array.isArray(rows))throw new Error("商品清單格式不對");
  return rows.filter(r=>r.document).map(r=>({data:fromFields(r.document.fields),updateTime:r.document.updateTime}));
}
// 商品的全部照片（商品文件本身只存封面）
async function loadGallery(id){
  const doc=await request(`${DOCS}/sitedata/${SITE_DOC}/products/${encodeURIComponent(id)}/gallery/full`);
  const photos=doc?fromFields(doc.fields).photos:null;
  return Array.isArray(photos)?photos.filter(p=>typeof p==="string"&&p):[];
}
async function mapLimit(items,limit,fn){
  const out=new Array(items.length);
  let next=0;
  await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{
    while(next<items.length){const i=next++;out[i]=await fn(items[i],i)}
  }));
  return out;
}

/* ── 商品頁 ─────────────────────────────────────────────────────── */
const isWebUrl=url=>/^https?:\/\//i.test(url||"");
function clip(text,max){
  const chars=[...String(text||"")];
  return chars.length>max?chars.slice(0,max-1).join("").trimEnd()+"…":chars.join("");
}
// JSON 放進 <script> 裡：把 < 換掉，內容裡就算有 </script> 也不會提早結束
const jsonForScript=data=>JSON.stringify(data).replace(/</g,"\\u003c");
// 在版型裡找到剛好一處符合的地方換掉；找不到（index.html 改過了）就停下來，不要產生壞掉的頁面
function replaceOnce(html,pattern,replacement,label){
  const re=pattern instanceof RegExp?pattern:new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"));
  const hits=html.match(new RegExp(re.source,"g"));
  if(!hits||hits.length!==1)throw new Error(`index.html 裡找不到（或不只一處）：${label}`);
  return html.replace(re,()=>replacement);
}
// 說明的每一行（清單的每一項）接成一段：行尾沒有標點的補一個逗號
function flatten(text){
  return String(text||"").split(/\n+/).map(t=>t.replace(/\s+/g," ").trim()).filter(Boolean)
    .reduce((acc,line)=>acc+(acc&&!/[。！？；，、：.!?,;:]$/.test(acc)?"，":"")+line,"");
}
function productPage(template,product,site,gallery){
  const id=product.id;
  const url=`${SITE_ORIGIN}${productPath(id)}`;
  const mainName=mainNameOf(site.catalog,product.mainCat),subName=subNameOf(site.catalog,product.mainCat,product.subCat);
  const name=String(product.name||"商品");
  const catLabel=subName||mainName;
  const title=`${name}${catLabel&&!name.includes(catLabel)?`｜${catLabel}`:""}｜${SITE_NAME}`;
  const descText=flatten(productDescText(product));
  const sale=activeSalePrice(product),priceNumber=priceDigits(sale||product.price);
  const description=clip(descText||`${catLabel?`${catLabel}：`:""}${name}，${getSizeSummary(product)}。台北市大安區文昌街信通家俱行，歡迎 LINE 詢問。`,150);
  const photos=(gallery.length?gallery:(product.photos||[])).filter(isWebUrl);
  const cover=photos[0]||"";
  const image=shareImageUrl(cover)||`${SITE_ORIGIN}/og-image.jpg`;
  const homeTitle=(template.match(/<title>([^<]*)<\/title>/)||[])[1]||SITE_NAME;
  let html=template;
  html=replaceOnce(html,/<title>[^<]*<\/title>/,`<title data-home-title="${escapeHTML(homeTitle)}">${escapeHTML(title)}</title>`,"<title>");
  html=replaceOnce(html,/<meta name="description" content="[^"]*">/,`<meta name="description" content="${escapeHTML(description)}">`,"meta description");
  html=replaceOnce(html,/<meta property="og:type" content="[^"]*">/,`<meta property="og:type" content="product">`,"og:type");
  html=replaceOnce(html,/<meta property="og:title" content="[^"]*">/,`<meta property="og:title" content="${escapeHTML(title)}">`,"og:title");
  html=replaceOnce(html,/<meta property="og:description" content="[^"]*">/,`<meta property="og:description" content="${escapeHTML(description)}">`,"og:description");
  html=replaceOnce(html,/<meta property="og:url" content="[^"]*">/,`<meta property="og:url" content="${escapeHTML(url)}">`,"og:url");
  html=replaceOnce(html,/<meta property="og:image" content="[^"]*">/,`<meta property="og:image" content="${escapeHTML(image)}">`,"og:image");
  html=replaceOnce(html,/<meta property="og:image:alt" content="[^"]*">/,`<meta property="og:image:alt" content="${escapeHTML(name)}">`,"og:image:alt");
  html=replaceOnce(html,/<meta name="twitter:title" content="[^"]*">/,`<meta name="twitter:title" content="${escapeHTML(title)}">`,"twitter:title");
  html=replaceOnce(html,/<meta name="twitter:description" content="[^"]*">/,`<meta name="twitter:description" content="${escapeHTML(description)}">`,"twitter:description");
  html=replaceOnce(html,/<meta name="twitter:image" content="[^"]*">/,`<meta name="twitter:image" content="${escapeHTML(image)}">`,"twitter:image");
  html=replaceOnce(html,/<link rel="canonical" href="[^"]*">/,`<link rel="canonical" href="${escapeHTML(url)}">`,"canonical");
  // 給 Google 看的商品資料（價格、照片、分類），搜尋結果可以直接顯示價格
  const offers=priceNumber?{"@type":"Offer",url,priceCurrency:"TWD",price:priceNumber,
    availability:(product.badges||[]).includes("preorder")?"https://schema.org/PreOrder":"https://schema.org/InStock",
    itemCondition:"https://schema.org/NewCondition",
    ...(sale&&product.saleEnd?{priceValidUntil:product.saleEnd}:{}),
    seller:{"@type":"Organization",name:SITE_NAME}}:undefined;
  const productData={"@context":"https://schema.org","@type":"Product",name,url,
    ...(photos.length?{image:photos.slice(0,6).map(p=>normalizePhotoUrl(p))}:{}),
    ...(descText?{description:clip(descText,500)}:{}),
    sku:String(product.sku||id),
    category:[mainName,subName].filter(Boolean).join(" > "),
    brand:{"@type":"Brand",name:SITE_NAME},
    ...(offers?{offers}:{})};
  const crumbs={"@context":"https://schema.org","@type":"BreadcrumbList",itemListElement:[
    {"@type":"ListItem",position:1,name:SITE_NAME,item:`${SITE_ORIGIN}/`},
    {"@type":"ListItem",position:2,name,item:url}]};
  const head=[
    priceNumber?`<meta property="product:price:amount" content="${priceNumber}">\n<meta property="product:price:currency" content="TWD">`:"",
    `<script type="application/ld+json" id="productData">${jsonForScript(productData)}</script>`,
    `<script type="application/ld+json">${jsonForScript(crumbs)}</script>`
  ].filter(Boolean).join("\n");
  html=replaceOnce(html,"</head>",`${head}\n</head>`,"</head>");
  // 商品頁一開始就是打開的（照片、名稱、價格、尺寸、說明都已經畫好），前台的程式載入後接手
  html=replaceOnce(html,"<body>",`<body class="lightbox-open">`,"<body>");
  html=replaceOnce(html,/<div id="lightbox" role="dialog" aria-modal="true" aria-label="商品詳細資訊" aria-hidden="true" tabindex="-1">/,
    `<div id="lightbox" class="open" role="dialog" aria-modal="true" aria-label="商品詳細資訊" aria-hidden="false" tabindex="-1" data-prerendered="${escapeHTML(id)}">`,"#lightbox");
  html=replaceOnce(html,`<button class="lb-arrow" id="lbPrev"`,`<button class="lb-arrow" id="lbPrev" style="display:none"`,"#lbPrev");
  html=replaceOnce(html,`<button class="lb-arrow" id="lbNext"`,`<button class="lb-arrow" id="lbNext" style="display:none"`,"#lbNext");
  // 跟前台打開商品時第一張照片用的網址一樣（600 寬），前台接手時不用重新下載
  const coverUrl=(product.photos||[]).filter(Boolean)[0];
  html=replaceOnce(html,`<img id="lbImg" src="" alt="">`,
    `<img id="lbImg" src="${escapeHTML(coverUrl?normalizePhotoUrl(coverUrl,600):"")}" alt="${escapeHTML(`${name} 商品照片 1`)}" fetchpriority="high">`,"#lbImg");
  html=replaceOnce(html,`<div class="lb-info" id="lbInfo"></div>`,
    `<div class="lb-info" id="lbInfo">${productInfoHtml(product,site,{productUrl:url})}</div>`,"#lbInfo");
  return html;
}

/* ── 網站地圖 ───────────────────────────────────────────────────── */
const day=t=>String(t||"").slice(0,10);
function sitemapXml(entries){
  const urls=entries.map(e=>`  <url>\n    <loc>${escapeHTML(e.loc)}</loc>${e.lastmod?`\n    <lastmod>${e.lastmod}</lastmod>`:""}\n  </url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}
// 欄位照字母排好再存：資料沒變，檔案就一模一樣，不會每小時多一筆沒意義的更新
function sortKeys(v){
  if(Array.isArray(v))return v.map(sortKeys);
  if(v&&typeof v==="object")return Object.fromEntries(Object.keys(v).sort().map(k=>[k,sortKeys(v[k])]));
  return v;
}
async function writeIfChanged(file,content){
  const prev=await readFile(file,"utf8").catch(()=>null);
  if(prev===content)return false;
  await mkdir(path.dirname(file),{recursive:true});
  await writeFile(file,content);
  return true;
}

async function main(){
  const template=await readFile(path.join(ROOT,"index.html"),"utf8");
  const [meta,rows]=await Promise.all([loadMeta(),loadActiveProducts()]);
  // 一件商品都沒拿到幾乎一定是讀取出了問題：停下來，不要把現有的商品頁全部刪掉
  if(!rows.length)throw new Error("沒有讀到任何上架中的商品，這次不更新");
  const site={catalog:meta.data.catalog||[],tagDefs:meta.data.tagDefs||[],contact:meta.data.contact||{}};
  const updated=new Map(rows.map(r=>[r.data.id,r.updateTime]));
  const products=rows.map(r=>normalizeProduct({...r.data}));
  const listed=products.filter(p=>isSafeProductId(p.id)&&isListedProduct(p,site.catalog)).sort(catalogOrderCompare(site.catalog));
  const galleries=await mapLimit(listed,8,p=>(p.photoCount||0)>1?loadGallery(p.id):Promise.resolve([]));

  let changed=0;
  const pagesDir=path.join(OUT,"p");
  const keep=new Set();
  for(const [i,product] of listed.entries()){
    const file=`${product.id}.html`;
    keep.add(file);
    if(await writeIfChanged(path.join(pagesDir,file),productPage(template,product,site,galleries[i])))changed++;
  }
  // 下架、刪除、移到隱藏分類的商品：頁面拿掉（舊網址會轉回首頁，提示商品已下架）
  let removed=0;
  for(const file of await readdir(pagesDir).catch(()=>[])){
    if(file.endsWith(".html")&&!keep.has(file)){await unlink(path.join(pagesDir,file));removed++}
  }
  const lastmods=[meta.updateTime,...listed.map(p=>updated.get(p.id))].map(day).filter(Boolean).sort();
  const sitemap=sitemapXml([{loc:`${SITE_ORIGIN}/`,lastmod:lastmods[lastmods.length-1]},
    ...listed.map(p=>({loc:`${SITE_ORIGIN}${productPath(p.id)}`,lastmod:day(updated.get(p.id))}))]);
  if(await writeIfChanged(path.join(OUT,"sitemap.xml"),sitemap))changed++;
  // month：每個月至少會變一次，讓 GitHub 每個月至少有一筆更新——公開的專案 60 天沒有任何更新，
  // GitHub 會自動停掉每小時的排程
  const siteData={v:1,month:new Date().toISOString().slice(0,7),
    meta:Object.fromEntries(META_FIELDS.filter(k=>k in meta.data).map(k=>[k,meta.data[k]])),
    products:rows.map(r=>r.data).sort((a,b)=>String(a.id).localeCompare(String(b.id)))};
  if(await writeIfChanged(path.join(OUT,"data","site.json"),JSON.stringify(sortKeys(siteData))+"\n"))changed++;
  console.log(`上架中 ${rows.length} 件，產生商品頁 ${listed.length} 件；更新 ${changed} 個檔案，移除 ${removed} 個舊頁面`);
}
main().catch(e=>{console.error(e.message||e);process.exit(1)});
