/* ── 前台、後台共用的顯示規則 ───────────────────────────────────
   前台 index.html 跟後台 manage.html 都 import 這個檔案，兩邊用同一份規則：
   - 商品說明的過濾（白名單）：後台存檔、後台編輯框、前台顯示都過同一道
   - 分類：哪些商品顧客看得到（隱藏的分類不列出）、商品的排列順序（照「分類管理」）
   這個檔案不能用到 document／window（只處理文字跟資料，哪裡都能用），需要的資料一律從參數傳進來。
   ⚠ 改了這個檔案，記得把 index.html、manage.html 裡 import 網址的 ?v= 數字加一，
   不然瀏覽器可能還在用快取裡的舊版。 */

function escapeAttr(str=""){
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
    out+=`<${name}${style?` style="${escapeAttr(style)}"`:""}>`;
    stack.push(name);
  }
  while(stack.length)out+=`</${stack.pop()}>`;
  return out;
}

/* ── 分類 ───────────────────────────────────────────────────────── */
function mainCatOf(catalog,id){return (catalog||[]).find(c=>c.id===id)}
// 後台「分類管理」把主分類或子分類設成隱藏：那個分類的商品不出現在任何列表、搜尋、
// 本月選品、分類磚（直接用商品連結打開還是看得到）
export function isListedProduct(product,catalog){
  if(product.status!=="active")return false;
  const main=mainCatOf(catalog,product.mainCat);
  if(main?.hidden)return false;
  if(main&&product.subCat&&(main.subs||[]).find(s=>s.id===product.subCat)?.hidden)return false;
  return true;
}
// 商品排列順序：照後台「分類管理」的分類順序（主分類、再子分類），同一個子分類裡照
// 後台拖曳出來的自訂順序。沒選子分類的排在那個主分類最前面；分類被刪掉的排最後。
export function catalogOrderCompare(catalog){
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
    return (a.sortOrder??0)-(b.sortOrder??0);
  };
}
