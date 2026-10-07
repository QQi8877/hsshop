/* ── 商品顯示規則（前台、後台、自動產生商品頁共用）──────────────────
   前台 index.html、後台 manage.html，還有每小時自動產生「每件商品一個網址」靜態頁的
   _tools/build-pages.mjs 都 import 這個檔案：價格、尺寸、商品說明的過濾、商品頁右側
   那一欄的內容，三邊用同一份規則，畫出來才會一模一樣。
   這個檔案不能用到 document／window／localStorage（Node 也要能直接執行），需要的資料
   （分類、標籤、聯繫資訊…）一律從參數傳進來。
   ⚠ 改了這個檔案，記得把 index.html、manage.html 裡 import 網址的 ?v= 數字加一，
   不然瀏覽器可能還在用快取裡的舊版。 */
import{dimFigureSvg,figureDimsOf,resolveDimFigureKey,autoDimFigureKey,parseDim,findSeatSpecIndex}from"./dim-figures.js?v=3";

export const SITE_ORIGIN="https://hsintong.cc";
export const SITE_NAME="信通家俱行";

export function escapeHTML(str=""){
  return String(str).replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[ch]));
}

/* ── 商品說明的過濾（白名單）─────────────────────────────────────
   商品說明存的是後台編輯器輸出的 HTML。資料庫本身不會檢查內容，所以顯示前一定要過濾。
   原本是「黑名單」（拿掉 script、on 開頭的屬性…），但 HTML 能改變頁面的寫法太多，例如
   <meta http-equiv="refresh"> 不用任何程式就能把整頁轉到別的網站，黑名單永遠擋不完。
   現在改成白名單：只留下後台編輯器做得出來的格式（粗體、斜體、底線、刪除線、文字大小、
   顏色、網底、清單、換行、段落），其他標籤一律拿掉（裡面的文字保留），屬性只留 style，
   style 裡也只留上面那幾種、而且值要長得像顏色／大小才留。
   輸出是重新組出來的，不是把原本的字串挑掉幾段：文字一律跳脫，標籤一定成對、照順序
   關閉，所以就算原本的 HTML 寫得亂七八糟，也不會跑出說明框、影響到頁面其他地方。 */
const RICH_TAGS=new Set(["b","strong","i","em","u","s","strike","del","ins","mark","small","sub","sup","br","hr","p","div","span","ul","ol","li","h3","h4","h5","h6","blockquote"]);
const VOID_TAGS=new Set(["br","hr"]);
// 這些標籤連裡面的內容一起丟掉（程式碼、樣式、內嵌頁面、表單元件、向量圖…）
const DROP_WITH_CONTENT=new Set(["script","style","iframe","frame","frameset","object","embed","applet","template","noscript","noembed","noframes","textarea","title","xmp","plaintext","svg","math","select","head"]);
const COLOR_RE=/^(?:#[0-9a-f]{3,8}|rgba?\(\s*[\d.]+%?\s*(?:,\s*|\s+)[\d.]+%?\s*(?:,\s*|\s+)[\d.]+%?\s*(?:(?:,|\/)\s*[\d.]+%?\s*)?\)|[a-z]{3,20})$/;
const CSS_RULES={
  "color":COLOR_RE,
  "background-color":COLOR_RE,
  "font-size":/^(?:\d{1,3}(?:\.\d{1,3})?(?:px|pt|em|rem|%)|xx-small|x-small|small|medium|large|x-large|xx-large|smaller|larger)$/,
  "font-weight":/^(?:normal|bold|bolder|lighter|[1-9]00)$/,
  "font-style":/^(?:normal|italic|oblique)$/,
  "text-align":/^(?:left|right|center|justify|start|end)$/
};
function decodeEntities(s){
  return s.replace(/&(#\d{1,7}|#x[0-9a-f]{1,6}|quot|apos|amp|lt|gt|nbsp);?/gi,(m,e)=>{
    e=e.toLowerCase();
    if(e[0]==="#"){
      const code=e[1]==="x"?parseInt(e.slice(2),16):parseInt(e.slice(1),10);
      return code>0&&code<0x110000?String.fromCodePoint(code):"";
    }
    return {quot:"\"",apos:"'",amp:"&",lt:"<",gt:">",nbsp:" "}[e];
  });
}
function cleanStyle(value){
  if(!value)return "";
  const v=decodeEntities(value).replace(/\/\*[\s\S]*?\*\//g,"");
  return v.split(";").map(decl=>{
    const k=decl.indexOf(":");
    if(k<0)return "";
    const prop=decl.slice(0,k).trim().toLowerCase();
    const val=decl.slice(k+1).replace(/!\s*important/i,"").trim().toLowerCase();
    // 瀏覽器有時把底線存成「underline solid rgb(…)」：只留線的種類
    if(prop==="text-decoration"||prop==="text-decoration-line"){
      const lines=val.split(/\s+/).filter(t=>t==="underline"||t==="line-through"||t==="overline"||t==="none");
      return lines.length?`text-decoration:${lines.join(" ")}`:"";
    }
    const re=CSS_RULES[prop];
    return re&&re.test(val)?`${prop}:${val}`:"";
  }).filter(Boolean).join(";");
}
function escapeText(t){
  // 已經是合法實體（&amp;、&nbsp;、&#123;）的維持原樣，其他的 & < > 都跳脫
  return t.replace(/\0/g,"").replace(/&(?!(?:#\d{1,7}|#x[0-9a-f]{1,6}|[a-z][a-z0-9]{1,31});)/gi,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}
const TAG_OPEN=/<(\/?)([a-zA-Z][a-zA-Z0-9-]*)/y;
const ATTR_NAME=/[^\s"'>\/=]+/y;
const UNQUOTED=/[^\s>]*/y;
const SPACE=/[\s\/]*/y;
export function sanitizeRichHtml(html){
  const src=String(html??"");
  const n=src.length,stack=[];
  let out="",i=0;
  while(i<n){
    const lt=src.indexOf("<",i);
    if(lt<0){out+=escapeText(src.slice(i));break}
    out+=escapeText(src.slice(i,lt));
    i=lt;
    if(src.startsWith("<!--",i)){const e=src.indexOf("-->",i+4);i=e<0?n:e+3;continue}
    if(src[i+1]==="!"||src[i+1]==="?"){const e=src.indexOf(">",i+2);i=e<0?n:e+1;continue}
    TAG_OPEN.lastIndex=i;
    const m=TAG_OPEN.exec(src);
    if(!m){out+="&lt;";i++;continue}
    const closing=m[1]==="/",name=m[2].toLowerCase();
    // 讀完這個標籤的屬性，直到標籤結尾的 >（引號裡的 > 不算）
    let j=TAG_OPEN.lastIndex;
    const attrs={};
    while(j<n){
      SPACE.lastIndex=j;SPACE.exec(src);j=SPACE.lastIndex;
      if(j>=n||src[j]===">")break;
      ATTR_NAME.lastIndex=j;
      const am=ATTR_NAME.exec(src);
      if(!am){j++;continue}
      const attrName=am[0].toLowerCase();
      j=ATTR_NAME.lastIndex;
      while(j<n&&/\s/.test(src[j]))j++;
      let value="";
      if(src[j]==="="){
        j++;
        while(j<n&&/\s/.test(src[j]))j++;
        const q=src[j];
        if(q==="\""||q==="'"){
          const e=src.indexOf(q,j+1);
          value=src.slice(j+1,e<0?n:e);
          j=e<0?n:e+1;
        }else{
          UNQUOTED.lastIndex=j;
          value=UNQUOTED.exec(src)[0];
          j=UNQUOTED.lastIndex;
        }
      }
      if(!(attrName in attrs))attrs[attrName]=value;
    }
    if(j>=n)break; // 標籤寫到一半就結束（沒有 >）：跟瀏覽器一樣整個不算
    i=j+1;
    if(DROP_WITH_CONTENT.has(name)){
      if(!closing){
        const re=new RegExp(`</${name}(?=[\\s/>])`,"ig");
        re.lastIndex=i;
        const end=re.exec(src);
        if(!end)i=n;
        else{const e=src.indexOf(">",end.index);i=e<0?n:e+1}
      }
      continue;
    }
    if(!RICH_TAGS.has(name))continue; // 不認得的標籤：標籤本身拿掉，裡面的文字留著
    if(closing){
      const k=stack.lastIndexOf(name);
      if(k>=0)while(stack.length>k)out+=`</${stack.pop()}>`;
      continue;
    }
    if(VOID_TAGS.has(name)){out+=`<${name}>`;continue}
    if(stack.length>=40)continue;
    const style=cleanStyle(attrs.style);
    out+=`<${name}${style?` style="${escapeHTML(style)}"`:""}>`;
    stack.push(name);
  }
  while(stack.length)out+=`</${stack.pop()}>`;
  return out;
}
// 說明裡看得到的字都沒有（例如後台刪光後只剩一個 <br>）就當成沒寫，不顯示空白的「商品說明」
export function richTextIsEmpty(html){
  const s=String(html??"");
  if(/<img\b/i.test(s))return false;
  return !s.replace(/<[^>]*>/g,"").replace(/&nbsp;|&#160;|&#xa0;/gi,"").replace(/[\s​﻿]/g,"");
}
// 商品說明 → 可以直接放進畫面的 HTML（純文字的舊說明把換行變成 <br>）
export function productDescHtml(product){
  const raw=richTextIsEmpty(product.desc)?"":String(product.desc);
  return /<[a-z][\s\S]*>/i.test(raw)?sanitizeRichHtml(raw):escapeHTML(raw).replace(/\r\n|\r|\n/g,"<br>");
}
// 商品說明的純文字（給搜尋、Google 的介紹文字用）
export function productDescText(product){
  const html=productDescHtml(product);
  return decodeEntities(html.replace(/<br>|<\/(?:p|div|li|h[3-6]|blockquote)>/g,"\n").replace(/<[^>]*>/g,"")).replace(/[ \t ]+/g," ").replace(/\s*\n\s*/g,"\n").trim();
}

/* ── 商品資料 ───────────────────────────────────────────────────── */
export function normalizeProduct(product){
  product.photos=product.photos||[product.img,product.img2].filter(Boolean);
  if(typeof product.photoCount!=="number")product.photoCount=product.photos.filter(Boolean).length;
  product.dimensions=product.dimensions||{width:"",depth:"",height:""};
  product.specs=Array.isArray(product.specs)?product.specs:[];
  product.status=!product.status||product.status==="active"?"active":product.status; // 封存、垃圾桶都不顯示
  product.badges=Array.isArray(product.badges)?product.badges:[];
  const hasDims=product.dimensions.width||product.dimensions.depth||product.dimensions.height;
  if(!product.specs.length&&product.size&&!hasDims){
    product.specs=[{label:"尺寸備註",value:product.size}];
  }
  return product;
}
export function productPath(id){return `/p/${encodeURIComponent(id)}`}
// 商品網址只用得到英數字、底線、連字號（後台產生的 id 都是這樣）；其他的不產生靜態頁
export const isSafeProductId=id=>/^[A-Za-z0-9_-]{1,64}$/.test(String(id||""));

/* ── 分類 ───────────────────────────────────────────────────────── */
export function mainCatOf(catalog,id){return (catalog||[]).find(c=>c.id===id)}
export function mainNameOf(catalog,id){return id==="全部"?"全部":(mainCatOf(catalog,id)?.name||(id?id:"待分類"))}
export function subNameOf(catalog,mainId,subId){return (mainCatOf(catalog,mainId)?.subs||[]).find(s=>s.id===subId)?.name||""}
// 後台「分類管理」把主分類或子分類設成隱藏：那個分類的商品不出現在任何列表、搜尋、
// 本月選品、分類磚、網站地圖（直接用商品網址打開還是看得到）
export function isListedProduct(product,catalog){
  if(product.status!=="active")return false;
  const main=mainCatOf(catalog,product.mainCat);
  if(main?.hidden)return false;
  if(main&&product.subCat&&(main.subs||[]).find(s=>s.id===product.subCat)?.hidden)return false;
  return true;
}
// 商品排列順序：照後台「分類管理」的分類順序（主分類、再子分類），同一個子分類裡照
// 後台拖曳出來的自訂順序。沒選子分類的排在那個主分類最前面；分類被刪掉的排最後。
// tieBreak：同一個子分類裡的排法（預設照自訂順序 sortOrder）
export function catalogOrderCompare(catalog,{tieBreak=(a,b)=>(a.sortOrder??0)-(b.sortOrder??0)}={}){
  const mainRank=new Map(),subRank=new Map();
  (catalog||[]).forEach((c,i)=>{
    mainRank.set(c.id,i);
    (c.subs||[]).forEach((s,k)=>subRank.set(`${c.id}\u0000${s.id}`,k));
  });
  const subOf=p=>p.subCat?(subRank.has(`${p.mainCat}\u0000${p.subCat}`)?subRank.get(`${p.mainCat}\u0000${p.subCat}`):Infinity):-1;
  return (a,b)=>{
    const ma=mainRank.has(a.mainCat)?mainRank.get(a.mainCat):Infinity,mb=mainRank.has(b.mainCat)?mainRank.get(b.mainCat):Infinity;
    if(ma!==mb)return ma<mb?-1:1;
    if(ma===Infinity&&a.mainCat!==b.mainCat)return String(a.mainCat||"").localeCompare(String(b.mainCat||""));
    const sa=subOf(a),sb=subOf(b);
    if(sa!==sb)return sa<sb?-1:1;
    return tieBreak(a,b);
  };
}

/* ── 照片網址 ───────────────────────────────────────────────────── */
function extractGdriveId(url){
  const patterns=[/\/file\/d\/([a-zA-Z0-9_-]+)/,/[?&]id=([a-zA-Z0-9_-]+)/,/\/d\/([a-zA-Z0-9_-]+)/];
  for(const pattern of patterns){
    const match=String(url).match(pattern);
    if(match)return match[1];
  }
  return null;
}
function convertGdriveUrl(url,width=1600){
  const id=extractGdriveId(url);
  return id?`https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w${width}`:url;
}
// Cloudinary 網址固定長這樣：.../image/upload/（可以插入轉換參數的地方）/v123/xxx.jpg
// f_auto 讓 Cloudinary 依瀏覽器自動選最省流量的圖片格式（例如 WebP/AVIF），
// q_auto 自動抓一個「肉眼看不太出差異、但檔案盡量小」的畫質，
// w_<width> 只送剛好夠用的尺寸，列表縮圖不用每次都下載完整原圖。
function convertCloudinaryUrl(url,width){
  return url.replace(/\/image\/upload\//,`/image/upload/f_auto,q_auto,w_${width}/`);
}
export function normalizePhotoUrl(url,width=1600){
  if(/drive\.google\.com/i.test(url))return convertGdriveUrl(url,width);
  if(/res\.cloudinary\.com/i.test(url))return convertCloudinaryUrl(url,width);
  return url;
}
// LINE、Facebook 分享時的預覽圖：要 1200×630（橫的），商品照片放中間、兩邊補上網站的米白底色。
// 只有 Cloudinary 的照片做得到；其他的（Google Drive、舊的內嵌圖）回傳空字串，改用店家的預覽圖
export function shareImageUrl(url){
  if(!/^https:\/\/res\.cloudinary\.com\/.+\/image\/upload\//i.test(url||""))return "";
  return url.replace(/\/image\/upload\//,"/image/upload/c_pad,w_1200,h_630,b_rgb:fffaf3,f_jpg,q_auto/");
}

/* ── 標籤 ───────────────────────────────────────────────────────── */
export const DEFAULT_TAG_DEFS=[
  {key:"sale",label:"特價促銷",color:"#b84236"},
  {key:"limited",label:"限量",color:"#8c491a"},
  {key:"preorder",label:"預購",color:"#4d5d6b"},
  {key:"new",label:"新品",color:"#5b6746"},
  {key:"bestseller",label:"熱銷",color:"#905229"},
  {key:"multicolor",label:"多色",color:"#201e1d"},
  {key:"custom",label:"可客製化",color:"#696255"},
  {key:"madeintw",label:"台灣製造",color:"#645c50"},
];
export function tagDefsOf(tagDefs){return Array.isArray(tagDefs)&&tagDefs.length?tagDefs:DEFAULT_TAG_DEFS}
// 標籤顏色是後台可以自由選的，深淺不一定，固定用白字可能對比不夠（例如淺色標籤）。
// 這裡依背景色算出相對亮度，太淺就自動改用深色文字，確保不管後台選什麼顏色都看得清楚。
export function tagTextColor(hex){
  const m=/^#?([0-9a-f]{6})$/i.exec((hex||"").trim());
  if(!m)return "#fff";
  const n=parseInt(m[1],16);
  const toLinear=c=>{c/=255;return c<=0.04045?c/12.92:Math.pow((c+0.055)/1.055,2.4)};
  const r=toLinear((n>>16)&255),g=toLinear((n>>8)&255),b=toLinear(n&255);
  const luminance=0.2126*r+0.7152*g+0.0722*b;
  const contrastWithWhite=1.05/(luminance+0.05);
  return contrastWithWhite>=4.5?"#fff":"#201e1d";
}
export function tagBadgeHtml(def){
  return `<span class="tag-badge" style="background:${escapeHTML(def.color)};color:${tagTextColor(def.color)}">${escapeHTML(def.label)}</span>`;
}

/* ── 尺寸、價格的文字 ───────────────────────────────────────────── */
export function withCm(value){
  const text=String(value||"").trim();
  if(!text)return "";
  if(/[a-zA-Z公分吋尺]/.test(text))return text;
  if(/^[\d\s.xX×*~\-–—]+$/.test(text))return `${text} cm`;
  return text;
}
export function getSizeSummary(product){
  const d=product.dimensions||{};
  const parts=[];
  if(d.width)parts.push(`寬 ${withCm(d.width)}`);
  if(d.depth)parts.push(`深 ${withCm(d.depth)}`);
  if(d.height)parts.push(`高 ${withCm(d.height)}`);
  if(!parts.length)return product.size||"尺寸洽詢";
  // "x" 前後用不斷行空格（ ）接起來，手機版窄螢幕換行時才不會斷在
  // "x" 後面、變成下一行開頭孤零零一個 x，讀起來卡卡的。
  return parts.join(" x ").replace(/ cm(?= x )/g,"");
}
// 特價：有填特價、而且沒設結束日或還沒過期（結束日當天整天都算）才生效，過期自動恢復原價
export function activeSalePrice(product,now=new Date()){
  const sale=String(product.salePrice||"").trim();
  if(!sale)return "";
  if(product.saleEnd&&!(new Date(`${product.saleEnd}T23:59:59`)>=now))return "";
  return sale;
}
// 特價結束日："2026-01-05" → "1/5"
export function saleEndText(end){const [,m,d]=String(end).split("-");return `${Number(m)}/${Number(d)}`}
// 純金額（可以已經有 $／NT$、千分位逗號、空格、全形數字或「元」）→ 只留數字；「洽詢」這類文字 → null
export function priceDigits(text){
  const t=String(text??"").replace(/[０-９]/g,c=>String.fromCharCode(c.charCodeAt(0)-0xFEE0)).replace(/[\s,，]/g,"");
  const m=/^(?:NT\$|\$|＄)?(\d+)元?$/i.exec(t);
  return m?m[1].replace(/^0+(?=\d)/,""):null;
}
export function formatPrice(price){
  const text=String(price||"").trim();
  if(!text)return "";
  // 金額一律顯示成「$ 3,200」（自動補 $ 和千分位），其他文字（例如「洽詢」）原樣顯示
  const digits=priceDigits(text);
  return digits!=null?`$ ${digits.replace(/\B(?=(\d{3})+(?!\d))/g,",")}`:text;
}
// 卡片、商品頁顯示的價格（HTML）：特價期間顯示特價＋劃掉的原價
export function priceHtml(product,now=new Date()){
  const sale=activeSalePrice(product,now),base=String(product.price||"").trim();
  if(sale)return `<span class="price-now">${escapeHTML(formatPrice(sale))}</span>${base?`<s class="price-was">${escapeHTML(formatPrice(base))}</s>`:""}`;
  return base?escapeHTML(formatPrice(base)):"";
}

/* ── 商品頁的尺寸區塊 ─────────────────────────────────────────
   後台的寬深高、規格列（椅面、層板…）都是自由輸入的文字，這裡整理成「線稿示意圖＋
   逐列的寬／深／高」：桌子、櫃架、板凳的品名習慣用「尺」，多換算約幾台尺；椅子的
   「椅面」列拿出來變成座高；高度是範圍（例如 81~93）就標「可升降」；完全沒有尺寸
   就改成請洽詢，不再出現三格「—」；有「可客製化」標籤的提醒可以訂做。
   示意圖本身在 dim-figures.js（後台也用同一份），每件商品用哪張圖可以在後台指定。 */
const CM_PER_CHI=30.303; // 1 台尺 = 30.303 公分
function dimCmText(dim){
  const n=v=>String(Math.round(v*10)/10);
  return dim.min===dim.max?n(dim.min):`${n(dim.min)}–${n(dim.max)}`;
}
function dimChiText(dim){
  const chi=cm=>String(Math.round(cm/CM_PER_CHI*10)/10);
  const a=chi(dim.min),b=chi(dim.max);
  return a===b?`約 ${a} 尺`:`約 ${a}–${b} 尺`;
}
function dimRowHtml(label,dim,{chi=false,key=false,adj=""}={}){
  if(!dim)return "";
  const value=dim.text!==undefined?escapeHTML(dim.text)
    :`${dimCmText(dim)}<small>cm</small>${adj&&dim.min!==dim.max?`<span class="lb-dim-adj">${adj}</span>`:""}${chi?`<span class="lb-dim-chi">${dimChiText(dim)}</span>`:""}`;
  return `<div class="lb-dim-row${key?" key":""}"><span class="lb-dim-k">${label}</span><span class="lb-dim-v">${value}</span></div>`;
}
// 規格列（層板、椅面的寬深…）變成一行補充說明，例如「層板　寬 24 × 深 35 cm」
function dimExtraHtml(label,spec,axes){
  const bits=axes.map(([axis,key])=>({axis,key,dim:parseDim(spec[key])})).filter(bit=>bit.dim);
  if(!bits.length)return "";
  let body;
  // 舊格式的「尺寸備註」轉成規格列時，文字都放在寬那一格；只有這段文字就原樣顯示，不加「寬」
  if(bits.length===1&&bits[0].key==="w"&&bits[0].dim.text!==undefined)body=escapeHTML(bits[0].dim.text);
  else if(bits.every(bit=>bit.dim.text===undefined))body=`${bits.map(bit=>`${bit.axis} ${dimCmText(bit.dim)}`).join(" × ")} cm`;
  else body=bits.map(bit=>`${bit.axis} ${bit.dim.text!==undefined?escapeHTML(bit.dim.text):`${dimCmText(bit.dim)} cm`}`).join(" × ");
  return `<div class="lb-dim-extra"><span>${escapeHTML(label)}</span>${body}</div>`;
}
function customNoteHtml(product,tagDefs,hasLine){
  if(!(product.badges||[]).includes("custom"))return "";
  const def=tagDefsOf(tagDefs).find(d=>d.key==="custom");
  if(!def)return "";
  return `<div class="lb-dim-note">${tagBadgeHtml(def)}<span>${hasLine?"這款可以依你家的空間訂做尺寸，傳 LINE 告訴老闆需要的寬、深、高。":"這款可以依你家的空間訂做尺寸，歡迎告訴我們需要的寬、深、高。"}</span></div>`;
}
// site：{catalog, tagDefs, contact}（後台存的網站設定）
const hasLineOf=site=>!!String(site?.contact?.line||"").trim();
export function productSizeHtml(product,site){
  const d=product.dimensions||{};
  const subName=subNameOf(site.catalog,product.mainCat,product.subCat),mainName=mainNameOf(site.catalog,product.mainCat);
  // 後台可以指定這件商品用哪張示意圖、或不顯示（dimFigure 欄位，空白＝依分類自動）；
  // 「約幾尺」跟著示意圖的種類走，選不顯示時改看依分類自動判斷的種類
  const figureKey=resolveDimFigureKey(product.dimFigure,subName,mainName);
  const kind=figureKey||autoDimFigureKey(subName,mainName);
  const W=parseDim(d.width),D=parseDim(d.depth),H=parseDim(d.height);
  const specs=(product.specs||[]).filter(spec=>spec&&typeof spec==="object");
  const seatIndex=findSeatSpecIndex(specs);
  const seatH=seatIndex>=0?parseDim(specs[seatIndex].h):null;
  const hasSeatH=!!seatH&&seatH.text===undefined;
  // 其他規格列變成補充說明；「尺寸洽詢」這種列不是尺寸，parseDim 會略過
  const extraHtml=specs.map((spec,index)=>{
    if("part" in spec){
      const axes=index===seatIndex&&hasSeatH?[["寬","w"],["深","d"]]:[["寬","w"],["深","d"],["高","h"]];
      return dimExtraHtml(spec.part||"規格",spec,axes);
    }
    const value=String(spec.value||"").trim();
    return value&&!/洽詢/.test(value)?`<div class="lb-dim-extra"><span>${escapeHTML(spec.label||"尺寸備註")}</span>${escapeHTML(withCm(value))}</div>`:"";
  }).join("");
  const hasLine=hasLineOf(site);
  const chi=kind!=="chair"&&kind!=="armchair";
  const rows=dimRowHtml("寬",W,{chi,adj:"可調整"})+dimRowHtml("深",D,{chi,adj:"可調整"})+dimRowHtml("高",H,{chi,adj:"可升降"})
    +(hasSeatH?dimRowHtml("座高",seatH,{key:true,adj:"可升降"}):"");
  let body;
  if(rows){
    // 示意圖照這件商品自己的寬深高比例畫（例如寬 60、深 90 的桌子會畫成比較深）
    const fig=figureKey?`<div class="lb-dim-fig">${dimFigureSvg(figureKey,{seat:hasSeatH,dims:figureDimsOf(d,specs)})}</div>`:"";
    body=`<div class="lb-dim${fig?"":" no-fig"}">${fig}<div class="lb-dim-rows">${rows}</div></div>${extraHtml}`;
  }else if(extraHtml)body=extraHtml;
  else body=`<div class="lb-dim-ask"><strong>尺寸請洽詢</strong><p>${hasLine?"這款的實際尺寸，按下方「LINE 詢問這件商品」問老闆就會告訴你。":"這款的實際尺寸，歡迎聯絡我們詢問。"}</p></div>`;
  return `<div class="lb-spec-title">尺寸</div>${body}${customNoteHtml(product,site.tagDefs,hasLine)}`;
}

/* ── 顏色／款式 ─────────────────────────────────────────────────
   後台填的 options：點了會換到那個款式指定的照片，用 LINE 詢問時也會帶上選的款式 */
export function productOptions(product){return (Array.isArray(product.options)?product.options:[]).filter(o=>o&&String(o.name||"").trim())}
export function optionsHtml(product,selected=-1){
  const opts=productOptions(product);
  if(!opts.length)return "";
  const chosen=opts[selected];
  return `<div class="lb-opts">
    <div class="lb-opts-k">顏色／款式${chosen?`<span>：${escapeHTML(chosen.name)}</span>`:""}</div>
    <div class="lb-opts-list">${opts.map((o,i)=>`<button type="button" class="lb-opt${i===selected?" active":""}" data-opt="${i}" aria-pressed="${i===selected}"><span class="lb-opt-dot" style="background:${/^#[0-9a-f]{6}$/i.test(o.color||"")?o.color:"#d8cbb8"}"></span>${escapeHTML(o.name)}</button>`).join("")}</div>
  </div>`;
}

/* ── LINE 詢問 ──────────────────────────────────────────────────── */
// LINE 的訊息預帶網址不支援夾帶圖片，改成附上商品連結，賣家點開就能直接看到照片
export function lineInquireUrl(lineId,product,{option=null,productUrl="",intro="您好，我想詢問這件商品："}={}){
  const id=String(lineId||"").trim();
  if(!id)return "";
  const msg=`${intro}${product.name||""}${option?`（${option.name}）`:""}\n${productUrl}`;
  return `https://line.me/R/oaMessage/${encodeURIComponent(id)}/?${encodeURIComponent(msg)}`;
}
// data-lead：前台的流量統計用來記「有人按了詢問」（見 index.html 的 GA 那段）
export function lineInquireBtnHtml(url){
  if(!url)return "";
  return `<a class="lb-inquire-btn" href="${escapeHTML(url)}" target="_blank" rel="noopener" data-lead="line">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>
    LINE 詢問這件商品
  </a>`;
}

/* ── 商品頁右側那一欄（分類、品名、價格、交期、款式、尺寸、說明、LINE 詢問）────
   opts：{option:目前選的款式（-1＝沒選）, productUrl:這件商品的網址, now:判斷特價有沒有過期用的時間} */
const HEART_SVG='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7.5-4.6-10-9.1C.5 8.3 2.4 4.5 6 4.5c2 0 3.6 1.1 4.5 2.7C11.4 5.6 13 4.5 15 4.5c3.6 0 5.5 3.8 4 7.4-2.5 4.5-10 9.1-10 9.1z" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
export function productInfoHtml(product,site,{option=-1,productUrl="",now=new Date()}={}){
  const cat=subNameOf(site.catalog,product.mainCat,product.subCat)||mainNameOf(site.catalog,product.mainCat);
  const desc=productDescHtml(product);
  const price=priceHtml(product,now);
  const lineUrl=lineInquireUrl(site.contact?.line,product,{option:productOptions(product)[option]||null,productUrl});
  return `
      <div class="lb-cat-row">
        <div class="lb-product-cat">${escapeHTML(cat)}</div>
        <button class="lb-favorite" id="lbFavoriteBtn" onclick="toggleLbFavorite()" aria-label="加入喜愛清單">${HEART_SVG}</button>
      </div>
      <h2 class="lb-product-title" id="lbTitle">${escapeHTML(product.name||"")}</h2>
      ${price?`<div class="lb-product-price">${price}${activeSalePrice(product,now)&&product.saleEnd?`<span class="price-until">特價到 ${saleEndText(product.saleEnd)}</span>`:""}</div>`:""}
      ${product.leadTime?`<div class="lb-lead"><span class="lb-lead-k">交期</span><span>${escapeHTML(product.leadTime)}</span></div>`:""}
      ${optionsHtml(product,option)}
      ${productSizeHtml(product,site)}
      ${desc?`<div class="lb-spec-title lb-desc-title">商品說明</div><div class="lb-product-note">${desc}</div>`:""}
      ${lineInquireBtnHtml(lineUrl)}
    `;
}
