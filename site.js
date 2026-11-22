/* ═══ site.js：前台主程式（首頁、商品頁 p/*.html、分類頁 c/*.html 共用）═══════════════════
   原本整段寫在 index.html 裡，2026-11 抽出來：每個自動產生的頁面不用再各帶一份，瀏覽器可以快取，
   改程式也只要讀這一個檔。樣式還是留在 index.html 的 <style>（第一次打開就要有，不能晚到）。
   規則與「改哪裡」對照見 _docs/ARCHITECTURE.md。改了這個檔案，index.html 裡引用它的 ?v= 要加一。
   HTML 上的 onclick 只能呼叫掛在 window 上的函式：新增時加進下面 Object.assign(window,{...}) 那份清單。 */
// 價格、尺寸、商品說明、商品頁右側那一欄的顯示規則跟後台、自動產生的商品頁共用同一份：shop-render.js
// （尺寸示意圖在它 import 的 dim-figures.js；改了這兩個檔案要把 ?v= 加一，見檔案開頭說明）。
// 網址用 / 開頭：每件商品的網頁在 /p/ 底下，相對路徑會找錯地方。
import{listingTitleHtml,SITE_NAME,escapeHTML,normalizeProduct,productPath,isListedProduct,catalogOrderCompare,mainNameOf,subNameOf,normalizePhotoUrl,tagDefsOf,tagBadgeHtml,getSizeSummary,activeSalePrice,priceDigits,priceHtml,productDescText,productOptions,productInfoHtml,buyInfoItems,buyInfoListHtml,similarProducts,photoAlt,categoryPath,categoryIdFromPath,categoryFromId,categoryPageTitle,categoryIntro,categoryNavHtml,contactItemsHtml,contactActionsHtml}from"/shop-render.js?v=14";

const firebaseConfig={
  apiKey:"AIzaSyBssTXYLERqDDcuW62MkGxdydPR_hfMBrw",
  authDomain:"hsshop-10bd9.firebaseapp.com",
  projectId:"hsshop-10bd9",
  storageBucket:"hsshop-10bd9.firebasestorage.app",
  messagingSenderId:"693625648338",
  appId:"1:693625648338:web:7460e5aa1c5e9e55b1a90b"
};
/* ── Firebase Firestore 整合 ────────────────────────────────────────
   Firebase 的程式（www.gstatic.com）等真的要讀資料時才載入（上面 <head> 的 modulepreload 已經提早
   開始下載）：下面的程式不用等它就能先跑，回訪客人的快取、第一次來的客人的 site.json 馬上就能畫出
   商品；Firebase 載不下來時也只是拿不到最新資料，網頁其他部分照常運作。
   前台只需要「讀一次、顯示」，不需要即時監聽也不需要離線快取，所以用
   firebase-firestore-lite（純 REST 呼叫，沒有 WebChannel 長輪詢）：完整版 SDK
   為了維持背景即時同步／離線快取會開一條 Listen/channel 長連線，在慢速網路
   下這條連線的交握可能拖到 10~20 秒以上，直接卡住首頁大圖（LCP）；lite 版
   沒有這條連線，一個 fetch 打完就結束，換到的代價是回訪客人不會有本機快取
   （每次都重新下載），但對於這種偶爾才逛一次的傢俱型錄網站，換取穩定的首次
   載入速度比較划算。 */
const SITE_DOC="hsshop-10bd9";
let firestorePromise=null;
function firestore(){
  if(!firestorePromise)firestorePromise=Promise.all([
    import("https://www.gstatic.com/firebasejs/11.8.1/firebase-app.js"),
    import("https://www.gstatic.com/firebasejs/11.8.1/firebase-firestore-lite.js")
  ]).then(([app,fs])=>({fs,db:fs.getFirestore(app.initializeApp(firebaseConfig))}));
  return firestorePromise;
}
const siteDoc=({fs,db},...path)=>fs.doc(db,"sitedata",SITE_DOC,...path);
const WISHLIST_TTL_MS=30*24*60*60*1000; // 心願清單短碼超過 30 天視為過期
const Storage={
  // 心願清單打包連結：把收藏的商品 id 存成一筆短碼文件，網址只要帶短碼，
  // 不管收藏幾件商品，連結長度都固定很短。
  async createWishlist(ids){
    const f=await firestore();
    const code=uid().slice(0,6);
    await f.fs.setDoc(siteDoc(f,"wishlists",code),{ids,createdAt:Date.now()});
    return code;
  },
  async getWishlist(code){
    try{
      const f=await firestore();
      const snap=await f.fs.getDoc(siteDoc(f,"wishlists",code));
      if(!snap.exists())return null;
      const data=snap.data();
      if(!data.createdAt||Date.now()-data.createdAt>WISHLIST_TTL_MS)return null;
      return Array.isArray(data.ids)?data.ids:null;
    }catch(e){
      console.warn("心願清單讀取失敗",e);
      return null;
    }
  },
  // 商品各自存成一份文件（sitedata/{SITE_DOC}/products/{id}），避免全站塞進單一文件撞到
  // Firestore 每份文件 1MB 的上限（商品一多、照片一多很容易超過）。
  // catalog／contact／pageText 資料量小，仍合併存在主文件裡。
  // 商品文件本身只存封面照（photos[0]）＋ photoCount，完整的多張照片另外存在
  // products/{id}/gallery/full 子文件，只有真的需要看全部照片時（滑鼠移過、開燈箱、
  // 編輯商品）才讀取，避免首頁一次把所有商品的所有照片都抓下來拖慢載入。
  async getGallery(id){
    try{
      const f=await firestore();
      const snap=await f.fs.getDoc(siteDoc(f,"products",id,"gallery","full"));
      return snap.exists()?(snap.data().photos||[]).filter(Boolean):[];
    }catch(e){
      console.warn("圖庫讀取失敗",e);
      return [];
    }
  },
  // meta（catalog/contact/pageText/layout）跟商品清單分開抓：meta 文件很小，不用被商品
  // 這個大集合卡住——meta 一回來就能先把首頁大圖、聯繫資訊等畫面準備好，不用整頁等
  // 商品資料到齊才有東西可以畫，改善首次有內容顯示的速度。
  async getMeta(){
    try{
      const f=await firestore();
      const snap=await f.fs.getDoc(siteDoc(f));
      return snap.exists()?snap.data():null;
    }catch(e){
      console.warn("網站設定讀取失敗",e);
      return null;
    }
  },
  // 注意：只回傳 status=="active" 的商品，不是完整商品清單（封存、垃圾桶裡的都不會拿到）。
  async getActiveProducts(){
    try{
      // 前台只顯示上架中的商品，已下架（status:"archived"）的一律不需要，直接在
      // 伺服器端濾掉，不用把它們的資料（含縮圖）也下載下來、進了瀏覽器才丟棄。
      const f=await firestore();
      const snap=await f.fs.getDocs(f.fs.query(f.fs.collection(f.db,"sitedata",SITE_DOC,"products"),f.fs.where("status","==","active")));
      return snap.docs.map(d=>d.data());
    }catch(e){
      console.warn("商品清單讀取失敗",e);
      return null;
    }
  }
};
/* ─────────────────────────────────────────────────────────────── */
// firestore-lite 刻意不做離線快取（見下方啟動流程註解），這裡自己補一層很輕量的
// stale-while-revalidate：回訪客人先看到「上次抓到的樣子」，Firebase 資料回來後
// 再原地換新，不用整頁乾等。
const SWR_CACHE_KEY="xintong_furniture_swr_cache_v1";
const SWR_CACHE_MAX_AGE_MS=7*24*60*60*1000; // 快取超過 7 天就不用，避免久久沒改版的舊資料被誤當最新
const DEFAULT_CATALOG=[
  {id:"cat-bed",name:"寢具",subs:[{id:"sub-bed-frame",name:"床架"},{id:"sub-bed-mattress",name:"床墊"},{id:"sub-bed-head",name:"床頭板"},{id:"sub-bed-side",name:"床邊桌"}]},
  {id:"cat-table",name:"桌子",subs:[{id:"sub-tbl-dining",name:"餐桌"},{id:"sub-tbl-coffee",name:"茶几／邊桌"},{id:"sub-tbl-desk",name:"書桌／工作桌"},{id:"sub-tbl-dressing",name:"梳妝台"}]},
  {id:"cat-chair",name:"椅子",subs:[{id:"sub-chr-dining",name:"餐椅"},{id:"sub-chr-sofa",name:"沙發"},{id:"sub-chr-lounge",name:"單人休閒椅"},{id:"sub-chr-office",name:"辦公椅"}]},
  {id:"cat-storage",name:"收納櫃／架",subs:[{id:"sub-sto-wardrobe",name:"衣櫃"},{id:"sub-sto-bookshelf",name:"書架／展示架"},{id:"sub-sto-tv",name:"電視櫃"},{id:"sub-sto-shoe",name:"鞋櫃"}]}
];
function sampleSvg(title,color1,color2){
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="900" height="675" viewBox="0 0 900 675">
    <rect width="900" height="675" fill="${color1}"/>
    <rect x="0" y="460" width="900" height="215" fill="#ded0bd"/>
    <rect x="160" y="290" width="580" height="145" rx="26" fill="${color2}"/>
    <rect x="205" y="225" width="210" height="125" rx="24" fill="#a4937d"/>
    <rect x="485" y="225" width="210" height="125" rx="24" fill="#bba886"/>
    <rect x="210" y="426" width="36" height="94" rx="10" fill="#5b5144"/>
    <rect x="654" y="426" width="36" height="94" rx="10" fill="#5b5144"/>
    <text x="450" y="590" fill="#4f463a" font-family="Arial" font-size="36" text-anchor="middle">${title}</text>
  </svg>`;
  return "data:image/svg+xml;charset=UTF-8,"+encodeURIComponent(svg);
}
function uid(){return Math.random().toString(36).slice(2,10)}
const DEFAULT_STATE={
  catalog:structuredClone(DEFAULT_CATALOG),
  activeMain:"全部",
  activeSub:null,
  favorites:[],
  // 商品一律從 Firebase 讀取；讀取失敗時顯示「暫時載入不了」，不顯示任何範例商品
  products:[],
  // 平常以後台「聯繫資訊」存的資料為準；這裡只有 Firebase 讀取失敗時才會用到，
  // 所以放真實的店家資訊（後台改了聯繫資訊時記得也更新這裡），避免客人看到錯的電話或 LINE
  contact:{
    addr:"台北市大安區文昌街184號",
    phone:"02-2705-3858",
    line:"@833pzizi",
    hours:"全年無休，每天 10:00-21:00",
    email:"service@hsintong.cc",
    fbUrl:"https://www.facebook.com/people/%E4%BF%A1%E9%80%9A%E5%AE%B6%E4%BF%B1%E8%A1%8C-HsinTong/100063577046106/?locale=zh_TW",
    lineUrl:"https://lin.ee/YiaZm7f",
    mapUrl:"https://maps.app.goo.gl/YVk7GoeiY2WKJWA86"
  },
  pageText:{},
  tagDefs:[]
};
let state=structuredClone(DEFAULT_STATE);
/* ── 分類頁（/c/分類編號）：一打開就選好那個分類 ───────────────────
   分類資料（後台的分類管理）要等讀進來才知道編號是哪個分類，所以先記著，畫分類按鈕前再套用 */
const routeCategoryId=categoryIdFromPath(location.pathname)||(location.hash.match(/^#cat-(.+)$/)||[])[1]||null;
let routeCategoryDone=!routeCategoryId;
function applyRouteCategory(){
  if(routeCategoryDone)return;
  const hit=categoryFromId(state.catalog,routeCategoryId);
  if(!hit)return;
  routeCategoryDone=true;
  state.activeMain=hit.main;
  state.activeSub=hit.sub;
  // 舊格式（#cat-分類編號，分類頁還沒產生好時 404 頁轉過來的）換成正式網址
  if(location.hash.startsWith("#cat-")){try{history.replaceState(history.state,"",categoryPath(routeCategoryId))}catch(e){}}
}
// 目前選的分類對應的網址、網頁標題（「全部」就是首頁）
function currentCategoryPage(){
  if(state.activeMain==="全部")return null;
  const id=state.activeSub||state.activeMain;
  const name=state.activeSub?getSubName(state.activeMain,state.activeSub):getMainName(state.activeMain);
  const products=listedProducts().filter(p=>p.mainCat===state.activeMain&&(!state.activeSub||p.subCat===state.activeSub)).sort(catalogOrderCompare(state.catalog));
  return {id,main:state.activeMain,sub:state.activeSub,name,mainName:getMainName(state.activeMain),products};
}
function listUrl(){const page=currentCategoryPage();return page?categoryPath(page.id):"/"}
function listTitle(){const page=currentCategoryPage();return page?categoryPageTitle(page,state.contact):HOME_TITLE}
// 客人自己點分類：換分類、網址跟著換（分享、重新整理都還在這個分類），不另外記一筆瀏覽紀錄
function setCategory(main,sub=null){
  state.activeMain=main;
  state.activeSub=sub;
  if(main==="全部")document.body.classList.remove("cat-landing");
  renderCategories();
  renderProducts();
  if(isLightboxOpen())return;
  const url=listUrl();
  if(location.pathname!==url||location.hash)replaceView(url);
  document.title=listTitle();
}
/* ── 商品標籤（左上角徽章）─────────────────────────────────────
   state.tagDefs 的排列順序就是優先順序：一件商品若同時符合多個標籤，
   只顯示排在最前面的那一個，避免卡片被塞太多徽章。標籤本身（改名／
   顏色／新增／刪除）在後台「標籤管理」設定，這裡只負責讀取、顯示。 */
function primaryTagBadgeHtml(product){
  const badges=product.badges||[];
  const def=tagDefsOf(state.tagDefs).find(d=>badges.includes(d.key));
  return def?tagBadgeHtml(def):"";
}
let searchQuery="";
let productsLoadFailed=false;
let favoritesRoomFilter="全部";
// 依實際版面大小提供多種寬度，讓瀏覽器依裝置螢幕寬度/DPR自己挑最合適的檔案，
// 避免手機版小卡片還是抓桌面版用的大尺寸圖（PageSpeed「圖片解析度過大」建議）。
// 商品卡片（列表封面／滑鼠移過的第二張）跟首頁大圖分別對應兩組不同的顯示尺寸，
// 各自的呼叫點共用同一份陣列，之後要調整最小寬度只要改這裡一個地方。
// sizes：照片在畫面上實際顯示的寬度（實測各種螢幕寬度量出來的），瀏覽器依這個加上螢幕解析度挑剛好夠用的尺寸，
// 寫太大會下載用不到的大圖（PageSpeed「圖片大小適中」）。版面改了寬度要跟著改。
const GRID_IMG_WIDTHS=[200,280,400,500,600,800];
const GRID_IMG_SIZES="(max-width:760px) 46vw, 16vw";
const PICK_IMG_WIDTHS=[200,300,450,600,800];
const PICK_IMG_SIZES="(max-width:760px) 32vw, (max-width:860px) 38vw, 17vw";
const HERO_IMG_SIZES="(max-width:760px) 53vw, min(30vw, 360px)";
// 有滑鼠的裝置才先下載商品卡片的第二張照片（滑鼠移過去才看得到）；手機沒有「移過去」，
// 不先下載，省一半的照片流量
const CAN_HOVER=window.matchMedia("(hover:hover)").matches;
const HERO_IMG_WIDTHS=[200,300,400,500,700,900];
function buildSrcset(url,widths){
  // 只有 http(s) 連結（Cloudinary／Drive）才需要多尺寸版本；base64 舊資料本來就
  // 是同一份資料，硬產生 4 份一樣的字串只會浪費記憶體，直接跳過。
  if(!/^https?:\/\//i.test(url||""))return "";
  return widths.map(w=>`${normalizePhotoUrl(url,w)} ${w}w`).join(", ");
}

function getMainName(id){return mainNameOf(state.catalog,id)}
function getSubName(mainId,subId){return subNameOf(state.catalog,mainId,subId)}
function toast(msg,dur=2200){
  const el=document.getElementById("toast");
  el.textContent=msg;
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer=setTimeout(()=>el.classList.remove("show"),dur);
}
function openModal(id){document.getElementById(id).classList.add("open")}
function closeModal(id){document.getElementById(id).classList.remove("open")}
function applyPageText(){
  document.querySelectorAll("[data-page-field]").forEach(el=>{
    const key=el.dataset.pageField;
    const val=state.pageText?.[key];
    // val!=null（用寬鬆比較，一次排除 undefined 跟 null）才處理：後台這個欄位
    // 從來沒設定過時是 undefined，這時候保留 HTML 裡寫死的預設文字；後台如果
    // 把欄位清空成空字串 ""，這裡要能真的把畫面清空，不能因為 "" 是 falsy
    // 就被跳過、變成永遠清不掉、卡在舊文字或預設文字。
    // 值跟畫面上現有的文字一樣就不要動：textContent= 就算寫入相同的字串，
    // 也會整個文字節點砍掉重建，逼瀏覽器重新畫一次——如果這時候自架字型
    // 剛好已經下載完成，就會從「開頁瞬間的備援字體」變成「Noto 字型」，
    // 造成沒有實際內容變化、卻看起來像字體中途切換的閃爍。
    if(val!=null&&el.textContent!==val)el.textContent=val;
  });
}
function applyLayoutVisibility(){
  // 後台「首頁版面設定」的顯示/隱藏開關；沒設定過（undefined）一律預設顯示
  const picks=document.getElementById("picks");
  const catTiles=document.getElementById("catTiles");
  if(picks)picks.style.display=state.layout?.showPicks===false?"none":"";
  if(catTiles)catTiles.style.display=state.layout?.showCatTiles===false?"none":"";
}

// 顧客看得到的商品：上架中，而且主分類、子分類都沒有在後台「分類管理」設成隱藏。
// 隱藏分類的商品不出現在任何列表、搜尋、本月選品、分類磚（直接用商品網址打開還是看得到）
function listedProducts(){return state.products.filter(p=>isListedProduct(p,state.catalog))}
function mainCount(id){return listedProducts().filter(p=>p.mainCat===id).length}
function renderCategories(){
  applyRouteCategory();
  const bar=document.getElementById("categoriesBar");
  const subBar=document.getElementById("subCategoriesBar");
  const sidebar=document.getElementById("catSidebar");
  // 分類按鈕是連到分類頁的連結（shop-render.js，跟每小時產生的分類頁同一份），點擊在下面統一攔下來
  const nav=categoryNavHtml(state.catalog,listedProducts(),state.activeMain,state.activeSub);
  bar.querySelectorAll(".cat-tab").forEach(el=>el.remove());
  bar.insertAdjacentHTML("beforeend",nav.bar);
  sidebar.innerHTML=nav.side;
  subBar.innerHTML=nav.sub;
  subBar.style.display=state.activeMain!=="全部"&&nav.sub?"flex":"none";
  scheduleTabPills();
}
// 選中分類的底色：記住上一次的位置，重畫之後從舊位置滑到新點的那顆
// （手機版是上方兩排分類鈕，電腦版是左側分類清單）。
// 先把三排要的位置一次量完、再一起改，瀏覽器只要排版一次；滑動用 Web Animations 播，
// 不用先放回舊位置再逼瀏覽器重排（Google 的 INP 指標看的就是點下去到畫面更新要多久）
const tabPillPos={};
const TAB_PILL_EASE="cubic-bezier(.22,1,.36,1)";
function measureTabPill(container,selector){
  const active=container?.querySelector(selector);
  if(!active||!container.offsetWidth)return null; // 沒有選中的、或這一排現在沒顯示（例如電腦版的上方分類列）
  return {x:active.offsetLeft,y:active.offsetTop,w:active.offsetWidth,h:active.offsetHeight,radius:getComputedStyle(active).borderRadius};
}
function applyTabPill(container,key,pos,animate,fadeIn){
  if(!container)return;
  let pill=container.querySelector(":scope > .tab-pill");
  if(!pos){
    pill?.remove();
    container.classList.remove("has-pill");
    delete tabPillPos[key];
    return;
  }
  const prev=tabPillPos[key],isNew=!pill;
  if(isNew){
    pill=document.createElement("span");
    pill.className="tab-pill";
    pill.setAttribute("aria-hidden","true");
    container.prepend(pill);
  }
  const frame=p=>({transform:`translate(${p.x}px,${p.y}px)`,width:p.w+"px",height:p.h+"px"});
  Object.assign(pill.style,frame(pos),{borderRadius:pos.radius});
  container.classList.add("has-pill");
  tabPillPos[key]=pos;
  if(!animate||prefersReducedMotion())return;
  if(prev&&(prev.x!==pos.x||prev.y!==pos.y||prev.w!==pos.w||prev.h!==pos.h))pill.animate([frame(prev),frame(pos)],{duration:250,easing:TAB_PILL_EASE});
  else if(isNew&&!prev&&fadeIn)pill.animate([{opacity:0},{opacity:1}],{duration:250,easing:"ease"}); // 子分類第一次點選：淡入
}
// 等這次點擊的工作（含重畫商品格）做完、下一個畫面要畫之前才量位置，不在點擊當下逼瀏覽器排版
let tabPillFrame=0;
function scheduleTabPills(){
  if(!tabPillFrame)tabPillFrame=requestAnimationFrame(()=>{tabPillFrame=0;syncTabPills(true)});
}
function syncTabPills(animate){
  const rows=[
    [document.getElementById("categoriesBar"),":scope > .cat-tab.active","bar",false],
    [document.getElementById("subCategoriesBar"),":scope > .sub-tab.active","sub:"+state.activeMain,true],
    [document.getElementById("catSidebar"),":scope > .cat-side-btn.active","side",false],
  ];
  const sizes=rows.map(([el,sel])=>measureTabPill(el,sel));
  rows.forEach(([el,,key,fadeIn],i)=>applyTabPill(el,key,sizes[i],animate,fadeIn));
}
// 視窗大小變了、字型載入完，按鈕寬度位置會變：直接對齊，不播滑動
let tabPillResizeTimer=null;
window.addEventListener("resize",()=>{clearTimeout(tabPillResizeTimer);tabPillResizeTimer=setTimeout(()=>syncTabPills(false),120)});
document.fonts?.ready.then(()=>syncTabPills(false));
/* ── 搜尋 ───────────────────────────────────────────────────────── */
let searchDebounceTimer=null;
let searchWasEmptyBeforeTyping=true;
let searchTrackTimer=null,lastTrackedSearch="";
function handleSearchInput(){
  // 只在「這波輸入的第一下」（還沒有排定中的計時器）記錄輸入前是不是空的，
  // 不然連續打好幾個字時，每次都會被上一個字覆蓋掉，變成永遠讀到「上一個字」
  // 而不是「這波輸入開始前」的狀態，導致開始打字要捲到商品區的邏輯幾乎不會觸發。
  if(!searchDebounceTimer)searchWasEmptyBeforeTyping=!searchQuery;
  searchQuery=document.getElementById("productSearch").value;
  document.getElementById("searchClearBtn").style.display=searchQuery?"block":"none";
  // renderProducts() 會整個商品格重繪（含建立新的 <img> 節點），連續輸入時代價不小，
  // 加 180ms 防抖，停手後才重繪，避免打字過程中畫面一直卡頓。
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer=setTimeout(()=>{
    searchDebounceTimer=null;
    renderProducts();
    if(searchQuery&&searchWasEmptyBeforeTyping)document.getElementById("categories").scrollIntoView({behavior:"smooth"});
  },180);
  // 停手 1.5 秒才記一次搜尋，打字途中的半個詞不算
  clearTimeout(searchTrackTimer);
  searchTrackTimer=setTimeout(()=>{
    const term=searchQuery.trim();
    if(term&&term!==lastTrackedSearch){lastTrackedSearch=term;track("search",{search_term:term})}
  },1500);
}
// 手機上搜尋框很窄，完整的提示字放不下（會被切成「搜尋商品名」），換短的
{
  const input=document.getElementById("productSearch");
  const narrow=window.matchMedia("(max-width:760px)");
  const full=input.placeholder;
  const fit=()=>{input.placeholder=narrow.matches?"搜尋商品":full};
  fit();
  narrow.addEventListener?.("change",fit);
}
function clearSearch(){
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer=null;
  searchQuery="";
  document.getElementById("productSearch").value="";
  document.getElementById("searchClearBtn").style.display="none";
  renderProducts();
}
function toggleMobileNav(force){
  const menu=document.getElementById("navLinksMobile");
  const btn=document.getElementById("navHamburger");
  const open=typeof force==="boolean"?force:!menu.classList.contains("open");
  menu.classList.toggle("open",open);
  btn.setAttribute("aria-expanded",String(open));
}
// 導覽列捲動效果：往下捲超過一點距離就縮小、加深陰影，回到頂部時恢復原狀。
// 用 requestAnimationFrame 節流，避免每個 scroll 事件都直接操作 DOM 造成掉幀。
(function initNavScrollEffect(){
  const navEl=document.querySelector("nav");
  if(!navEl)return;
  let ticking=false;
  const update=()=>{
    navEl.classList.toggle("nav--scrolled",window.scrollY>40);
    ticking=false;
  };
  window.addEventListener("scroll",()=>{
    if(ticking)return;
    ticking=true;
    requestAnimationFrame(update);
  },{passive:true});
})();
/* 商品格分批畫：一次只先畫前 GRID_FIRST_BATCH 件，捲到接近最後一件時（還差約兩個畫面高）再畫下
   一批。全部 58 件一次畫出來有一千多個網頁元素，手機光是算版面就要花上半秒以上；客人通常只會看
   前面幾排，後面的等快捲到再畫，看起來一樣是一路接著出現。 */
const GRID_FIRST_BATCH=20,GRID_NEXT_BATCH=24;
let gridMoreObserver=null;
// 分類連結：一般點擊就地切換分類；按著 Ctrl／⌘ 或中鍵點，照一般連結在新分頁打開
document.getElementById("categories").addEventListener("click",event=>{
  const link=event.target.closest("a[data-main]");
  if(!link||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
  event.preventDefault();
  setCategory(link.dataset.main,link.dataset.sub||null);
  // 手機版左邊的分類欄會跟著畫面固定：往下逛到一半換分類，商品格變短了，把畫面帶回商品列表開頭
  const layout=document.querySelector(".cat-layout");
  if(layout&&matchMedia("(max-width:760px)").matches&&layout.getBoundingClientRect().top<0)layout.scrollIntoView({block:"start"});
});
function renderProducts(animate=true){
  applyRouteCategory();
  const grid=document.getElementById("productsGrid");
  grid.innerHTML="";
  gridMoreObserver?.disconnect();
  gridMoreObserver=null;
  let list=listedProducts();
  const q=searchQuery.trim().toLowerCase();
  if(q){
    // 搜尋要涵蓋全部商品、全部分類，不受目前選取的分類侷限
    list=list.filter(p=>{
      const cat=`${getMainName(p.mainCat)} ${getSubName(p.mainCat,p.subCat)}`.toLowerCase();
      const descText=productDescText(p).toLowerCase();
      return (p.name||"").toLowerCase().includes(q)||descText.includes(q)||cat.includes(q);
    });
  }else if(state.activeMain!=="全部"){
    list=list.filter(p=>p.mainCat===state.activeMain);
    if(state.activeSub)list=list.filter(p=>p.subCat===state.activeSub);
  }
  // 照後台「分類管理」排好的分類順序：先主分類、再子分類，同一個子分類內才用後台拖曳出來的
  // 自訂順序——不同分類的商品不會混在一起穿插，子分類裡排好的順序，看主分類或「全部」的
  // 時候也照樣套用。後台商品表格的「前台順序」用的是同一個規則（shop-render.js）。
  list.sort(catalogOrderCompare(state.catalog));
  renderListingTitle();
  renderAppliedChips();
  if(!list.length){
    const empty=document.createElement("div");
    empty.style.cssText="width:100%;text-align:center;padding:56px 20px;color:var(--soft)";
    empty.textContent=q?`找不到符合「${searchQuery.trim()}」的商品`
      :productsLoadFailed?"商品資料暫時載入不了，請稍後重新整理頁面；也可以直接打電話或傳 LINE 詢問。":"此分類尚無商品";
    grid.appendChild(empty);
  }
  // 「全部分類」瀏覽（沒有搜尋、也沒選特定分類）才加分區標題：商品本來就已經照
  // 主分類排序好了，只是滑下去看不出分界，加個標題列把同一主分類的商品圈出來。
  // 有搜尋或已經篩選到單一分類時，畫面上只有一組商品，不需要再多一層標題。
  const showSections=state.activeMain==="全部"&&!q;
  let lastSectionMain=null;
  const addCard=(product,idx)=>{
    if(showSections&&product.mainCat!==lastSectionMain){
      lastSectionMain=product.mainCat;
      const head=document.createElement("div");
      head.className="products-section-head"+(idx===0?" first":"");
      const count=list.filter(p=>p.mainCat===product.mainCat).length;
      head.innerHTML=`<span class="products-section-title">${escapeHTML(getMainName(product.mainCat))}</span><span class="products-section-count">${count} 件</span>`;
      grid.appendChild(head);
    }
    const photos=(product.photos||[]).filter(Boolean);
    const card=document.createElement("article");
    card.className="product-card";
    const wrap=document.createElement("div");
    wrap.className="product-img-wrap";
    const fav=document.createElement("button");
    fav.className="favorite-btn"+(isFavorite(product.id)?" active":"");
    fav.dataset.favId=product.id;
    fav.title="加入收藏清單";
    fav.innerHTML='<svg viewBox="0 0 24 24"><path d="M12 19.8 4.6 12.6a4.8 4.8 0 0 1 6.8-6.8l.6.6.6-.6a4.8 4.8 0 0 1 6.8 6.8z" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
    fav.addEventListener("click",event=>{
      event.stopPropagation();
      toggleFavorite(product.id,fav);
    });
    card.appendChild(fav);
    const totalCount=product.photoCount??photos.length;
    if(photos.length){
      const cover=document.createElement("img");
      cover.loading="lazy"; // 要在設定 src 之前：先給 src 的話瀏覽器會馬上下載，lazy 就沒作用了
      cover.src=normalizePhotoUrl(photos[0],600);
      cover.srcset=buildSrcset(photos[0],GRID_IMG_WIDTHS);
      cover.sizes=GRID_IMG_SIZES;
      cover.alt=photoAlt(product,state.catalog);
      cover.className="img-primary"+(totalCount>1?" has-secondary":"");
      fadeInOnLoad(cover,wrap);
      cover.onerror=()=>showBrokenImage(wrap,cover);
      wrap.appendChild(cover);
      if(totalCount>1){
        let hoverImg=null,galleryLoading=false;
        const showHover=src=>{
          hoverImg=document.createElement("img");
          hoverImg.loading="lazy"; // 要在設定 src 之前：先給 src 的話瀏覽器會馬上下載，lazy 就沒作用了
          hoverImg.src=normalizePhotoUrl(src,600);
          hoverImg.srcset=buildSrcset(src,GRID_IMG_WIDTHS);
          hoverImg.sizes=GRID_IMG_SIZES;
          hoverImg.alt=""; // 滑過去才出現的第二張照片，跟封面是同一件商品，不用再念一次
          hoverImg.className="img-secondary";
          hoverImg.onerror=()=>hoverImg.style.display="none";
          wrap.appendChild(hoverImg);
        };
        if(photos.length>1&&CAN_HOVER){
          showHover(photos[1]);
        }else{
          // 首頁列表只讀封面照，第二張以後的照片要滑鼠移過去才抓，避免一次載入太多照片
          wrap.addEventListener("mouseenter",async()=>{
            if(hoverImg||galleryLoading)return;
            if(photos.length>1){showHover(photos[1]);return}
            galleryLoading=true;
            const full=await Storage.getGallery(product.id);
            galleryLoading=false;
            if(full.length>1)showHover(full[1]);
          });
        }
      }
      const hint=document.createElement("div");
      hint.className="img-zoom-hint";
      hint.innerHTML='<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/><path d="M11 8v6M8 11h6"/></svg>';
      wrap.appendChild(hint);
      if(totalCount>1){
        const count=document.createElement("div");
        count.className="img-count-badge";
        count.textContent=totalCount+" 張";
        wrap.appendChild(count);
      }
    }else{
      wrap.innerHTML=placeholderMarkup("尚無圖片");
    }
    card.appendChild(wrap);
    const info=document.createElement("div");
    info.className="product-info";
    const price=priceHtml(product);
    info.innerHTML=`
      <div class="product-name"><a href="${escapeHTML(productPath(product.id))}">${escapeHTML(product.name)}</a></div>
      <div class="product-meta-row">
        <span class="product-size">${escapeHTML(getSizeSummary(product))}</span>
      </div>
      ${price?`<span class="product-price">${price}</span>`:""}
    `;
    card.appendChild(info);
    card.addEventListener("click",()=>openProductDetail(product.id,wrap));
    grid.appendChild(card);
  };
  let next=0;
  const sentinel=document.createElement("div");
  sentinel.className="grid-more";
  sentinel.setAttribute("aria-hidden","true");
  const renderMore=()=>{
    const end=Math.min(list.length,next+(next?GRID_NEXT_BATCH:GRID_FIRST_BATCH));
    for(;next<end;next++)addCard(list[next],next);
    if(next<list.length)grid.appendChild(sentinel); // 移到最後面，捲到它附近再畫下一批
    else{sentinel.remove();gridMoreObserver?.disconnect();gridMoreObserver=null}
  };
  renderMore();
  if(next<list.length){
    if("IntersectionObserver" in window){
      gridMoreObserver=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting))renderMore()},{rootMargin:"0px 0px 1600px 0px"});
      gridMoreObserver.observe(sentinel);
    }else{
      while(next<list.length)renderMore();
    }
  }
  // 切換分類／搜尋時，整個商品區塊淡入＋輕微上移一下，讓「內容換了」這件事
  // 更明顯，比整頁瞬間換掉生硬。強制重排（offsetWidth）是刻意的，用來讓瀏覽器
  // 重新套用動畫，不然拿掉又馬上加回同一個 class，瀏覽器會當作沒變化而不重播。
  // animate=false 只給開頁自動執行的那兩次呼叫用（先畫本機快取、Firebase資料
  // 回來後再畫一次真正的資料）——這兩次都不是使用者主動切換，不需要、也不該
  // 播放淡入動畫，不然這兩次自動重繪會讓整個商品區塊在開頁的一兩秒內閃兩次。
  if(animate){
    grid.classList.remove("grid-transition-in");
    void grid.offsetWidth;
    grid.classList.add("grid-transition-in");
  }
}
function renderListingTitle(){
  const el=document.getElementById("listingTitle");
  if(!el)return;
  const html=listingTitleHtml(state.catalog,state.activeMain,state.activeSub);
  if(el.innerHTML!==html)el.innerHTML=html;
  // 分類的簡介（跟分類頁一開始寫好的同一段，shop-render.js）；「全部」、搜尋中不放
  const intro=document.getElementById("listingIntro");
  const page=searchQuery.trim()?null:currentCategoryPage();
  const text=page&&page.products.length?categoryIntro(page,state.contact):"";
  if(intro.textContent!==text)intro.textContent=text;
  intro.hidden=!text;
}
function renderAppliedChips(){
  const wrap=document.getElementById("appliedChips");
  if(!wrap)return;
  const chips=[];
  if(state.activeMain!=="全部"){
    chips.push({label:getMainName(state.activeMain),clear:()=>setCategory("全部")});
  }
  if(state.activeSub){
    chips.push({label:getSubName(state.activeMain,state.activeSub),clear:()=>setCategory(state.activeMain)});
  }
  if(!chips.length){wrap.innerHTML="";return}
  const closeSvg='<svg viewBox="0 0 24 24" data-icon><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.5"/></svg>';
  wrap.innerHTML=chips.map((c,i)=>`<button class="chip-applied" data-idx="${i}">${escapeHTML(c.label)}${closeSvg}</button>`).join("")
    +`<button class="chip-clear-all" id="clearAllChips">全部清除</button>`;
  wrap.querySelectorAll(".chip-applied").forEach((btn,i)=>{
    btn.onclick=()=>chips[i].clear();
  });
  document.getElementById("clearAllChips").onclick=()=>setCategory("全部");
}
// 商品照片載入完成才淡入。這一輪已經載入過的網址（切換分類、Firebase 資料回來後
// 重畫列表）直接顯示、不重播淡入，不然每次重畫整排照片都會閃一下。
const loadedPhotoSrcs=new Set();
// 照片框真的出現在畫面上、照片又還沒載好，才放那塊會呼吸的底（.photo-skel）。
// 畫面外的照片（往下捲才會開始載）不先放：幾十塊在背景一直跑的動畫，會讓每次點按都慢一點
const skelWaiting=new Set();
let skelCleanupTimer=null;
const photoSkelObserver=("IntersectionObserver" in window)?new IntersectionObserver(entries=>{
  entries.forEach(({target,isIntersecting})=>{
    if(!isIntersecting)return;
    photoSkelObserver.unobserve(target);
    if(!skelWaiting.delete(target))return;
    const skel=document.createElement("span");
    skel.className="photo-skel";
    target.prepend(skel);
  });
}):null;
// host：照片所在的框（商品卡片）。載好後底色模糊淡出、照片從模糊變清楚，淡完就把那塊底拿掉
function fadeInOnLoad(img,host){
  const key=img.src;
  img.classList.add("img-fade");
  if(loadedPhotoSrcs.has(key)){img.classList.add("is-loaded");return}
  if(host&&photoSkelObserver){
    skelWaiting.add(host);
    photoSkelObserver.observe(host);
    // 商品格重畫後，舊的框不會再出現：過一下把它們從觀察清單拿掉，不要一直留在記憶體
    clearTimeout(skelCleanupTimer);
    skelCleanupTimer=setTimeout(()=>skelWaiting.forEach(h=>{if(!h.isConnected){photoSkelObserver.unobserve(h);skelWaiting.delete(h)}}),1000);
  }
  const done=ok=>{
    if(ok)loadedPhotoSrcs.add(key);
    img.classList.add("is-loaded");
    if(!host)return;
    skelWaiting.delete(host);
    photoSkelObserver?.unobserve(host);
    const skel=host.querySelector(":scope > .photo-skel");
    if(!skel)return;
    if(!ok||prefersReducedMotion()){skel.remove();return}
    skel.animate({opacity:0,filter:"blur(2px)"},{duration:400,easing:"ease-in-out",fill:"forwards"}).finished.catch(()=>{}).then(()=>skel.remove());
    img.animate([{filter:"blur(2px)"},{filter:"blur(0)"}],{duration:400,easing:"ease-in-out"});
  };
  img.addEventListener("load",()=>done(true),{once:true});
  img.addEventListener("error",()=>done(false),{once:true});
}
/* ── 捲動進場動畫：見上方 .reveal CSS ─────────────────────────── */
const revealObserver=("IntersectionObserver" in window)?new IntersectionObserver(entries=>{
  entries.forEach(entry=>{
    if(entry.isIntersecting){
      entry.target.classList.add("is-visible");
      revealObserver.unobserve(entry.target);
    }
  });
},{threshold:.2,rootMargin:"0px 0px -40px 0px"}):null;
function initRevealOnScroll(){
  const els=document.querySelectorAll(".reveal:not(.reveal-bound)");
  els.forEach(el=>{
    el.classList.add("reveal-bound");
    if(!revealObserver){el.classList.add("is-visible");return}
    if(el.getBoundingClientRect().top<innerHeight*.9){
      el.classList.add("is-visible");
    }else{
      el.classList.add("will-reveal");
      revealObserver.observe(el);
    }
  });
}
function renderPicks(){
  const grid=document.getElementById("picksGrid");
  const countEl=document.getElementById("picksTotalCount");
  if(!grid)return;
  const all=listedProducts().sort((a,b)=>(a.sortOrder??0)-(b.sortOrder??0));
  if(countEl)countEl.textContent=all.length;
  // 後台「首頁版面設定」手動挑選的商品優先（照選好的順序顯示）；沒有手動選的話自動抓排序最前面 4 件
  const pickedIds=(state.layout?.picksProductIds||[]).filter(id=>all.some(p=>p.id===id));
  const picks=pickedIds.length?pickedIds.map(id=>state.products.find(p=>p.id===id)).filter(Boolean):all.slice(0,4);
  grid.innerHTML="";
  picks.forEach((product,idx)=>{
    const photos=(product.photos||[]).filter(Boolean);
    const card=document.createElement("article");
    card.className="p-card reveal";
    card.style.transitionDelay=(idx*70)+"ms";
    const price=priceHtml(product);
    card.innerHTML=`
      <div class="p-card__media"></div>
      <div class="p-card__title"><a href="${escapeHTML(productPath(product.id))}">${escapeHTML(product.name)}</a></div>
      <div class="p-card__foot">
        <span class="mono">${escapeHTML(getSizeSummary(product))}</span>
        ${price?`<span class="price">${price}</span>`:""}
      </div>
      <button class="p-card__fav${isFavorite(product.id)?" active":""}" type="button" data-fav-id="${escapeHTML(product.id)}" aria-label="加入收藏">
        <svg viewBox="0 0 24 24" data-icon><path d="M12 19.8 4.6 12.6a4.8 4.8 0 0 1 6.8-6.8l.6.6.6-.6a4.8 4.8 0 0 1 6.8 6.8z" fill="none" stroke="currentColor" stroke-width="2"/></svg>
      </button>
      ${primaryTagBadgeHtml(product)?`<div class="p-card__badge">${primaryTagBadgeHtml(product)}</div>`:""}
    `;
    // 首張照片先放，第二張照片存在才補上 img-secondary，滑鼠移過去用 CSS
    // 淡入切換（跟 #productsGrid 的 .product-card 是同一套做法，見 renderProducts）。
    const media=card.querySelector(".p-card__media");
    const totalCount=product.photoCount??photos.length;
    if(photos.length){
      const cover=document.createElement("img");
      cover.loading="lazy"; // 要在設定 src 之前：先給 src 的話瀏覽器會馬上下載，lazy 就沒作用了
      cover.src=normalizePhotoUrl(photos[0],500);
      cover.srcset=buildSrcset(photos[0],PICK_IMG_WIDTHS);
      cover.sizes=PICK_IMG_SIZES;
      cover.alt=photoAlt(product,state.catalog);
      cover.className="img-primary"+(totalCount>1?" has-secondary":"");
      fadeInOnLoad(cover,media);
      media.appendChild(cover);
      if(totalCount>1){
        const showHover=src=>{
          const hoverImg=document.createElement("img");
          hoverImg.loading="lazy"; // 要在設定 src 之前：先給 src 的話瀏覽器會馬上下載，lazy 就沒作用了
          hoverImg.src=normalizePhotoUrl(src,500);
          hoverImg.srcset=buildSrcset(src,PICK_IMG_WIDTHS);
          hoverImg.sizes=PICK_IMG_SIZES;
          hoverImg.alt=""; // 滑過去才出現的第二張照片，跟封面是同一件商品，不用再念一次
          hoverImg.className="img-secondary";
          hoverImg.onerror=()=>hoverImg.style.display="none";
          media.appendChild(hoverImg);
        };
        if(photos.length>1&&CAN_HOVER){
          showHover(photos[1]);
        }else{
          let galleryLoading=false,loaded=false;
          media.addEventListener("mouseenter",async()=>{
            if(loaded||galleryLoading)return;
            if(photos.length>1){loaded=true;showHover(photos[1]);return}
            galleryLoading=true;
            const full=await Storage.getGallery(product.id);
            galleryLoading=false;loaded=true;
            if(full.length>1)showHover(full[1]);
          });
        }
      }
    }
    card.querySelector(".p-card__fav").addEventListener("click",event=>{
      event.stopPropagation();
      toggleFavorite(product.id,event.currentTarget);
    });
    card.addEventListener("click",()=>openProductDetail(product.id,media));
    grid.appendChild(card);
  });
  initRevealOnScroll();
}
function renderCategoryTiles(){
  const grid=document.getElementById("catTilesGrid");
  if(!grid)return;
  // 照「分類管理」的順序取前 4 個顧客看得到、而且有商品的主分類（隱藏的、空的不放，
  // 不然點進去是空的）；分類少於 4 個時欄數跟著變少，不會留空格
  const listed=listedProducts().sort(catalogOrderCompare(state.catalog));
  const cats=state.catalog.filter(c=>!c.hidden&&listed.some(p=>p.mainCat===c.id)).slice(0,4);
  grid.style.setProperty("--cols",cats.length+1);
  grid.classList.toggle("odd",(cats.length+1)%2===1);
  grid.innerHTML=cats.map((cat,i)=>{
    // 後台「首頁版面設定」為這個分類上傳的縮圖優先；沒有的話自動抓分類底下第一件商品的照片
    // 縮圖實際只顯示約 56px 寬：給 120／200 兩種尺寸讓瀏覽器依螢幕解析度挑，不要每台都下載 200px
    const thumbUrl=cat.image||listed.find(p=>p.mainCat===cat.id&&(p.photos||[]).length)?.photos?.[0]||"";
    const thumbSrc=thumbUrl&&normalizePhotoUrl(thumbUrl,200);
    const thumbSet=buildSrcset(thumbUrl,[120,200]);
    return `
      <a class="cat-tile reveal" href="${escapeHTML(categoryPath(cat.id))}" data-cat="${escapeHTML(cat.id)}" style="transition-delay:${i*60}ms">
        <span class="cat-tile__thumb">${thumbSrc?`<img loading="lazy" decoding="async" src="${escapeHTML(thumbSrc)}"${thumbSet?` srcset="${escapeHTML(thumbSet)}" sizes="56px"`:""} alt="">`:""}</span>
        <span class="cat-tile__name">${escapeHTML(cat.name)}</span>
        <span class="cat-tile__count">${mainCount(cat.id)} 件</span>
      </a>
    `;
  }).join("")+`
    <button type="button" class="cat-tile cat-tile--cta reveal" id="catCta" onclick="toggleFavoritesPanel(true)" style="transition-delay:${cats.length*60}ms">
      <span class="cat-tile__name">喜歡的<br>先按 ♡ 收藏</span>
      <span class="cta-link">選好再一次問老闆 →</span>
    </button>
  `;
  grid.querySelectorAll(".cat-tile[data-cat]").forEach(link=>{
    link.addEventListener("click",event=>{
      if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
      event.preventDefault();
      setCategory(link.dataset.cat);
      document.getElementById("categories").scrollIntoView({behavior:"smooth",block:"start"});
    });
  });
  grid.querySelectorAll(".cat-tile__thumb img").forEach(img=>fadeInOnLoad(img));
  initRevealOnScroll();
}
function renderHeroPhoto(){
  const fig=document.getElementById("heroPhoto");
  const img=document.getElementById("heroPhotoImg");
  if(!fig||!img)return;
  // 後台「首頁版面設定」上傳的圖優先；沒有上傳的話才自動抓第一件有照片的商品
  const customImage=state.layout?.heroImage;
  if(customImage){
    img.src=normalizePhotoUrl(customImage,900);
    img.srcset=buildSrcset(customImage,HERO_IMG_WIDTHS);
    img.sizes=HERO_IMG_SIZES;
    img.alt="";
    return;
  }
  const withPhoto=listedProducts().sort(catalogOrderCompare(state.catalog)).find(p=>(p.photos||[]).length);
  if(!withPhoto)return;
  img.src=normalizePhotoUrl(withPhoto.photos[0],900);
  img.srcset=buildSrcset(withPhoto.photos[0],HERO_IMG_WIDTHS);
  img.sizes=HERO_IMG_SIZES;
  img.alt=photoAlt(withPhoto,state.catalog);
}
const FAVORITES_KEY="xintong_favorites_v1";
const FAVORITES_TTL_MS=4*60*60*1000; // 收藏清單超過 4 小時沒更新就視為過期
function placeholderMarkup(text){
  return `<div class="placeholder"><div><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 15l5-5 4 4 3-3 6 6"/></svg><div>${escapeHTML(text)}</div></div></div>`;
}
function showBrokenImage(wrap,img){
  img.style.display="none";
  if(!wrap.querySelector(".broken-note"))wrap.insertAdjacentHTML("afterbegin",`<div class="placeholder broken-note"><div>圖片無法載入<br><small>請確認 Drive 已公開分享</small></div></div>`);
}
function loadFavoritesLocal(){
  try{
    const s=localStorage.getItem(FAVORITES_KEY);
    if(!s)return [];
    const data=JSON.parse(s);
    if(!data||!Array.isArray(data.items)||!data.savedAt)return []; // 舊格式或缺時間戳記一律視為過期
    if(Date.now()-data.savedAt>FAVORITES_TTL_MS)return [];
    // 舊格式是純 id 字串陣列，升級成 {id,qty,note,addedAt} 物件，數量預設 1
    return data.items.map(item=>typeof item==="string"?{id:item,qty:1,note:"",addedAt:data.savedAt}:item);
  }catch(e){return []}
}
function saveFavoritesLocal(){
  try{localStorage.setItem(FAVORITES_KEY,JSON.stringify({items:state.favorites,savedAt:Date.now()}))}catch(e){}
}
function isFavorite(id){return state.favorites.some(f=>f.id===id)}
function getFavorite(id){return state.favorites.find(f=>f.id===id)}
// 只切換該商品在畫面上（主清單＋本月選品）對應的愛心按鈕樣式，不整個重繪
// 商品區塊——原本呼叫 renderProducts()/renderPicks() 會讓整個網格重新排版、
// 重播一次進場動畫，使用者只是點一顆愛心，畫面卻整塊閃一下、跳一下。
// 跟燈箱裡 updateLbFavoriteBtn() 是同一種「只改該改的按鈕」做法。
function updateFavoriteButtons(id){
  const active=isFavorite(id);
  document.querySelectorAll(`[data-fav-id="${CSS.escape(id)}"]`).forEach(btn=>{
    btn.classList.toggle("active",active);
  });
}
const prefersReducedMotion=()=>window.matchMedia("(prefers-reduced-motion: reduce)").matches;
// 飛行中的愛心數量：大於 0 時 renderFavorites() 先不更新導覽列的收藏數字，
// 等愛心飛到收藏按鈕才更新，數字跳動的時間點才會跟愛心「落地」對得上。
let favCountHolds=0;
// 收藏時愛心往內縮一下再彈回來，同時往外噴 8 顆小點點；取消收藏只把顏色退掉，不彈也不噴
// （動態參考 transitions.dev 的 Like button）
// 點點飛多遠：商品卡片 overflow:hidden，飛太遠會被切掉。這裡刻意不讀 getComputedStyle，
// 按下去的當下不要逼瀏覽器重算整頁樣式，按鈕反應才快（Google 的 INP 指標看的就是這個）
const LIKE_DIST={"favorite-btn":18,"p-card__fav":22,"lb-favorite":24};
function popFavoriteButton(btn,adding){
  if(!adding||prefersReducedMotion())return;
  const pop="cubic-bezier(.34,1.96,.64,1)";
  // .favorite-btn 滑鼠移上去本來就放大 1.1：從 1.1 彈，結束時才不會跳一下
  const base=btn.classList.contains("favorite-btn")&&btn.matches(":hover")?1.1:1;
  btn.animate([{transform:`scale(${base})`,easing:pop},{transform:`scale(${base*.82})`,offset:.3,easing:pop},{transform:`scale(${base})`}],{duration:350});
  const dist=LIKE_DIST[Object.keys(LIKE_DIST).find(c=>btn.classList.contains(c))]||20;
  const wrap=document.createElement("span");
  wrap.className="like-particles";
  const anims=[];
  for(let i=0;i<8;i++){
    // 每顆的角度、距離、大小、速度都抖一點，噴起來才自然
    const angle=i/8*Math.PI*2+(Math.random()-.5)*.5,d=dist*(.85+Math.random()*.4);
    const x=Math.cos(angle)*d,y=Math.sin(angle)*d,size=3*(.8+Math.random()*.5);
    const duration=600*(.85+Math.random()*.3),delay=Math.random()*40;
    const dot=document.createElement("i");
    dot.style.width=dot.style.height=size+"px";
    dot.style.margin=`${-size/2}px 0 0 ${-size/2}px`;
    wrap.appendChild(dot);
    anims.push(dot.animate([{opacity:0,transform:"translate(0,0) scale(.4)"},{opacity:1,transform:`translate(${x*.25}px,${y*.25}px) scale(1)`,offset:.2},{opacity:0,transform:`translate(${x}px,${y}px) scale(${.4+Math.random()*.4})`}],{duration,delay,easing:"ease-out",fill:"forwards"}));
  }
  btn.appendChild(wrap);
  Promise.allSettled(anims.map(a=>a.finished)).then(()=>wrap.remove());
}
function bumpFavoritesFab(){
  if(prefersReducedMotion())return;
  document.querySelector(".favorites-fab")?.animate([{transform:"scale(1)"},{transform:"scale(1.1)",offset:.35},{transform:"scale(1)"}],{duration:380,easing:"ease-out"});
}
// 導覽列的收藏數字：數字有變才換；第一次顯示（剛打開網站）不播動畫
// （動態參考 transitions.dev 的 Number pop-in）
let favCountShown=false;
function setFavoritesCount(n){
  document.dispatchEvent(new CustomEvent("hs:favcount",{detail:n})); // 手機底部「已收藏 N 件」長條（siteFx）聽這個
  const el=document.getElementById("favoritesCount");
  if(!el)return;
  const text=String(n),prev=Number(el.textContent)||0;
  if(favCountShown&&el.textContent===text)return;
  const animate=favCountShown&&!prefersReducedMotion();
  favCountShown=true;
  if(!animate){el.textContent=text;return}
  // 每次都換成新的數字元素，動畫自己會從頭播，不用逼瀏覽器先重排版面
  el.style.setProperty("--digit-dir",n>prev?"1":"-1");
  el.innerHTML=`<span class="num-digits">${[...text].map((ch,i,all)=>`<span class="num-digit"${all.length>1&&i===all.length-1?' data-stagger="1"':""}>${ch}</span>`).join("")}</span>`;
}
function flyHeartToFab(btn){
  if(prefersReducedMotion())return;
  const target=document.querySelector(".favorites-fab svg");
  if(!target)return;
  const a=btn.getBoundingClientRect(),b=target.getBoundingClientRect();
  if(!a.width||!b.width)return;
  const x0=a.left+a.width/2,y0=a.top+a.height/2;
  const dx=b.left+b.width/2-x0,dy=b.top+b.height/2-y0;
  const fly=document.createElement("div");
  fly.className="fav-fly";
  if(btn.classList.contains("favorite-btn"))fly.style.color="var(--danger)";
  fly.style.left=x0+"px";
  fly.style.top=y0+"px";
  fly.innerHTML='<div><div><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19.8 4.6 12.6a4.8 4.8 0 0 1 6.8-6.8l.6.6.6-.6a4.8 4.8 0 0 1 6.8 6.8z"/></svg></div></div>';
  document.body.appendChild(fly);
  const moveY=fly.firstElementChild,scale=moveY.firstElementChild,dur=680;
  favCountHolds++;
  // 水平先慢後快、垂直先快後慢，兩者疊起來就是一條先往上、再轉向收藏按鈕的弧線
  fly.animate([{transform:"translateX(0)"},{transform:`translateX(${dx}px)`}],{duration:dur,easing:"cubic-bezier(.5,0,.75,.5)",fill:"forwards"});
  scale.animate([{transform:"scale(1)",opacity:1},{transform:"scale(1.4)",opacity:1,offset:.18},{transform:"scale(.55)",opacity:.95,offset:.9},{transform:"scale(.4)",opacity:0}],{duration:dur,fill:"forwards"});
  moveY.animate([{transform:"translateY(0)"},{transform:`translateY(${dy}px)`}],{duration:dur,easing:"cubic-bezier(.2,.8,.35,1)",fill:"forwards"})
    .finished.catch(()=>{}).then(()=>{
      fly.remove();
      favCountHolds--;
      if(!favCountHolds)setFavoritesCount(favoriteProductsWithMeta().length);
      bumpFavoritesFab();
    });
}
// sourceBtn：使用者實際點的那顆愛心，有傳才播按鈕回饋；加入收藏時再飛一顆小愛心到導覽列
function toggleFavorite(id,sourceBtn){
  const adding=!isFavorite(id);
  if(adding){
    state.favorites.push({id,qty:1,note:"",addedAt:Date.now()});
    favSnack();
  }else{
    state.favorites=state.favorites.filter(f=>f.id!==id);
    toast("已從收藏清單移除");
  }
  saveFavoritesLocal();
  updateFavoriteButtons(id);
  if(adding){const product=state.products.find(p=>p.id===id);if(product)track("add_to_wishlist",gaItemParams(product))}
  if(sourceBtn){
    popFavoriteButton(sourceBtn,adding);
    if(adding)flyHeartToFab(sourceBtn);
    else bumpFavoritesFab();
  }
  renderFavorites();
}
function setFavoriteQty(id,qty){
  if(qty<=0){
    state.favorites=state.favorites.filter(f=>f.id!==id);
  }else{
    const fav=getFavorite(id);
    if(fav)fav.qty=qty;
  }
  saveFavoritesLocal();
  updateFavoriteButtons(id);
  renderFavorites();
}
function setFavoriteNote(id,note){
  const fav=getFavorite(id);
  if(!fav)return;
  fav.note=note;
  saveFavoritesLocal();
}
function parsePriceNumber(price){
  const digits=priceDigits(price);
  if(digits!=null)return Number(digits);
  const n=parseFloat(String(price||"").replace(/[,，]/g,"").trim());
  return Number.isFinite(n)?n:null;
}
// history:false 是「上一頁／下一頁」本身造成的開關（見下面 popstate），不再另外記瀏覽紀錄
function toggleFavoritesPanel(force,{history:useHistory=true}={}){
  const panel=document.getElementById("favoritesPanel");
  const open=typeof force==="boolean"?force:!panel.classList.contains("open");
  if(open===panel.classList.contains("open"))return;
  panel.classList.toggle("open",open);
  document.dispatchEvent(new CustomEvent("hs:favpanel",{detail:open}));
  if(!useHistory)return;
  if(open)pushView(location.href);
  else if(canStepBack()&&history.state.fav&&!history.state.product)history.back();
  else replaceView(location.href);
}
function favoriteProductsWithMeta(){
  return state.favorites.map(f=>{
    const product=state.products.find(p=>p.id===f.id);
    return product&&product.status==="active"?{...product,_qty:f.qty||1,_note:f.note||""}:null;
  }).filter(Boolean);
}
function renderFavoritesRoomTabs(allProducts){
  const tabsWrap=document.getElementById("favoritesRoomTabs");
  const rooms=[...new Set(allProducts.map(p=>p.room).filter(Boolean))];
  const hasUnassigned=allProducts.some(p=>!p.room);
  if(!rooms.length){
    tabsWrap.style.display="none";
    tabsWrap.innerHTML="";
    return;
  }
  const tabs=["全部",...rooms,...(hasUnassigned?["未分類"]:[])];
  if(!tabs.includes(favoritesRoomFilter))favoritesRoomFilter="全部";
  tabsWrap.style.display="flex";
  tabsWrap.innerHTML=tabs.map(room=>{
    const n=room==="全部"?allProducts.length:allProducts.filter(p=>(p.room||"未分類")===room).length;
    return `<button class="favorites-room-tab${favoritesRoomFilter===room?" active":""}" data-room="${escapeHTML(room)}">${escapeHTML(room)}<span class="mono" style="margin-left:5px">${n}</span></button>`;
  }).join("");
  tabsWrap.querySelectorAll(".favorites-room-tab").forEach(btn=>{
    btn.onclick=()=>{favoritesRoomFilter=btn.dataset.room;renderFavorites()};
  });
}
function renderFavorites(){
  const list=document.getElementById("favoritesList");
  const footer=document.getElementById("favoritesFooter");
  const subtitle=document.getElementById("favoritesSubtitle");
  document.getElementById("favoritesPreview").style.display="none";
  list.style.display="";
  const allProducts=favoriteProductsWithMeta();
  const totalQty=allProducts.reduce((sum,p)=>sum+p._qty,0);
  if(!favCountHolds)setFavoritesCount(allProducts.length);
  const barCount=document.getElementById("lbBarFavCount");
  if(barCount)barCount.textContent=allProducts.length;
  updateLbFavoriteBtn(); // 在收藏清單裡移除了正在看的那件，商品頁的按鈕要跟著變回來
  subtitle.textContent=allProducts.length?`${allProducts.length} 項．共 ${totalQty} 件．這台裝置保留 4 小時`:"";
  renderFavoritesRoomTabs(allProducts);
  if(!allProducts.length){
    footer.style.display="none";
    list.innerHTML='<div class="favorites-empty">還沒有收藏。<br>逛商品時按 ♡ 把想問的都收進來，<br>選好後在這裡一次用 LINE 傳給老闆。</div>';
    return;
  }
  footer.style.display="block";
  const products=favoritesRoomFilter==="全部"?allProducts:allProducts.filter(p=>(p.room||"未分類")===favoritesRoomFilter);
  const total=products.reduce((sum,p)=>{const price=parsePriceNumber(activeSalePrice(p)||p.price);return price!=null?sum+price*p._qty:sum},0);
  document.getElementById("favoritesTotal").innerHTML=total>0?`<span>合計</span><span>$ ${total.toLocaleString()}</span>`:"";
  if(!products.length){
    list.innerHTML='<div class="favorites-empty">這個房間還沒收藏。<br>逛商品時按右上角的愛心就會進來這裡。</div>';
    return;
  }
  list.innerHTML="";
  products.forEach(product=>{
    const item=document.createElement("div");
    item.className="favorite-item";
    const photo=normalizePhotoUrl((product.photos||[])[0]||"",200);
    const price=parsePriceNumber(activeSalePrice(product)||product.price);
    const subtotal=price!=null?`$ ${(price*product._qty).toLocaleString()}`:"";
    item.innerHTML=`
      <img src="${escapeHTML(photo)}" alt="">
      <div>
        <div class="favorite-item-name">${escapeHTML(product.name)}</div>
        <div class="favorite-item-meta">${escapeHTML(getSizeSummary(product))} ・ ${escapeHTML(product.sku||product.id)}</div>
        <div class="favorite-item-row">
          <div class="favorite-item-qty">
            <button class="qty-btn" data-dir="-1">−</button>
            <span>${product._qty}</span>
            <button class="qty-btn" data-dir="1">+</button>
          </div>
          ${subtotal?`<div class="favorite-item-subtotal">${subtotal}</div>`:""}
        </div>
        <input class="favorite-item-note" type="text" placeholder="＋ 備註（例如：想問能不能換顏色）" value="${escapeHTML(product._note)}">
      </div>
      <button class="favorite-item-remove" title="移除"><svg viewBox="0 0 24 24" width="14" height="14" data-icon><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2"/></svg></button>
    `;
    item.querySelector("img").onclick=()=>openProductDetail(product.id);
    item.querySelector(".favorite-item-name").onclick=()=>openProductDetail(product.id);
    item.querySelector(".favorite-item-remove").onclick=()=>setFavoriteQty(product.id,0);
    item.querySelectorAll(".qty-btn").forEach(btn=>{
      btn.onclick=()=>setFavoriteQty(product.id,product._qty+parseInt(btn.dataset.dir,10));
    });
    item.querySelector(".favorite-item-note").addEventListener("input",e=>setFavoriteNote(product.id,e.target.value));
    list.appendChild(item);
  });
}

/* ── 每件商品的網址、手機的「上一頁」───────────────────────────
   打開商品時網址換成這件商品自己的網址（/p/商品編號）：分享、加書籤、重新整理都會回到這件商品，
   每小時自動產生的靜態頁（_tools/build-pages.mjs）也讓 Google 能一件一件收錄、LINE／FB 分享時
   顯示這件商品的照片跟名稱。
   打開商品頁、收藏清單時各多記一筆瀏覽紀錄，手機按「上一頁」就是把它關掉、不會直接離開網站，
   按「下一頁」會再打開。從商品網址直接進來的沒有上一筆可以退，關掉時就把網址換回首頁、不多記一筆。 */
const PAGE_LOAD_ID=Math.random().toString(36).slice(2); // 分辨哪幾筆瀏覽紀錄是這次打開網頁之後自己加的
const HOME_TITLE=document.querySelector("title")?.dataset.homeTitle||document.title;
const isLightboxOpen=()=>document.getElementById("lightbox").classList.contains("open");
const isFavoritesOpen=()=>document.getElementById("favoritesPanel").classList.contains("open");
// 網址 /p/商品編號（或 /p/商品編號.html）→ 商品編號
function productIdFromPath(path){
  const m=/^\/p\/([^/]+?)(?:\.html)?\/?$/.exec(path);
  if(!m)return null;
  try{return decodeURIComponent(m[1])}catch(e){return null}
}
// 目前畫面要記進瀏覽紀錄的樣子：哪件商品開著、收藏清單開著沒
// lbDepth：從打開商品頁到現在，連續點了幾件商品（同類商品）——關掉時一次退回打開前
function viewState(pushed,lbDepth=0){return {hs:PAGE_LOAD_ID,pushed,product:isLightboxOpen()&&lbProduct?lbProduct.id:null,fav:isFavoritesOpen(),lbDepth}}
// 這一筆是這次自己加的：上一筆也還在這個網頁裡，可以直接退回去
const canStepBack=()=>history.state?.hs===PAGE_LOAD_ID&&history.state.pushed===true;
function pushView(url,lbDepth=0){try{history.pushState(viewState(true,lbDepth),"",url)}catch(e){}}
function replaceView(url){try{history.replaceState(viewState(canStepBack(),canStepBack()?history.state.lbDepth||0:0),"",url)}catch(e){}}
let closingProduct=false; // 按 × 關商品頁、一次退好幾筆的途中
window.addEventListener("popstate",event=>{
  const s=event.state||{};
  if(closingProduct){
    // 按 × 退回打開商品頁前那一筆：商品頁已經關了；退到的那筆如果是從商品網址直接進來的，網址換回首頁
    closingProduct=false;
    if(isLightboxOpen())closeLightbox({history:false});
    if(s.product)replaceView(productIdFromPath(location.pathname)||location.hash.startsWith("#product-")?listUrl():location.href);
    if(!!s.fav!==isFavoritesOpen())toggleFavoritesPanel(!!s.fav,{history:false});
    return;
  }
  const want=s.product||null;
  if(want){
    if(!isLightboxOpen()||lbProduct?.id!==want){
      if(state.products.some(p=>p.id===want))openProductDetail(want,null,{history:false});
      else if(isLightboxOpen())closeLightbox({history:false});
    }
  }else if(isLightboxOpen())closeLightbox({history:false});
  if(!!s.fav!==isFavoritesOpen())toggleFavoritesPanel(!!s.fav,{history:false});
});
let lbImages=[],lbCurrent=0,lbScale=1,lbProduct=null,lastFocusedElement=null;
let lbOption=-1; // 商品頁目前選的顏色／款式（-1＝沒選）
let lbTouchStartX=0,lbTouchStartY=0;
// ── 點商品卡片時照片從卡片飛進燈箱 ─────────────────────────────
// 只有動畫期間會用一張照片複本（.lb-fly）代替燈箱照片；照片落定之後就是原本的
// 燈箱，滑鼠移上去放大、滾輪、手機左右滑換照片都照舊。
let lbFlip=null;        // 進行中的「飛進去」動畫
let lbFlipSource=null;  // 這次燈箱是從哪張卡片的圖框開的，關閉時飛回那裡
const LB_STAGE_SHADOW="0 24px 70px rgba(0,0,0,.18)",LB_NO_SHADOW="0 0 0 rgba(0,0,0,0)";
function canFlipLightbox(){
  // 使用者雙指放大整個網頁時座標會偏掉，這種情況直接用原本的開關方式
  return !prefersReducedMotion()&&(!window.visualViewport||Math.abs(visualViewport.scale-1)<.01);
}
function lbSourceShape(wrap){
  // 本月選品的照片佔圖框 88%（四周各留 6%）、圓角 16px；主清單的照片四周留 5px、直角
  const rect=wrap.getBoundingClientRect();
  const isPick=wrap.classList.contains("p-card__media");
  return {rect,radius:isPick?16:0,pad:isPick?rect.width*.06:5};
}
function lbFlyFrame(rect,radius,shadow){
  return {left:rect.left+"px",top:rect.top+"px",width:rect.width+"px",height:rect.height+"px",borderRadius:radius+"px",boxShadow:shadow};
}
function makeLbFly(rect,radius,pad,srcs){
  const box=document.createElement("div");
  box.className="lb-fly";
  Object.assign(box.style,{left:rect.left+"px",top:rect.top+"px",width:rect.width+"px",height:rect.height+"px",borderRadius:radius+"px"});
  srcs.forEach(src=>{
    const img=new Image();
    img.alt="";
    img.src=src;
    img.style.padding=pad+"px";
    box.appendChild(img);
  });
  document.body.appendChild(box);
  return box;
}
function setWrapImagesHidden(wrap,hidden){
  wrap.querySelectorAll("img").forEach(img=>{img.style.visibility=hidden?"hidden":""});
}
// 燈箱打開前先量卡片圖框的位置（打開後桌面版捲軸消失，版面會左右位移）
function prepareLbFlip(wrap){
  if(!wrap||!canFlipLightbox())return null;
  const primary=wrap.querySelector("img.img-primary");
  if(!primary||!primary.complete||!primary.naturalWidth)return null;
  const shape=lbSourceShape(wrap);
  const srcs=[primary.currentSrc||primary.src];
  // 桌面版滑鼠移在卡片上時顯示的是第二張照片，飛行時先疊著它再淡出成封面照
  const secondary=wrap.querySelector("img.img-secondary");
  if(secondary&&secondary.complete&&secondary.naturalWidth&&parseFloat(getComputedStyle(secondary).opacity)>.5){
    srcs.push(secondary.currentSrc||secondary.src);
  }
  return {wrap,shape,srcs};
}
function finishLbFlipOpen(){
  if(!lbFlip)return;
  const {box,wrap}=lbFlip;
  lbFlip=null;
  box.remove();
  setWrapImagesHidden(wrap,false);
  document.getElementById("lightbox").classList.remove("lb-flip");
}
function startLbFlipOpen(prep){
  const lightbox=document.getElementById("lightbox");
  lightbox.classList.add("lb-flip");
  const to=document.getElementById("lbStage").getBoundingClientRect();
  const {shape,srcs,wrap}=prep;
  const box=makeLbFly(shape.rect,shape.radius,shape.pad,srcs);
  setWrapImagesHidden(wrap,true);
  lbFlip={box,wrap};
  const dur=460,easing="cubic-bezier(.2,.8,.2,1)";
  const move=box.animate([lbFlyFrame(shape.rect,shape.radius,LB_NO_SHADOW),lbFlyFrame(to,8,LB_STAGE_SHADOW)],{duration:dur,easing,fill:"forwards"});
  box.querySelectorAll("img").forEach(img=>img.animate([{padding:shape.pad+"px"},{padding:"0px"}],{duration:dur,easing,fill:"forwards"}));
  if(srcs.length>1)box.lastElementChild.animate([{opacity:1},{opacity:0}],{duration:dur*.55,easing:"ease",fill:"forwards"});
  document.getElementById("lbInfo").animate([{transform:"translateY(24px)"},{transform:"none"}],{duration:480,delay:120,easing:"cubic-bezier(.16,.84,.44,1)",fill:"backwards"});
  const mine=lbFlip;
  move.finished.catch(()=>{}).then(()=>{
    if(lbFlip!==mine)return;
    mine.landed=true;
    // 燈箱照片還沒載入完就先讓複本留在原位，等照片到了再換，避免中間空白一下
    const img=document.getElementById("lbImg");
    const ready=()=>!img.classList.contains("lb-img-loading")&&img.complete&&img.naturalWidth>0;
    if(ready()){finishLbFlipOpen();return}
    const giveUp=setTimeout(finishLbFlipOpen,2500);
    img.addEventListener("load",()=>{clearTimeout(giveUp);if(lbFlip===mine)finishLbFlipOpen()},{once:true});
  });
}
function flyBackToCard(wrap,from,src){
  const lightbox=document.getElementById("lightbox");
  const shape=lbSourceShape(wrap);
  const box=makeLbFly(from,8,0,[src]);
  setWrapImagesHidden(wrap,true);
  const dur=400,easing="cubic-bezier(.4,0,.2,1)";
  box.querySelector("img").animate([{padding:"0px"},{padding:shape.pad+"px"}],{duration:dur,easing,fill:"forwards"});
  box.animate([lbFlyFrame(from,8,LB_STAGE_SHADOW),lbFlyFrame(shape.rect,shape.radius,LB_NO_SHADOW)],{duration:dur,easing,fill:"forwards"})
    .finished.catch(()=>{}).then(()=>{
      setWrapImagesHidden(wrap,false);
      box.remove();
      // 這段時間內又打開了燈箱（例如又點了一張卡片）就不要把新的狀態拿掉
      if(!lightbox.classList.contains("open"))lightbox.classList.remove("lb-flip");
    });
}
// options.history："auto"＝點商品打開（多記一筆瀏覽紀錄，商品頁已經開著就換掉那一筆）、
// "replace"＝從商品網址進來（換掉目前這筆）、false＝上一頁／下一頁造成的（不動瀏覽紀錄）
function openProductDetail(id,sourceWrap,{history:mode="auto"}={}){
  const product=state.products.find(p=>p.id===id);
  if(!product)return;
  const wasOpen=isLightboxOpen();
  finishLbFlipOpen();
  const flipPrep=prepareLbFlip(sourceWrap);
  lbFlipSource=flipPrep?sourceWrap:null;
  const isProductSwitch=lbProduct!==product;
  lbOption=-1; // 每次打開都從「還沒選款式」開始，跟照片從第 1 張開始一致
  lbProduct=product;
  // 跟商品列表卡片用同一個寬度（600），瀏覽器多半已經有快取，一開燈箱就能立刻
  // 顯示正確的照片，不用等網路重新抓一張沒快取過的大圖（原本預設 1600 寬）。
  const cover=(product.photos||[]).filter(Boolean).map(url=>normalizePhotoUrl(url,600));
  lbImages=cover.length?cover:[sampleSvg(product.name||"商品圖片","#8a7b68","#5b5448")];
  lbCurrent=0;
  if(!wasOpen)lastFocusedElement=document.activeElement;
  const lightbox=document.getElementById("lightbox");
  // 從商品網址進來的靜態頁（_tools/build-pages.mjs 產生）一開始就畫好了這件商品、照片也是同一張：
  // 不要先蓋住照片再顯示，不然畫面會閃一下
  const prerendered=lightbox.dataset.prerendered===id;
  delete lightbox.dataset.prerendered;
  lightbox.classList.add("open");
  lightbox.setAttribute("aria-hidden","false");
  document.body.classList.add("lightbox-open");
  // 換了商品才需要先蓋住畫面：不然新照片還沒下載完之前，畫面會繼續顯示
  // 上一個商品的照片，容易讓人誤以為切換失敗或卡住。
  lbRender(isProductSwitch&&!prerendered);
  document.querySelector(".lb-close").focus();
  if(flipPrep)startLbFlipOpen(flipPrep);
  // 分頁標題先換（瀏覽紀錄、流量統計記的是換網址那一刻的標題），再換網址
  document.title=`${product.name||"商品"}｜${SITE_NAME}`;
  if(mode==="replace"||(mode==="auto"&&wasOpen))replaceView(productPath(id));
  else if(mode==="auto"||mode==="push")pushView(productPath(id),(wasOpen&&canStepBack()?history.state.lbDepth||0:0)+1);
  track("view_item",gaItemParams(product));
  // 商品文件的封面只是縮圖，燈箱一律要換成 gallery 子文件裡的原始畫質照片
  const totalCount=product.photoCount??cover.length;
  if(totalCount>0){
    Storage.getGallery(id).then(full=>{
      if(!full.length||lbProduct?.id!==product.id)return;
      const photos=full.map(url=>normalizePhotoUrl(url));
      lbImages=photos;
      lbRender();
    });
  }
}
function closeLightbox({history:useHistory=true}={}){
  const lightbox=document.getElementById("lightbox");
  if(!lightbox.classList.contains("open"))return;
  // 照片飛回卡片的條件：從卡片打開、還停在第一張照片（卡片上顯示的就是這張）、
  // 沒有放大中、卡片還在畫面上。其他情況（例如放大中按 ESC、已經換到第 2 張照片）
  // 維持原本的淡出，照片才不會在落回卡片時突然換成另一張或跳一下。
  const wrap=lbFlipSource;
  lbFlipSource=null;
  // 飛進來的途中就關掉：直接淡出。已經落定、只是在等燈箱照片載入：用那張複本飛回去
  const midFlight=!!lbFlip&&!lbFlip.landed;
  const lbImgEl=document.getElementById("lbImg");
  const backSrc=lbFlip?lbFlip.box.querySelector("img").src:(lbImgEl.naturalWidth?lbImgEl.currentSrc||lbImgEl.src:"");
  finishLbFlipOpen();
  let from=null;
  if(wrap&&!midFlight&&backSrc&&lbCurrent===0&&lbScale===1&&document.contains(wrap)&&lightbox.classList.contains("open")&&canFlipLightbox()){
    const r=wrap.getBoundingClientRect();
    if(r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth){
      from=document.getElementById("lbStage").getBoundingClientRect();
      lightbox.classList.add("lb-flip");
    }
  }
  lightbox.classList.remove("open");
  lightbox.setAttribute("aria-hidden","true");
  document.body.classList.remove("lightbox-open");
  resetZoom();
  if(lastFocusedElement instanceof HTMLElement)lastFocusedElement.focus();
  lastFocusedElement=null;
  document.title=listTitle();
  if(useHistory){
    if(canStepBack()&&history.state.product){closingProduct=true;history.go(-(history.state.lbDepth||1))}
    else replaceView(productIdFromPath(location.pathname)||location.hash.startsWith("#product-")?listUrl():location.href);
  }
  // 捲軸回來之後才量卡片的落點
  if(from)flyBackToCard(wrap,from,backSrc);
}
function updateLbFavoriteBtn(){
  const btn=document.getElementById("lbFavoriteBtn");
  if(!btn||!lbProduct)return;
  const active=isFavorite(lbProduct.id);
  btn.classList.toggle("active",active);
  btn.setAttribute("aria-label",active?"從收藏清單移除":"加入收藏清單");
  // 下面那顆大的收藏按鈕（shop-render.js 的 askListHtml）：還沒收藏＝收藏這件；收藏了＝打開收藏清單去詢問
  const ask=document.getElementById("lbAskBtn");
  if(ask){
    ask.classList.toggle("is-added",active);
    ask.querySelector("span").textContent=active?`已收藏・看收藏清單（共 ${favoriteProductsWithMeta().length} 件）→`:"收藏這件，選好一起問";
  }
}
function lbAskClick(){
  if(!lbProduct)return;
  if(isFavorite(lbProduct.id))toggleFavoritesPanel(true);
  else toggleLbFavorite();
}
/* 按了愛心之後的小提示：告訴客人「收藏起來，選好再一次用 LINE 問」，旁邊一顆「看清單」。
   第一次按的時候講完整一點、停久一點（這台裝置記得講過了），之後只報目前幾件。 */
const FAV_TIP_KEY="hs_fav_tip_seen_v1";
let favSnackTimer=0;
function favSnack(){
  let el=document.getElementById("favSnack");
  if(!el){
    el=document.createElement("div");
    el.id="favSnack";el.className="fav-snack";el.setAttribute("role","status");
    el.innerHTML='<span></span><button type="button">看清單</button>';
    el.querySelector("button").addEventListener("click",()=>{el.classList.remove("show");toggleFavoritesPanel(true)});
    document.body.appendChild(el);
  }
  let first=false;
  try{first=!localStorage.getItem(FAV_TIP_KEY);localStorage.setItem(FAV_TIP_KEY,"1")}catch(e){}
  const count=favoriteProductsWithMeta().length;
  el.querySelector("span").textContent=first?"已收藏！喜歡的都先收起來，選好後到收藏清單，一次用 LINE 問老闆。":`已收藏，清單裡有 ${count} 件。選好後一次問老闆。`;
  el.classList.toggle("first",first);
  el.classList.add("show");
  clearTimeout(favSnackTimer);
  favSnackTimer=setTimeout(()=>el.classList.remove("show"),first?8000:3800);
}
function toggleLbFavorite(){
  if(!lbProduct)return;
  const adding=!isFavorite(lbProduct.id);
  // 燈箱蓋住了導覽列，不飛愛心，只讓按鈕彈一下
  toggleFavorite(lbProduct.id);
  updateLbFavoriteBtn();
  const btn=document.getElementById("lbFavoriteBtn");
  if(btn)popFavoriteButton(btn,adding);
}
/* 商品頁右側那一欄（尺寸區塊、款式、說明、LINE 詢問）的內容在 shop-render.js，
   自動產生的商品靜態頁也用同一份，兩邊畫出來一樣。 */
// 顏色／款式（後台填的 options）：點了會換到那個款式指定的照片，用 LINE 詢問時也會帶上選的款式
// 再按一次同一個款式就取消選取
document.getElementById("lbInfo").addEventListener("click",e=>{
  // 同類商品：在商品頁裡換成那件商品，多記一筆瀏覽紀錄（上一頁回到原本這件）；按住 Ctrl／⌘ 照樣開新分頁
  const sim=e.target.closest("a[data-similar]");
  if(sim){
    if(e.ctrlKey||e.metaKey||e.shiftKey||e.button!==0)return;
    if(!state.products.some(p=>p.id===sim.dataset.similar))return;
    e.preventDefault();
    openProductDetail(sim.dataset.similar,null,{history:"push"});
    document.getElementById("lbInfo").scrollTop=0;
    document.getElementById("lightbox").scrollTop=0;
    return;
  }
  const btn=e.target.closest(".lb-opt");
  if(!btn||!lbProduct)return;
  const i=Number(btn.dataset.opt),opt=productOptions(lbProduct)[i];
  if(!opt)return;
  lbOption=lbOption===i?-1:i;
  if(lbOption>=0&&Number.isInteger(opt.photo)&&opt.photo>=0&&opt.photo<lbImages.length)lbCurrent=opt.photo;
  lbRender();
  document.querySelector(`#lbInfo .lb-opt[data-opt="${i}"]`)?.focus();
});
let lbImgToken=0;
function lbRender(resetImage){
  const img=document.getElementById("lbImg");
  const thumbs=document.getElementById("lbThumbs");
  const counter=document.getElementById("lbCounter");
  const info=document.getElementById("lbInfo");
  const nextSrc=lbImages[lbCurrent]||"";
  const token=++lbImgToken;
  // 只有「換到別的商品」才需要先蓋住舊照片；同一個商品內切換照片、或稍後
  // 換成原始畫質照片，本來就是同一張圖片的內容，維持顯示舊版本不會有誤導。
  if(resetImage)img.classList.add("lb-img-loading");
  if(nextSrc){
    const preload=new Image();
    preload.onload=preload.onerror=()=>{
      if(token!==lbImgToken)return; // 使用者已經切到別張照片／別的商品了，這次載入結果不算數
      img.src=nextSrc;
      img.classList.remove("lb-img-loading");
    };
    preload.src=nextSrc;
  }else{
    img.src="";
    img.classList.remove("lb-img-loading");
  }
  img.alt=lbProduct?photoAlt(lbProduct,state.catalog,lbCurrent+1):"商品照片";
  resetZoom();
  document.getElementById("lbPrev").style.display=lbImages.length>1?"grid":"none";
  document.getElementById("lbNext").style.display=lbImages.length>1?"grid":"none";
  counter.textContent=lbImages.length>1?`${lbCurrent+1} / ${lbImages.length}`:"";
  thumbs.innerHTML="";
  if(lbImages.length>1){
    lbImages.forEach((src,index)=>{
      const thumb=document.createElement("img");
      thumb.className="lb-thumb"+(index===lbCurrent?" active":"");
      thumb.src=src;
      thumb.alt=`第 ${index+1} 張照片`;
      thumb.onclick=()=>{lbCurrent=index;lbRender()};
      thumbs.appendChild(thumb);
    });
  }
  if(lbProduct){
    info.innerHTML=productInfoHtml(lbProduct,state,{option:lbOption,similar:similarProducts(lbProduct,listedProducts(),state.catalog)});
    updateLbFavoriteBtn();
  }
}
/* ── 流量統計的事件（Google Analytics 4，設定在 <head> 的 GA_ID；沒設定、或不是正式網站時 track() 什麼都不做）──
   view_item 看了哪件商品、add_to_wishlist 收藏、generate_lead 按了詢問（LINE／電話）、
   search 搜尋了什麼、share 複製收藏清單連結。generate_lead 在 GA 後台設成「重要事件」就是轉換。 */
function track(name,params){try{window.hsTrack?.(name,params)}catch(e){}}
function gaItem(product,qty){
  const price=parsePriceNumber(activeSalePrice(product)||product.price);
  return {item_id:product.id,item_name:product.name||"",item_category:getMainName(product.mainCat),
    ...(getSubName(product.mainCat,product.subCat)?{item_category2:getSubName(product.mainCat,product.subCat)}:{}),
    ...(price!=null?{price}:{}),...(qty?{quantity:qty}:{})};
}
function gaItemParams(product){
  const item=gaItem(product);
  return {currency:"TWD",value:item.price||0,items:[item]};
}
// 網頁上有 data-lead 的連結（商品頁的 LINE 詢問、加 LINE 好友、電話）被按：記一次「詢問」
document.addEventListener("click",event=>{
  const el=event.target.closest?.("[data-lead]");
  if(!el)return;
  const params={method:el.dataset.lead};
  if(el.dataset.lead==="line"&&lbProduct&&isLightboxOpen())Object.assign(params,gaItemParams(lbProduct));
  track("generate_lead",params);
},true);
async function buildWishlistUrl(ids){
  try{
    const code=await Storage.createWishlist(ids);
    return `${location.origin}/#w=${code}`;
  }catch(e){
    console.warn("心願清單短碼建立失敗，改用完整網址",e);
    return `${location.origin}/#wishlist=${ids.join(",")}`;
  }
}
function buildFavoritesMessage(products,wishlistUrl){
  const lines=products.map((p,i)=>{
    let line=`${i+1}. ${p.name} ${getSizeSummary(p)} × ${p._qty}`;
    if(p._note)line+=`\n　　備註：${p._note}`;
    return line;
  });
  return `想詢問這幾件，麻煩幫我報價和運送時間：\n\n${lines.join("\n")}\n\n${wishlistUrl}`;
}
async function inquireAllFavorites(){
  const lineId=(state.contact?.line||"").trim();
  if(!lineId){toast("店家尚未設定 LINE");return}
  const products=favoriteProductsWithMeta();
  if(!products.length){toast("收藏清單是空的");return}
  const ids=products.map(p=>p.id);
  // 先同步開一個空白分頁佔位，避免非同步等待期間被瀏覽器判定成彈窗封鎖
  const win=window.open("","_blank","noopener");
  const wishlistUrl=await buildWishlistUrl(ids);
  const msg=buildFavoritesMessage(products,wishlistUrl);
  const url=`https://line.me/R/oaMessage/${encodeURIComponent(lineId)}/?${encodeURIComponent(msg)}`;
  if(win)win.location.href=url;else window.open(url,"_blank","noopener");
  const items=products.map(p=>gaItem(p,p._qty));
  track("generate_lead",{method:"line_wishlist",currency:"TWD",value:items.reduce((sum,i)=>sum+(i.price||0)*(i.quantity||1),0),items});
  showFavoritesPreview(msg);
}
function showFavoritesPreview(msg){
  document.getElementById("favoritesRoomTabs").style.display="none";
  document.getElementById("favoritesList").style.display="none";
  document.getElementById("favoritesFooter").style.display="none";
  document.getElementById("favoritesPreviewBubble").textContent=msg;
  document.getElementById("favoritesPreview").style.display="block";
}
function resetFavoritesPreview(){
  renderFavorites();
}
async function copyFavoritesLink(){
  const products=favoriteProductsWithMeta();
  if(!products.length){toast("收藏清單是空的");return}
  const wishlistUrl=await buildWishlistUrl(products.map(p=>p.id));
  try{
    await navigator.clipboard.writeText(wishlistUrl);
    toast("清單連結已複製");
    track("share",{method:"copy_link",content_type:"wishlist",item_id:wishlistUrl.split("#")[1]||""});
  }catch(e){
    toast("複製失敗，請手動複製連結");
  }
}
function renderSharedWishlist(ids){
  const container=document.getElementById("wishlistItems");
  if(!ids){
    container.innerHTML='<div class="favorites-empty">這個連結已經失效了（超過 30 天，或連結有誤）。</div>';
    openModal("wishlistModal");
    return;
  }
  const products=ids.map(id=>state.products.find(p=>p.id===id)).filter(p=>p&&p.status==="active");
  if(!products.length){
    container.innerHTML='<div class="favorites-empty">找不到這些商品，可能已下架。</div>';
  }else{
    container.innerHTML=products.map(p=>{
      const photo=normalizePhotoUrl((p.photos||[])[0]||"",200);
      return `
        <div class="favorite-item" data-id="${escapeHTML(p.id)}" style="cursor:pointer">
          <img src="${escapeHTML(photo)}" alt="">
          <div>
            <div class="favorite-item-name">${escapeHTML(p.name||"")}</div>
            <div class="favorite-item-meta">${escapeHTML(getSizeSummary(p))}</div>
          </div>
          <button class="favorite-item-goto" title="查看商品">→</button>
        </div>`;
    }).join("");
    container.querySelectorAll(".favorite-item").forEach(el=>{
      el.addEventListener("click",()=>openProductDetail(el.dataset.id));
    });
  }
  openModal("wishlistModal");
}
function lbNav(dir){
  if(!lbImages.length)return;
  lbCurrent=(lbCurrent+dir+lbImages.length)%lbImages.length;
  lbRender();
}
function applyZoom(){
  document.getElementById("lbImg").style.transform=`scale(${lbScale})`;
  document.getElementById("lbStage").classList.toggle("zoomed",lbScale>1);
}
function resetZoom(){
  lbScale=1;
  document.getElementById("lbImg").style.transformOrigin="center center";
  applyZoom();
}
const lbStage=document.getElementById("lbStage");
// 只有真正有滑鼠的桌面裝置才啟用「滑過去放大」；觸控裝置點擊時瀏覽器有時會
// 補送 mouseenter/mousemove 事件，用 hover+pointer:fine 判斷可以避免手機誤觸放大。
const lbHoverZoomEnabled=window.matchMedia("(hover:hover) and (pointer:fine)").matches;
lbStage.addEventListener("mouseenter",()=>{
  if(!lbHoverZoomEnabled)return;
  lbScale=2.35;
  applyZoom();
});
lbStage.addEventListener("mousemove",event=>{
  if(lbScale===1)return;
  const rect=lbStage.getBoundingClientRect();
  const x=((event.clientX-rect.left)/rect.width*100).toFixed(2);
  const y=((event.clientY-rect.top)/rect.height*100).toFixed(2);
  document.getElementById("lbImg").style.transformOrigin=`${x}% ${y}%`;
});
lbStage.addEventListener("mouseleave",resetZoom);
lbStage.addEventListener("wheel",event=>{
  event.preventDefault();
  lbScale=Math.max(1.5,Math.min(3.6,lbScale+(event.deltaY<0?.18:-.18)));
  applyZoom();
},{passive:false});
lbStage.addEventListener("touchstart",event=>{
  const touch=event.changedTouches[0];
  lbTouchStartX=touch.clientX;
  lbTouchStartY=touch.clientY;
},{passive:true});
lbStage.addEventListener("touchend",event=>{
  const touch=event.changedTouches[0];
  const deltaX=touch.clientX-lbTouchStartX;
  const deltaY=touch.clientY-lbTouchStartY;
  if(Math.abs(deltaX)>40&&Math.abs(deltaX)>Math.abs(deltaY))lbNav(deltaX<0?1:-1);
},{passive:true});
document.getElementById("lightbox").addEventListener("click",event=>{
  // 整頁式之後沒有「點旁邊的暗色背景關閉」：頁面兩側的空白只是版面留白，點到不該跳走

});
document.addEventListener("keydown",event=>{
  if(!document.getElementById("lightbox").classList.contains("open"))return;
  if(event.key==="Escape")closeLightbox();
  if(event.key==="ArrowRight")lbNav(1);
  if(event.key==="ArrowLeft")lbNav(-1);
});

function renderBuyInfo(){
  const items=buyInfoItems(state);
  const section=document.getElementById("buyInfo");
  const html=buyInfoListHtml(items);
  const list=document.getElementById("buyInfoList");
  if(list.innerHTML!==html)list.innerHTML=html; // 內容沒變就不重畫，展開中的不會被收起來
  section.hidden=!items.length;
  document.querySelectorAll(".nav-buy").forEach(li=>{li.hidden=!items.length}); // 選單的「購買須知」跟著這一區
  const lineUrl=state.contact?.lineUrl;
  document.getElementById("buyInfoAsk").hidden=!lineUrl;
}
function renderContact(){
  renderBuyInfo();
  const c=state.contact;
  const actionsHtml=contactActionsHtml(c);
  const actionsEl=document.getElementById("contactActions");
  if(actionsEl.innerHTML!==actionsHtml)actionsEl.innerHTML=actionsHtml;
  const contactHtml=contactItemsHtml(c);
  // 跟 applyPageText 同一個理由：內容沒變就不要重寫 innerHTML，避免砍掉重建
  // 文字節點造成不必要的重繪（開頁時 SWR 快取跟 Firebase 資料各跑一次 renderContact，
  // 兩次資料通常相同）。
  const contactItemsEl=document.getElementById("contactItems");
  if(contactItemsEl.innerHTML!==contactHtml)contactItemsEl.innerHTML=contactHtml;
}
document.querySelectorAll(".modal-overlay").forEach(overlay=>{
  overlay.addEventListener("click",event=>{if(event.target===overlay)overlay.classList.remove("open")});
});

// 商品卡片上的商品名稱是連結（給 Google、也能按 Ctrl／⌘ 開新分頁）：一般點擊不換頁，交給卡片打開商品
document.addEventListener("click",event=>{
  const link=event.target.closest(".product-card a[href^='/p/'], .p-card a[href^='/p/']");
  if(!link)return;
  if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey){event.stopPropagation();return}
  event.preventDefault();
},true);

/* ── 將函式掛到 window，讓 HTML onclick 可以呼叫（module 作用域限制）── */
Object.assign(window,{
  lbAskClick,
  toggleFavoritesPanel,
  closeLightbox,
  lbNav,
  closeModal,
  toggleLbFavorite,
  inquireAllFavorites,
  handleSearchInput,
  clearSearch,
  toggleMobileNav,
  copyFavoritesLink,
  resetFavoritesPreview,
});
window.__shopReady=true; // 商品頁的臨時關閉鈕（見 #lightbox 後面那段）交棒給上面的 closeLightbox
/* ── 啟動：先畫手邊有的資料，再換成 Firebase 的最新資料 ───────────────
   回訪客人：用上次存在這台瀏覽器的資料（stale-while-revalidate 快取）先畫。
   第一次來的客人：用 /data/site.json 先畫——每小時自動從 Firebase 匯出一次的商品資料
   （_tools/build-pages.mjs），放在網站本身的主機上，<head> 一開始就去抓，不用等 Firebase 的
   程式下載完、連線、查詢，商品通常可以早好幾秒出現。
   Firebase 的最新資料回來後，用同一套 render 函式原地換新，不會有額外閃爍或版面跳動；任何一步
   失敗（沒快取、site.json 還沒產生、格式壞掉、瀏覽器擋 localStorage）都直接跳過，照樣等 Firebase。 */
function paintSnapshot(meta,products){
  Object.assign(state,meta);
  applyPageText();
  applyLayoutVisibility();
  renderContact();
  state.products=products.map(p=>({...p,photos:p.photos||[p.img,p.img2].filter(Boolean)})).map(normalizeProduct);
  state.products.forEach((p,i)=>{if(typeof p.sortOrder!=="number")p.sortOrder=i});
  state.favorites=loadFavoritesLocal();
  renderCategories();
  renderProducts(false);
  renderPicks();
  renderCategoryTiles();
  renderHeroPhoto();
  renderFavorites();
}
// 從商品網址（/p/商品編號，或舊格式的 #product-商品編號）進來：有資料就打開那件商品
const routeProductId=productIdFromPath(location.pathname)||(location.hash.match(/^#product-(.+)$/)||[])[1]||null;
let routeHandled=!routeProductId;
function openRoutedProduct(final){
  if(routeHandled)return;
  // 資料到之前客人已經把商品頁關掉了（網址換回首頁）：不要再打開
  if(productIdFromPath(location.pathname)!==routeProductId&&location.hash!==`#product-${routeProductId}`){routeHandled=true;return}
  if(state.products.some(p=>p.id===routeProductId)){
    routeHandled=true;
    openProductDetail(routeProductId,null,{history:"replace"});
    return;
  }
  if(!final)return;
  routeHandled=true;
  // 連不上 Firebase 不代表商品下架了：不要亂提示（商品靜態頁的內容就留著給客人看）
  if(productsLoadFailed)return;
  // 商品已下架或網址打錯：跟收藏清單分享連結一樣提示一下，不然看起來像連結壞了
  closeLightbox({history:false});
  replaceView("/");
  toast("這件商品已下架或不存在了");
}
(async()=>{
  // 分享出去的心願清單短碼（例如 LINE 詢問訊息裡帶的網址）提早發出讀取請求，
  // 跟商品資料一起平行載入，不用等商品載完才開始等心願清單。
  const wishlistCodeMatch=location.hash.match(/^#w=(.+)$/);
  const wishlistPromise=wishlistCodeMatch?Storage.getWishlist(wishlistCodeMatch[1]):null;
  // meta 跟商品清單各自平行發出請求，但分開等待：meta 文件小、通常很快回來，
  // 不用被商品那個大集合拖住——meta 一到就先把首頁大圖／聯繫資訊等畫面渲染出來。
  // 最先發出去，下面先畫快取／site.json 的時候它們在背景跑。
  const metaPromise=Storage.getMeta();
  const productsPromise=Storage.getActiveProducts();
  let painted=false;
  try{
    const cached=JSON.parse(localStorage.getItem(SWR_CACHE_KEY)||"null");
    if(cached&&cached.savedAt&&Date.now()-cached.savedAt<SWR_CACHE_MAX_AGE_MS&&cached.meta&&cached.products&&cached.products.length){
      paintSnapshot(cached.meta,cached.products);
      painted=true;
    }
  }catch(e){}
  if(!painted&&window.__siteData){
    // Firebase 比 site.json 先回來就不用 site.json 了
    const snap=await Promise.race([window.__siteData,productsPromise.then(()=>null)]);
    try{
      if(snap&&snap.meta&&Array.isArray(snap.products)&&snap.products.length){
        paintSnapshot(snap.meta,snap.products);
        painted=true;
      }
    }catch(e){console.warn("site.json 格式不對，略過",e)}
  }
  if(painted)openRoutedProduct(false);

  const meta=await metaPromise;
  if(meta)Object.assign(state,meta);
  applyPageText();
  applyLayoutVisibility();
  renderContact();
  renderHeroPhoto();

  const products=await productsPromise;
  if(products&&products.length){
    state.products=products.map(p=>({...p,photos:p.photos||[p.img,p.img2].filter(Boolean)}));
    // Firebase 資料確實拿到了（meta 跟 products 都有），才更新 stale-while-revalidate 快取，
    // 避免把不完整的資料存起來，下次回訪反而看到殘缺畫面。
    if(meta){
      try{localStorage.setItem(SWR_CACHE_KEY,JSON.stringify({savedAt:Date.now(),meta,products}))}catch(e){}
    }
  }else if(!products){
    // 商品讀取失敗（網路斷線、Firebase 暫時不能用等）：畫面上沒有快取的商品時顯示「暫時載入不了」
    productsLoadFailed=true;
  }

  state.products=state.products.map(normalizeProduct);
  state.products.forEach((p,i)=>{if(typeof p.sortOrder!=="number")p.sortOrder=i});
  // 喜愛清單一律以「這台瀏覽器」的本機資料為準，不使用從雲端讀回來的舊資料
  state.favorites=loadFavoritesLocal();

  renderCategories();
  renderProducts(false);
  renderPicks();
  renderCategoryTiles();
  renderHeroPhoto(); // 沒設定自訂大圖的話，要等商品資料到齊才找得到可用照片，這裡再跑一次
  renderFavorites();
  // 商品頁已經用快取／site.json 的資料打開了：換成最新的資料再畫一次（照片、選的款式不動）；
  // 最新資料裡已經沒有這件商品（剛下架）就關掉
  if(isLightboxOpen()&&lbProduct){
    const fresh=state.products.find(p=>p.id===lbProduct.id);
    if(fresh){if(fresh!==lbProduct){lbProduct=fresh;lbRender()}}
    else if(products&&products.length){
      closeLightbox({history:false});
      replaceView("/");
      toast("這件商品已下架或不存在了");
    }
  }
  // 分享出去的商品連結／收藏清單連結（例如 LINE 詢問訊息裡帶的網址）直接開啟對應畫面
  const wishlistMatch=location.hash.match(/^#wishlist=(.+)$/);
  if(routeProductId){
    openRoutedProduct(true);
  }else if(wishlistCodeMatch){
    renderSharedWishlist(await wishlistPromise);
  }else if(wishlistMatch){
    // 舊格式的完整網址（短碼功能上線前分享出去的連結），繼續支援
    const ids=wishlistMatch[1].split(",").filter(Boolean);
    if(ids.length)renderSharedWishlist(ids);
  }
})();

/* ── siteFx：視覺 2.1 的互動（樣式在 index.html <style> 最後「視覺 2.1」那段）───────────
   跟上面的主程式只透過兩個事件溝通（不讀主程式的變數、不盯它的畫面）：
   hs:favcount（detail＝收藏件數）、hs:favpanel（detail＝收藏清單是否打開）。 */
(function siteFx(){
  const reduce=matchMedia("(prefers-reduced-motion: reduce)").matches;
  const el=(tag,cls,html)=>{const n=document.createElement(tag);n.className=cls;if(html)n.innerHTML=html;return n};
  // 1. 捲動進度條、回到頂端、手機底部的「已收藏 N 件」長條（有收藏才出現，點了打開收藏清單去一次詢問）
  const bar=document.body.appendChild(el("div","fx-progress"));
  const top=document.body.appendChild(el("button","fx-top",'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>'));
  top.type="button";top.setAttribute("aria-label","回到頂端");
  top.addEventListener("click",()=>scrollTo({top:0,behavior:reduce?"auto":"smooth"}));
  const line=document.body.appendChild(el("button","fx-line"));
  line.type="button";
  line.addEventListener("click",()=>document.querySelector(".favorites-fab")?.click());
  let favCount=0,favPanelOpen=false;
  const hero=document.getElementById("hero"),contact=document.getElementById("contact");
  let ticking=false;
  const onScroll=()=>{
    ticking=false;
    const max=document.documentElement.scrollHeight-innerHeight;
    bar.style.setProperty("--p",max>0?Math.min(1,scrollY/max):0);
    top.classList.toggle("show",scrollY>innerHeight*.8);
    const count=favCount;
    line.textContent=`已收藏 ${count} 件・一次問老闆 →`;
    const atContact=contact?contact.getBoundingClientRect().top<innerHeight-80:false;
    line.classList.toggle("show",count>0&&!atContact&&!favPanelOpen);
  };
  document.addEventListener("hs:favcount",e=>{favCount=e.detail;onScroll()});
  document.addEventListener("hs:favpanel",e=>{favPanelOpen=e.detail;onScroll()});
  addEventListener("scroll",()=>{if(!ticking){ticking=true;requestAnimationFrame(onScroll)}},{passive:true});
  addEventListener("resize",onScroll);onScroll();

  // 2. 首頁大圖跟著滑鼠微動
  const photo=document.getElementById("heroPhoto");
  if(hero&&photo&&!reduce&&matchMedia("(hover:hover)").matches){
    hero.addEventListener("pointermove",e=>{
      const r=hero.getBoundingClientRect();
      photo.style.setProperty("--mx",((e.clientX-r.left)/r.width-.5).toFixed(3));
      photo.style.setProperty("--my",((e.clientY-r.top)/r.height-.5).toFixed(3));
    });
    hero.addEventListener("pointerleave",()=>{photo.style.setProperty("--mx",0);photo.style.setProperty("--my",0)});
  }
})();
