/* ── 每件商品一個網址：自動產生商品頁、網站地圖、首頁先用的商品資料 ─────────────
   從 Firebase 讀出上架中的商品（跟前台讀的是同一份公開資料），產生：
   - p/<商品編號>.html：每件商品自己的網頁（https://hsintong.cc/p/商品編號）。內容就是首頁＋已經打開的
     那件商品，Google 可以一件一件收錄；分享到 LINE／Facebook 時顯示那件商品的照片、名稱、介紹。
   - c/<分類編號>.html：每個有商品的主分類、子分類一頁（https://hsintong.cc/c/分類編號）。內容是首頁＋選好
     那個分類的商品，「摺疊桌」「藤椅」這類搜尋才有頁面可以排上去。
   - index.html 裡標了 id 的幾個地方：給 Google 看的店家資料（structuredData）、聯繫資訊（contactItems）、
     分類按鈕（categoriesBar、catSidebar）照後台的資料填好，不用等網頁的程式跑完 Google 就讀得到。
     其他地方不動，所以改版型照常直接改 index.html。
   - llms.txt：給 AI 搜尋（ChatGPT、Perplexity…）看的網站簡介、分類、商品清單。
   - sitemap.xml：告訴 Google 有哪些網址、什麼時候更新過。
   - data/site.json：第一次來的客人先用這份資料畫商品，不用等 Firebase（見 index.html 的啟動流程）。
   - fonts/heading-chars.txt：網站標題可能用到的所有字（版型裡的字＋分類、頁面文字、商品名稱），
     _tools/subset-fonts.py 照這份字單把標題字型瘦身成只含這些字的小檔案。
   由 .github/workflows/build-pages.yml 每小時跑一次（index.html 等版型檔案改了也會馬上跑），店家照常在
   後台改商品就好，不用做任何事；網站本身一直是直接讀 Firebase，改了馬上看得到，這裡產生的頁面最晚一小時跟上。
   後台「分類管理」設成隱藏的分類、垃圾桶／封存的商品都不產生頁面，也不放進網站地圖。

   本機測試（不碰正式資料）：FIRESTORE_BASE=http://127.0.0.1:埠號 node _tools/build-pages.mjs --out 輸出資料夾
   需要 Node 20 以上（內建 fetch）；網站根目錄的 package.json（"type": "module"）讓 Node 把 shop-render.js 當成 ES module。 */
import{readFile,writeFile,mkdir,readdir,unlink}from"node:fs/promises";
import{fileURLToPath}from"node:url";
import path from"node:path";
import{SITE_ORIGIN,SITE_NAME,escapeHTML,normalizeProduct,isListedProduct,isSafeProductId,catalogOrderCompare,productInfoHtml,similarProducts,productDescText,productPageTitle,productSearchDesc,photoAlt,clipText,flattenLines,categoryPath,categoryPages,categoryPageTitle,categoryIntro,categoryNavHtml,staticProductCardHtml,contactItemsHtml,storeJsonLd,getSizeSummary,productPath,normalizePhotoUrl,shareImageUrl,activeSalePrice,priceDigits,mainNameOf,subNameOf}from"../shop-render.js";

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const outArg=process.argv.indexOf("--out");
const OUT=outArg>0?path.resolve(process.argv[outArg+1]):ROOT;
const PROJECT="hsshop-10bd9",SITE_DOC="hsshop-10bd9";
const API_KEY="AIzaSyBssTXYLERqDDcuW62MkGxdydPR_hfMBrw"; // 跟 index.html 的 firebaseConfig 同一把公開金鑰
const BASE=(process.env.FIRESTORE_BASE||"https://firestore.googleapis.com").replace(/\/$/,"");
const DOCS=`${BASE}/v1/projects/${PROJECT}/databases/(default)/documents`;
// 首頁先用的資料只放前台用得到的設定欄位
const META_FIELDS=["catalog","contact","pageText","layout","tagDefs","buyInfo"];

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
// JSON 放進 <script> 裡：把 < 換掉，內容裡就算有 </script> 也不會提早結束
const jsonForScript=data=>JSON.stringify(data).replace(/</g,"\\u003c");
// 在版型裡找到剛好一處符合的地方換掉；找不到（index.html 改過了）就停下來，不要產生壞掉的頁面
function replaceOnce(html,pattern,replacement,label){
  const re=pattern instanceof RegExp?pattern:new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"));
  const hits=html.match(new RegExp(re.source,"g"));
  if(!hits||hits.length!==1)throw new Error(`index.html 裡找不到（或不只一處）：${label}`);
  return html.replace(re,typeof replacement==="function"?replacement:()=>replacement);
}
// 麵包屑（Google 搜尋結果網址那一行會顯示成「信通家俱行 › 桌子 › 摺疊桌」）
function breadcrumbs(items){
  return {"@context":"https://schema.org","@type":"BreadcrumbList",
    itemListElement:items.map(([name,item],i)=>({"@type":"ListItem",position:i+1,name,item}))};
}
// 商品、分類的上層分類（有分類頁的才放）
function categoryCrumbs(mainId,subId,catalog,listed){
  const pages=new Set(categoryPages(catalog,listed).map(p=>p.id));
  const out=[];
  if(pages.has(mainId))out.push([mainNameOf(catalog,mainId),`${SITE_ORIGIN}${categoryPath(mainId)}`]);
  if(subId&&pages.has(subId))out.push([subNameOf(catalog,mainId,subId),`${SITE_ORIGIN}${categoryPath(subId)}`]);
  return out;
}
// 商品頁、分類頁的主題是商品／分類，最大的標題（h1）給它們；首頁大圖那行店名改成一般文字
function demoteHeroHeading(html){
  return replaceOnce(html,/<h1 class="hero-title"([^>]*)>([\s\S]*?)<\/h1>/,(_,attrs,inner)=>`<p class="hero-title"${attrs}>${inner}</p>`,"hero <h1>");
}
// 換掉某個 id 的元素裡面的內容（元素本身、其他屬性不動）
function fillById(html,tag,id,inner,label){
  return replaceOnce(html,new RegExp(`(<${tag}\\b[^>]*\\bid="${id}"[^>]*>)[\\s\\S]*?(<\\/${tag}>)`),(_,open,close)=>open+inner+close,label);
}

/* ── 首頁：店家資料、聯繫資訊、分類按鈕直接寫好 ───────────────────── */
function homePage(template,site,listed){
  let html=template;
  html=fillById(html,"script","structuredData",jsonForScript(storeJsonLd(site.contact,{image:shareImageUrl(site.layout?.heroImage||"")||undefined})),"structuredData");
  html=fillById(html,"p","contactItems",contactItemsHtml(site.contact),"contactItems");
  const nav=categoryNavHtml(site.catalog,listed);
  html=fillById(html,"div","categoriesBar",nav.bar,"categoriesBar");
  html=fillById(html,"aside","catSidebar",nav.side,"catSidebar");
  return html;
}

/* ── 分類頁 ─────────────────────────────────────────────────────── */
function categoryPage(home,page,site,listed){
  const url=`${SITE_ORIGIN}${categoryPath(page.id)}`;
  const title=categoryPageTitle(page,site.contact);
  const intro=categoryIntro(page,site.contact);
  const description=clipText(intro,150);
  const cover=page.products.map(p=>(p.photos||[]).filter(isWebUrl)[0]).find(Boolean)||"";
  const image=shareImageUrl(cover)||`${SITE_ORIGIN}/og-image.jpg`;
  const homeTitle=(home.match(/<title>([^<]*)<\/title>/)||[])[1]||SITE_NAME;
  let html=home;
  html=replaceOnce(html,/<title>[^<]*<\/title>/,`<title data-home-title="${escapeHTML(homeTitle)}">${escapeHTML(title)}</title>`,"<title>");
  html=replaceOnce(html,/<meta name="description" content="[^"]*">/,`<meta name="description" content="${escapeHTML(description)}">`,"meta description");
  html=replaceOnce(html,/<meta property="og:title" content="[^"]*">/,`<meta property="og:title" content="${escapeHTML(title)}">`,"og:title");
  html=replaceOnce(html,/<meta property="og:description" content="[^"]*">/,`<meta property="og:description" content="${escapeHTML(description)}">`,"og:description");
  html=replaceOnce(html,/<meta property="og:url" content="[^"]*">/,`<meta property="og:url" content="${escapeHTML(url)}">`,"og:url");
  html=replaceOnce(html,/<meta property="og:image" content="[^"]*">/,`<meta property="og:image" content="${escapeHTML(image)}">`,"og:image");
  html=replaceOnce(html,/<meta property="og:image:alt" content="[^"]*">/,`<meta property="og:image:alt" content="${escapeHTML(title)}">`,"og:image:alt");
  html=replaceOnce(html,/<meta name="twitter:title" content="[^"]*">/,`<meta name="twitter:title" content="${escapeHTML(title)}">`,"twitter:title");
  html=replaceOnce(html,/<meta name="twitter:description" content="[^"]*">/,`<meta name="twitter:description" content="${escapeHTML(description)}">`,"twitter:description");
  html=replaceOnce(html,/<meta name="twitter:image" content="[^"]*">/,`<meta name="twitter:image" content="${escapeHTML(image)}">`,"twitter:image");
  html=replaceOnce(html,/<link rel="canonical" href="[^"]*">/,`<link rel="canonical" href="${escapeHTML(url)}">`,"canonical");
  // 這個分類的商品清單（每件商品頁的網址）＋麵包屑
  const list={"@context":"https://schema.org","@type":"CollectionPage",name:title,url,description,
    mainEntity:{"@type":"ItemList",numberOfItems:page.products.length,
      itemListElement:page.products.map((p,i)=>({"@type":"ListItem",position:i+1,url:`${SITE_ORIGIN}${productPath(p.id)}`,name:String(p.name||"")}))}};
  const crumbs=breadcrumbs([[SITE_NAME,`${SITE_ORIGIN}/`],...categoryCrumbs(page.main,page.sub,site.catalog,listed)]);
  html=replaceOnce(html,"</head>",`<script type="application/ld+json">${jsonForScript(list)}</script>\n<script type="application/ld+json">${jsonForScript(crumbs)}</script>\n</head>`,"</head>");
  // 一進來就是這個分類的商品（本月選品、分類磚先不放，前台換回「全部」才出現）
  html=replaceOnce(html,"<body>",`<body class="cat-landing">`,"<body>");
  html=demoteHeroHeading(html);
  html=replaceOnce(html,/<h2 class="listing-title" id="listingTitle">[^<]*<\/h2>/,`<h1 class="listing-title" id="listingTitle">${escapeHTML(page.name)}</h1>`,"#listingTitle");
  html=replaceOnce(html,/<p class="listing-intro" id="listingIntro" hidden><\/p>/,`<p class="listing-intro" id="listingIntro">${escapeHTML(intro)}</p>`,"#listingIntro");
  const nav=categoryNavHtml(site.catalog,listed,page.main,page.sub);
  html=fillById(html,"div","categoriesBar",nav.bar,"categoriesBar");
  html=fillById(html,"aside","catSidebar",nav.side,"catSidebar");
  html=replaceOnce(html,/<div class="sub-categories-bar" id="subCategoriesBar"><\/div>/,`<div class="sub-categories-bar" id="subCategoriesBar"${nav.sub?' style="display:flex"':""}>${nav.sub}</div>`,"#subCategoriesBar");
  html=replaceOnce(html,/(<div class="products-grid" id="productsGrid">)[\s\S]*?(<\/div>\s*<\/div>\s*<\/section>)/,
    (_,open,close)=>`${open}${page.products.map(p=>staticProductCardHtml(p,site.catalog)).join("")}\n    ${close}`,"#productsGrid");
  return html;
}

/* ── llms.txt：給 AI 搜尋看的網站簡介 ──────────────────────────────── */
function llmsTxt(home,site,listed,pages){
  const desc=(home.match(/<meta name="description" content="([^"]*)">/)||[])[1]||"";
  const c=site.contact||{};
  const decode=t=>String(t).replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&amp;/g,"&");
  const line=t=>String(t||"").replace(/\s+/g," ").trim();
  const out=[`# ${SITE_NAME}`,"",`> ${line(decode(desc))}`,"","## 店家資訊",
    ...[["地址",c.addr],["電話",c.phone],["LINE",c.line&&c.lineUrl?`${c.line}（${c.lineUrl}）`:c.line],["營業時間",c.hours],["信箱",c.email],["Google 地圖",c.mapUrl]]
      .filter(([,v])=>v).map(([k,v])=>`- ${k}：${line(v)}`),
    `- 網站：${SITE_ORIGIN}/`,"","## 商品分類",
    ...pages.map(p=>`- [${p.sub?`${p.mainName} › ${p.name}`:p.name}](${SITE_ORIGIN}${categoryPath(p.id)})：${p.products.length} 款`),
    "","## 商品",
    ...listed.map(p=>{
      const price=priceDigits(activeSalePrice(p)||p.price);
      const bits=[getSizeSummary(p),price?`NT$${Number(price).toLocaleString("en-US")}`:"價格請洽詢"].filter(Boolean);
      return `- [${line(p.name)}](${SITE_ORIGIN}${productPath(p.id)})：${bits.join("，")}`;
    }),""];
  return out.join("\n");
}

function productPage(template,product,site,gallery,listed){
  const id=product.id;
  const url=`${SITE_ORIGIN}${productPath(id)}`;
  const mainName=mainNameOf(site.catalog,product.mainCat),subName=subNameOf(site.catalog,product.mainCat,product.subCat);
  const name=String(product.name||"商品");
  const title=productPageTitle(product,site.catalog);
  const descText=flattenLines(productDescText(product));
  const sale=activeSalePrice(product),priceNumber=priceDigits(sale||product.price);
  const description=productSearchDesc(product,site.catalog);
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
    ...(descText?{description:clipText(descText,500)}:{}),
    sku:String(product.sku||id),
    category:[mainName,subName].filter(Boolean).join(" > "),
    brand:{"@type":"Brand",name:SITE_NAME},
    ...(offers?{offers}:{})};
  const crumbs=breadcrumbs([[SITE_NAME,`${SITE_ORIGIN}/`],
    ...categoryCrumbs(product.mainCat,product.subCat,site.catalog,listed),[name,url]]);
  const head=[
    priceNumber?`<meta property="product:price:amount" content="${priceNumber}">\n<meta property="product:price:currency" content="TWD">`:"",
    `<script type="application/ld+json" id="productData">${jsonForScript(productData)}</script>`,
    `<script type="application/ld+json">${jsonForScript(crumbs)}</script>`
  ].filter(Boolean).join("\n");
  html=replaceOnce(html,"</head>",`${head}\n</head>`,"</head>");
  // 商品頁一開始就是打開的（照片、名稱、價格、尺寸、說明都已經畫好），前台的程式載入後接手
  html=replaceOnce(html,"<body>",`<body class="lightbox-open">`,"<body>");
  html=demoteHeroHeading(html);
  html=replaceOnce(html,/<div id="lightbox" role="dialog" aria-modal="true" aria-label="商品詳細資訊" aria-hidden="true" tabindex="-1">/,
    `<div id="lightbox" class="open" role="dialog" aria-modal="true" aria-label="商品詳細資訊" aria-hidden="false" tabindex="-1" data-prerendered="${escapeHTML(id)}">`,"#lightbox");
  html=replaceOnce(html,`<button class="lb-arrow" id="lbPrev"`,`<button class="lb-arrow" id="lbPrev" style="display:none"`,"#lbPrev");
  html=replaceOnce(html,`<button class="lb-arrow" id="lbNext"`,`<button class="lb-arrow" id="lbNext" style="display:none"`,"#lbNext");
  // 跟前台打開商品時第一張照片用的網址一樣（600 寬），前台接手時不用重新下載
  const coverUrl=(product.photos||[]).filter(Boolean)[0];
  html=replaceOnce(html,`<img id="lbImg" src="" alt="">`,
    `<img id="lbImg" src="${escapeHTML(coverUrl?normalizePhotoUrl(coverUrl,600):"")}" alt="${escapeHTML(photoAlt(product,site.catalog,1))}" fetchpriority="high">`,"#lbImg");
  html=replaceOnce(html,`<div class="lb-info" id="lbInfo"></div>`,
    `<div class="lb-info" id="lbInfo">${productInfoHtml(product,site,{productUrl:url,similar:similarProducts(product,listed,site.catalog)})}</div>`,"#lbInfo");
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

/* ── 標題字型要留哪些字 ────────────────────────────────────────
   版型（index.html、shop-render.js）裡寫死的字，加上後台填的分類、頁面文字、聯繫資訊、購買須知、
   標籤，跟每件商品的名稱。程式註解裡的字不算（只是說明，畫面上不會出現）。多收幾個字沒關係，
   少收的字前台會自動改用完整字型補上。 */
const stripComments=src=>src.replace(/<!--[\s\S]*?-->/g,"").replace(/\/\*[\s\S]*?\*\//g,"").replace(/(^|[^:\\"'`])\/\/[^\n]*/g,"$1");
function headingChars(sources){
  const set=new Set();
  for(let c=0x20;c<0x7f;c++)set.add(String.fromCharCode(c));          // 英數字、半形標點
  for(let c=0x3000;c<=0x303f;c++)set.add(String.fromCharCode(c));     // 中文標點（，。「」…）
  for(let c=0xff01;c<=0xff5e;c++)set.add(String.fromCharCode(c));     // 全形英數字、標點
  for(const ch of "—–…·‧•※○●△▲▼◆★☆→←↑↓×÷±°′″℃％")set.add(ch);
  for(const text of sources)for(const ch of String(text||""))if(ch>" "&&!/\p{Cc}/u.test(ch))set.add(ch);
  return [...set].sort().join("")+"\n";
}
const allStrings=v=>Array.isArray(v)?v.flatMap(allStrings):v&&typeof v==="object"?Object.values(v).flatMap(allStrings):typeof v==="string"?[v]:[];

async function main(){
  const sourceHome=await readFile(path.join(ROOT,"index.html"),"utf8");
  const [meta,rows]=await Promise.all([loadMeta(),loadActiveProducts()]);
  // 一件商品都沒拿到幾乎一定是讀取出了問題：停下來，不要把現有的商品頁全部刪掉
  if(!rows.length)throw new Error("沒有讀到任何上架中的商品，這次不更新");
  const site={catalog:meta.data.catalog||[],tagDefs:meta.data.tagDefs||[],contact:meta.data.contact||{},buyInfo:meta.data.buyInfo||[],layout:meta.data.layout||{}};
  const updated=new Map(rows.map(r=>[r.data.id,r.updateTime]));
  const products=rows.map(r=>normalizeProduct({...r.data}));
  const listed=products.filter(p=>isSafeProductId(p.id)&&isListedProduct(p,site.catalog)).sort(catalogOrderCompare(site.catalog));
  const galleries=await mapLimit(listed,8,p=>(p.photoCount||0)>1?loadGallery(p.id):Promise.resolve([]));

  let changed=0;
  // 首頁先填好（店家資料、聯繫資訊、分類按鈕），商品頁、分類頁都以填好的首頁為底
  const template=homePage(sourceHome,site,listed);
  if(await writeIfChanged(path.join(OUT,"index.html"),template))changed++;
  const pagesDir=path.join(OUT,"p");
  const keep=new Set();
  for(const [i,product] of listed.entries()){
    const file=`${product.id}.html`;
    keep.add(file);
    if(await writeIfChanged(path.join(pagesDir,file),productPage(template,product,site,galleries[i],listed)))changed++;
  }
  // 下架、刪除、移到隱藏分類的商品：頁面拿掉（舊網址會轉回首頁，提示商品已下架）
  let removed=0;
  for(const file of await readdir(pagesDir).catch(()=>[])){
    if(file.endsWith(".html")&&!keep.has(file)){await unlink(path.join(pagesDir,file));removed++}
  }
  // 分類頁：有商品的主分類、子分類各一頁；分類沒了（刪掉、隱藏、商品都下架）頁面就拿掉
  const pages=categoryPages(site.catalog,listed).filter(p=>isSafeProductId(p.id));
  const catDir=path.join(OUT,"c");
  const keepCats=new Set();
  for(const page of pages){
    const file=`${page.id}.html`;
    keepCats.add(file);
    if(await writeIfChanged(path.join(catDir,file),categoryPage(template,page,site,listed)))changed++;
  }
  for(const file of await readdir(catDir).catch(()=>[])){
    if(file.endsWith(".html")&&!keepCats.has(file)){await unlink(path.join(catDir,file));removed++}
  }
  if(await writeIfChanged(path.join(OUT,"llms.txt"),llmsTxt(template,site,listed,pages)))changed++;
  const lastmods=[meta.updateTime,...listed.map(p=>updated.get(p.id))].map(day).filter(Boolean).sort();
  const newest=list=>list.map(p=>day(updated.get(p.id))).filter(Boolean).sort().pop();
  const sitemap=sitemapXml([{loc:`${SITE_ORIGIN}/`,lastmod:lastmods[lastmods.length-1]},
    ...pages.map(page=>({loc:`${SITE_ORIGIN}${categoryPath(page.id)}`,lastmod:newest(page.products)})),
    ...listed.map(p=>({loc:`${SITE_ORIGIN}${productPath(p.id)}`,lastmod:day(updated.get(p.id))}))]);
  if(await writeIfChanged(path.join(OUT,"sitemap.xml"),sitemap))changed++;
  // month：每個月至少會變一次，讓 GitHub 每個月至少有一筆更新——公開的專案 60 天沒有任何更新，
  // GitHub 會自動停掉每小時的排程
  const siteData={v:1,month:new Date().toISOString().slice(0,7),
    meta:Object.fromEntries(META_FIELDS.filter(k=>k in meta.data).map(k=>[k,meta.data[k]])),
    products:rows.map(r=>r.data).sort((a,b)=>String(a.id).localeCompare(String(b.id)))};
  if(await writeIfChanged(path.join(OUT,"data","site.json"),JSON.stringify(sortKeys(siteData))+"\n"))changed++;
  const shopRender=await readFile(path.join(ROOT,"shop-render.js"),"utf8");
  const chars=headingChars([stripComments(sourceHome),stripComments(shopRender),
    ...allStrings(Object.fromEntries(META_FIELDS.map(k=>[k,meta.data[k]]))),...products.map(p=>p.name)]);
  if(await writeIfChanged(path.join(OUT,"fonts","heading-chars.txt"),chars))changed++;
  console.log(`上架中 ${rows.length} 件，產生商品頁 ${listed.length} 件；更新 ${changed} 個檔案，移除 ${removed} 個舊頁面`);
}
main().catch(e=>{console.error(e.message||e);process.exit(1)});
