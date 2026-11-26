/* ── 每件商品一個網址：自動產生商品頁、網站地圖、首頁先用的商品資料 ─────────────
   從 Firebase 讀出上架中的商品（跟前台讀的是同一份公開資料），產生：
   - p/<商品編號>.html：每件商品自己的網頁（https://hsintong.cc/p/商品編號）。內容就是首頁＋已經打開的
     那件商品，Google 可以一件一件收錄；分享到 LINE／Facebook 時顯示那件商品的照片、名稱、介紹。
   - c/<分類編號>.html：每個有商品的主分類、子分類一頁（https://hsintong.cc/c/分類編號）。內容是首頁＋選好
     那個分類的商品，「摺疊桌」「藤椅」這類搜尋才有頁面可以排上去。
   - index.html 裡標了 id 的幾個地方：給 Google 看的店家資料（structuredData）、聯繫資訊（contactItems、contactActions）、
     分類按鈕（categoriesBar、catSidebar）照後台的資料填好，不用等網頁的程式跑完 Google 就讀得到。
     其他地方不動，所以改版型照常直接改 index.html。
   - llms.txt：給 AI 搜尋（ChatGPT、Perplexity…）看的網站簡介、分類、商品清單。
   - sitemap.xml：告訴 Google 有哪些網址、什麼時候更新過。
   - data/site.json：第一次來的客人先用這份資料畫商品，不用等 Firebase（見 site.js 的「啟動」段落）。
   - fonts/heading-chars.txt：明體用到的字（只有店名、首頁大標、載入中的店名，見下面的 brandText）；
     fonts/site-chars.txt：全站思源黑體可能用到的所有字（版型裡的字、後台填的文字、所有商品資料）。
     _tools/subset-fonts.py 照這兩份字單把字型瘦身成只含這些字的小檔案。
   由 .github/workflows/build-pages.yml 每小時跑一次（index.html 等版型檔案改了也會馬上跑），店家照常在
   後台改商品就好，不用做任何事；網站本身一直是直接讀 Firebase，改了馬上看得到，這裡產生的頁面最晚一小時跟上。
   後台「分類管理」設成隱藏的分類、垃圾桶／封存的商品都不產生頁面，也不放進網站地圖。

   本機測試（不碰正式資料）：FIRESTORE_BASE=http://127.0.0.1:埠號 node _tools/build-pages.mjs --out 輸出資料夾
   需要 Node 20 以上（內建 fetch）；網站根目錄的 package.json（"type": "module"）讓 Node 把 shop-render.js 當成 ES module。 */
import{readFile,writeFile,mkdir,readdir,unlink}from"node:fs/promises";
import{fileURLToPath}from"node:url";
import path from"node:path";
import{buyInfoItems,listingTitleHtml,textHtml,SITE_ORIGIN,SITE_NAME,escapeHTML,normalizeProduct,isListedProduct,isSafeProductId,catalogOrderCompare,productInfoHtml,similarProducts,productDescText,productPageTitle,productSearchDesc,photoAlt,clipText,flattenLines,categoryPath,categoryPages,categoryPageTitle,categoryIntro,categoryNavHtml,staticProductCardHtml,contactItemsHtml,contactActionsHtml,storeJsonLd,getSizeSummary,productPath,normalizePhotoUrl,shareImageUrl,activeSalePrice,priceDigits,mainNameOf,subNameOf}from"../shop-render.js";

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const outArg=process.argv.indexOf("--out");
const OUT=outArg>0?path.resolve(process.argv[outArg+1]):ROOT;
const PROJECT="hsshop-10bd9",SITE_DOC="hsshop-10bd9";
const API_KEY="AIzaSyBssTXYLERqDDcuW62MkGxdydPR_hfMBrw"; // 跟 site.js 的 firebaseConfig 同一把公開金鑰
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
  return retag(html,{attr:["data-page-field","heroTitle"]},"p","首頁大標 heroTitle");
}
/* ── 改版型的工具：只認元素的 id（或某個屬性），不管屬性順序、class 怎麼寫 ──────────
   index.html 的版面可以照常改，只要下面用到的 id 還在（清單見 _docs/ARCHITECTURE.md「產生頁面靠的 id」）。
   找不到、或找到不只一個，就停下來不產生頁面（不會產生壞掉的頁面）。 */
const escRe=t=>String(t).replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
// 找開頭標籤：by 是 {id:"x"}、{attr:["name","value"]} 或 {tag:"body"}；回傳位置、標籤名、屬性
function findTag(html,by,label){
  const re=by.tag?new RegExp(`<(${by.tag})(\\s[^>]*)?>`,"g")
    :new RegExp(`<([a-zA-Z][\\w-]*)(?=[^>]*\\s${escRe(by.id?"id":by.attr[0])}="${escRe(by.id||by.attr[1])}")(\\s[^>]*)>`,"g");
  const hits=[...html.matchAll(re)];
  if(hits.length!==1)throw new Error(`index.html 裡找不到（或不只一處）：${label}`);
  const m=hits[0];
  const attrs=[...(m[2]||"").matchAll(/\s([^\s=>]+)(?:="([^"]*)")?/g)].map(a=>[a[1],a[2]===undefined?true:a[2]]);
  return {tag:m[1],start:m.index,end:m.index+m[0].length,attrs};
}
const tagHtml=(tag,attrs)=>`<${tag}${attrs.map(([k,v])=>v===true?` ${k}`:` ${k}="${v}"`).join("")}>`;
// 改開頭標籤的屬性：值是字串就設定（已有的原地換、沒有的加在最後）、true 是沒有值的屬性、null 是拿掉
function setAttrs(html,by,changes,label){
  const t=findTag(html,by,label);
  let attrs=t.attrs.slice();
  for(const [k,v] of Object.entries(changes)){
    const i=attrs.findIndex(([n])=>n===k);
    if(v===null){if(i>=0)attrs.splice(i,1)}
    else if(i>=0)attrs[i]=[k,v];
    else attrs.push([k,v]);
  }
  return html.slice(0,t.start)+tagHtml(t.tag,attrs)+html.slice(t.end);
}
// 從開頭標籤往後找對應的結尾標籤（裡面有同名的標籤也算得對）
function closeOf(html,t,label){
  const re=new RegExp(`<(/?)${t.tag}\\b[^>]*>`,"g");re.lastIndex=t.end;
  let depth=1,m;
  while((m=re.exec(html))){depth+=m[1]?-1:1;if(!depth)return {start:m.index,end:m.index+m[0].length}}
  throw new Error(`index.html 裡找不到結尾標籤：${label}`);
}
// 換掉元素裡面的內容（元素本身、屬性不動）
function fillById(html,id,inner,label=id){
  const t=findTag(html,{id},label),c=closeOf(html,t,label);
  return html.slice(0,t.end)+inner+html.slice(c.start);
}
// 換標籤名（例如 h2 換成 h1），屬性、內容不動
function retag(html,by,newTag,label){
  const t=findTag(html,by,label),c=closeOf(html,t,label);
  return html.slice(0,t.start)+tagHtml(newTag,t.attrs)+html.slice(t.end,c.start)+`</${newTag}>`+html.slice(c.end);
}
// 換掉某個標籤（例如 <title>）裡面的文字
function fillTag(html,tag,inner){
  const t=findTag(html,{tag},`<${tag}>`),c=closeOf(html,t,`<${tag}>`);
  return html.slice(0,t.end)+inner+html.slice(c.start);
}
// 後台「網站文字」：HTML 上標了 data-page-field="key" 的元素（同一個 key 可以有好幾處，例如導覽列和手機選單）
// 換成後台填的字，沒填就是預設文字（跟前台 site.js 的 applyPageText 一樣），客人一打開就是對的字、不會閃一下
function fillPageText(html,pageText){
  const hits=[...html.matchAll(/<([a-zA-Z][\w-]*)(?=[^>]*\sdata-page-field="([^"]+)")[^>]*>/g)].reverse();
  for(const m of hits){
    const t={tag:m[1],start:m.index,end:m.index+m[0].length},c=closeOf(html,t,`data-page-field="${m[2]}"`);
    html=html.slice(0,t.end)+textHtml(pageText,m[2])+html.slice(c.start);
  }
  return html;
}
// <meta> 的 content：key 是 ["name","description"] 或 ["property","og:title"]
const setMeta=(html,key,content)=>setAttrs(html,{attr:key},{content:escapeHTML(content)},key[1]);

/* ── 首頁：店家資料、聯繫資訊、分類按鈕直接寫好 ───────────────────── */
function homePage(template,site,listed){
  let html=fillPageText(template,site.pageText);
  html=fillById(html,"structuredData",jsonForScript(storeJsonLd(site.contact,{image:shareImageUrl(site.layout?.heroImage||"")||undefined})));
  html=fillById(html,"contactItems",contactItemsHtml(site.contact));
  html=fillById(html,"contactActions",contactActionsHtml(site.contact));
  const nav=categoryNavHtml(site.catalog,listed);
  html=fillById(html,"categoriesBar",nav.bar);
  html=fillById(html,"catSidebar",nav.side);
  // 一打開就是對的，不用等程式跑完才變（不然第一秒會看到選單被擠開、「全部 0 件」變成「全部 59 件」）：
  // 選單的「購買須知」有填問答才顯示（跟 site.js 的 renderBuyInfo 一樣）、本月選品旁的商品總數（跟 renderPicks 一樣）
  const hasBuyInfo=buyInfoItems(site).length>0;
  for(const id of ["navBuyItem","mobileNavBuyItem"])html=setAttrs(html,{id},{hidden:hasBuyInfo?null:true},id);
  html=fillById(html,"picksTotalCount",String(listed.length));
  return html;
}

/* ── 分類頁 ─────────────────────────────────────────────────────── */
function categoryPage(home,page,site,listed){
  const url=`${SITE_ORIGIN}${categoryPath(page.id)}`;
  const title=categoryPageTitle(page,site.contact);
  const intro=categoryIntro(page,site.contact,site.catalog);
  const description=clipText(intro,150);
  const cover=page.products.map(p=>(p.photos||[]).filter(isWebUrl)[0]).find(Boolean)||"";
  const image=shareImageUrl(cover)||`${SITE_ORIGIN}/og-image.jpg`;
  const homeTitle=(home.match(/<title>([^<]*)<\/title>/)||[])[1]||SITE_NAME;
  let html=home;
  html=setAttrs(html,{tag:"title"},{"data-home-title":escapeHTML(homeTitle)},"<title>");
  html=fillTag(html,"title",escapeHTML(title));
  html=setMeta(html,["name","description"],description);
  html=setMeta(html,["property","og:title"],title);
  html=setMeta(html,["property","og:description"],description);
  html=setMeta(html,["property","og:url"],url);
  html=setMeta(html,["property","og:image"],image);
  html=setMeta(html,["property","og:image:alt"],title);
  html=setMeta(html,["name","twitter:title"],title);
  html=setMeta(html,["name","twitter:description"],description);
  html=setMeta(html,["name","twitter:image"],image);
  html=setAttrs(html,{attr:["rel","canonical"]},{href:escapeHTML(url)},"canonical");
  // 這個分類的商品清單（每件商品頁的網址）＋麵包屑
  const list={"@context":"https://schema.org","@type":"CollectionPage",name:title,url,description,
    mainEntity:{"@type":"ItemList",numberOfItems:page.products.length,
      itemListElement:page.products.map((p,i)=>({"@type":"ListItem",position:i+1,url:`${SITE_ORIGIN}${productPath(p.id)}`,name:String(p.name||"")}))}};
  const crumbs=breadcrumbs([[SITE_NAME,`${SITE_ORIGIN}/`],...categoryCrumbs(page.main,page.sub,site.catalog,listed)]);
  html=replaceOnce(html,"</head>",`<script type="application/ld+json">${jsonForScript(list)}</script>\n<script type="application/ld+json">${jsonForScript(crumbs)}</script>\n</head>`,"</head>");
  // 一進來就是這個分類的商品（本月選品、分類磚先不放，前台換回「全部」才出現）
  html=setAttrs(html,{tag:"body"},{class:"cat-landing"},"<body>");
  html=demoteHeroHeading(html);
  html=fillById(retag(html,{id:"listingTitle"},"h1","#listingTitle"),"listingTitle",listingTitleHtml(site.catalog,page.main,page.sub));
  html=fillById(setAttrs(html,{id:"listingIntro"},{hidden:null},"#listingIntro"),"listingIntro",escapeHTML(intro));
  const nav=categoryNavHtml(site.catalog,listed,page.main,page.sub);
  html=fillById(html,"categoriesBar",nav.bar);
  html=fillById(html,"catSidebar",nav.side);
  if(nav.sub)html=setAttrs(html,{id:"subCategoriesBar"},{style:"display:flex"},"#subCategoriesBar");
  html=fillById(html,"subCategoriesBar",nav.sub);
  html=fillById(html,"productsGrid",`${page.products.map(p=>staticProductCardHtml(p,site.catalog)).join("")}\n    `);
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
  html=setAttrs(html,{tag:"title"},{"data-home-title":escapeHTML(homeTitle)},"<title>");
  html=fillTag(html,"title",escapeHTML(title));
  html=setMeta(html,["name","description"],description);
  html=setMeta(html,["property","og:type"],"product");
  html=setMeta(html,["property","og:title"],title);
  html=setMeta(html,["property","og:description"],description);
  html=setMeta(html,["property","og:url"],url);
  html=setMeta(html,["property","og:image"],image);
  html=setMeta(html,["property","og:image:alt"],name);
  html=setMeta(html,["name","twitter:title"],title);
  html=setMeta(html,["name","twitter:description"],description);
  html=setMeta(html,["name","twitter:image"],image);
  html=setAttrs(html,{attr:["rel","canonical"]},{href:escapeHTML(url)},"canonical");
  // 給 Google 看的商品資料（價格、照片、分類），搜尋結果可以直接顯示價格
  const offers=priceNumber?{"@type":"Offer",url,priceCurrency:"TWD",price:priceNumber,
    availability:(product.badges||[]).includes("preorder")?"https://schema.org/PreOrder":"https://schema.org/InStock",
    itemCondition:"https://schema.org/NewCondition",
    ...(sale&&product.saleEnd?{priceValidUntil:product.saleEnd}:{}),
    seller:{"@type":"Organization",name:SITE_NAME}}:undefined;
  // 給 Google 的商品資料：Google 規定一定要有價格（或評論、評分），沒標價的商品放了只會被
  // Search Console 當成錯誤，所以有價格才放。分類不另外寫（Google 不接受「桌子 > 摺疊桌」這種
  // 寫法），交給下面的麵包屑。後台補上價格，下一次自動更新就會出現。
  const productData=offers&&{"@context":"https://schema.org","@type":"Product",name,url,
    ...(photos.length?{image:photos.slice(0,6).map(p=>normalizePhotoUrl(p))}:{}),
    ...(descText?{description:clipText(descText,500)}:{}),
    sku:String(product.sku||id),
    brand:{"@type":"Brand",name:SITE_NAME},
    offers};
  const crumbs=breadcrumbs([[SITE_NAME,`${SITE_ORIGIN}/`],
    ...categoryCrumbs(product.mainCat,product.subCat,site.catalog,listed),[name,url]]);
  const head=[
    priceNumber?`<meta property="product:price:amount" content="${priceNumber}">\n<meta property="product:price:currency" content="TWD">`:"",
    productData?`<script type="application/ld+json" id="productData">${jsonForScript(productData)}</script>`:"",
    `<script type="application/ld+json">${jsonForScript(crumbs)}</script>`
  ].filter(Boolean).join("\n");
  html=replaceOnce(html,"</head>",`${head}\n</head>`,"</head>");
  // 商品頁一開始就是打開的（照片、名稱、價格、尺寸、說明都已經畫好），前台的程式載入後接手
  html=setAttrs(html,{tag:"body"},{class:"lightbox-open"},"<body>");
  html=demoteHeroHeading(html);
  html=setAttrs(html,{id:"lightbox"},{class:"open","aria-hidden":"false","data-prerendered":escapeHTML(id)},"#lightbox");
  html=setAttrs(html,{id:"lbPrev"},{style:"display:none"},"#lbPrev");
  html=setAttrs(html,{id:"lbNext"},{style:"display:none"},"#lbNext");
  // 跟前台打開商品時第一張照片用的網址一樣（600 寬），前台接手時不用重新下載
  const coverUrl=(product.photos||[]).filter(Boolean)[0];
  html=setAttrs(html,{id:"lbImg"},{src:escapeHTML(coverUrl?normalizePhotoUrl(coverUrl,600):""),alt:escapeHTML(photoAlt(product,site.catalog,1)),fetchpriority:"high"},"#lbImg");
  html=fillById(html,"lbInfo",productInfoHtml(product,site,{similar:similarProducts(product,listed,site.catalog)}));
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

/* ── 字型要留哪些字 ────────────────────────────────────────
   全站思源黑體：版型（index.html、shop-render.js、site.js）裡寫死的字，加上後台填的分類、頁面文字、聯繫資訊、
   購買須知、標籤，跟每件商品的所有文字（名稱、說明、規格、款式、交期…）。程式註解裡的字不算（畫面上不會出現）。
   明體：只有店名、首頁大標、載入中的店名用（index.html 的 --font-brand），只收這幾個元素的字＋後台改過的首頁大標，
   檔案只有十幾 KB，打開網頁時很快就下載完（見 index.html 開頭的字型說明）。
   多收幾個字沒關係；少收的字明體會自動改用完整字型補上，黑體會先用裝置內建的字顯示，下一次每小時更新就補進字單。 */
const stripComments=src=>src.replace(/<!--[\s\S]*?-->/g,"").replace(/\/\*[\s\S]*?\*\//g,"").replace(/(^|[^:\\"'`])\/\/[^\n]*/g,"$1");
// 用明體（--font-brand）的元素：跟 index.html 裡 `.nav-logo,.hero-title,.loading-breathe-text{font-family:var(--font-brand)}` 一致
const BRAND_CLASSES=["nav-logo","hero-title","loading-breathe-text"];
function brandText(html){
  const out=[];
  for(const cls of BRAND_CLASSES){
    const re=new RegExp(`<(\\w+)\\b[^>]*\\bclass="(?:[^"]*\\s)?${cls}(?:\\s[^"]*)?"[^>]*>([\\s\\S]*?)</\\1>`,"g");
    for(const m of html.matchAll(re))out.push(m[2].replace(/<[^>]+>/g,""));
  }
  return out.filter(t=>t.trim());
}
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
  const site={catalog:meta.data.catalog||[],tagDefs:meta.data.tagDefs||[],contact:meta.data.contact||{},buyInfo:meta.data.buyInfo||[],layout:meta.data.layout||{},pageText:meta.data.pageText||{}};
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
  const [shopRender,siteJs]=await Promise.all(["shop-render.js","site.js"].map(f=>readFile(path.join(ROOT,f),"utf8")));
  const layoutText=[stripComments(sourceHome),stripComments(shopRender),stripComments(siteJs),
    ...allStrings(Object.fromEntries(META_FIELDS.map(k=>[k,meta.data[k]])))];
  // 明體：店名、首頁大標的字＋後台改過的首頁大標。版型改了、找不到用明體的元素：保險起見照舊收版型＋商品名稱的字
  // （檔案大一點，但店名不會缺字）
  const brand=brandText(stripComments(sourceHome));
  const brandSources=brand.length?[...brand,site.pageText.heroTitle]:[...layoutText,...products.map(p=>p.name)];
  if(await writeIfChanged(path.join(OUT,"fonts","heading-chars.txt"),headingChars(brandSources)))changed++;
  if(await writeIfChanged(path.join(OUT,"fonts","site-chars.txt"),headingChars([...layoutText,...products.flatMap(allStrings)])))changed++;
  console.log(`上架中 ${rows.length} 件，產生商品頁 ${listed.length} 件；更新 ${changed} 個檔案，移除 ${removed} 個舊頁面`);
}
main().catch(e=>{console.error(e.message||e);process.exit(1)});
