/* 商品管理後台（manage.html）的主程式。
   後台拆成幾個檔案，都放在 admin/ 資料夾：
   - manage.css：後台的樣式
   - manage.js：這個檔案，登入、商品列表、商品編輯、網站設定、批次工具、報表、備份
   - image-tools.js：照片處理（Cloudinary 上傳、縮圖、白底置中、網址轉換）
   - rich-text.js：商品說明的文字編輯器
   - csv.js：CSV 匯出／匯入的格式
   - util.js：共用小工具
   改了哪個檔案，就把引用它的地方的 ?v= 數字加一（manage.html 引用 manage.css、manage.js；
   manage.js 引用其他幾個），不然瀏覽器可能還在用舊的快取。 */
import{initializeApp}from"https://www.gstatic.com/firebasejs/11.8.1/firebase-app.js";
import{getFirestore,doc,getDoc,setDoc,deleteDoc,collection,getDocs,writeBatch}from"https://www.gstatic.com/firebasejs/11.8.1/firebase-firestore.js";
import{getAuth,signInWithEmailAndPassword,signOut,onAuthStateChanged}from"https://www.gstatic.com/firebasejs/11.8.1/firebase-auth.js";
// 尺寸示意圖跟前台共用同一份（改了那個檔案要把 ?v= 加一，見檔案開頭說明）
import{DIM_FIGURES,dimFigureSvg,figureDimsOf,autoDimFigureKey,hasSeatHeight}from"../dim-figures.js?v=3";
// 商品說明的過濾、「前台順序」的排法跟前台用同一份規則（改了 shop-render.js 要把 ?v= 加一）
import{catalogOrderCompare}from"../shop-render.js?v=5";
import{escapeHTML}from"./util.js?v=1";
import{uploadToCloudinary,loadImage,PHOTO_TARGET_W,PHOTO_TARGET_H,SUBJECT_TARGET_FRACTION,detectSubjectBBox,resizeImageToUniform,resizeToThumb,isUrl,thumbFor,capOriginalDataUrl,resizeSquareImage,convertGdriveUrl,normalizePhotoUrl}from"./image-tools.js?v=1";
import{rteInit,richTextIsEmpty,sanitizeRichText}from"./rich-text.js?v=1";
import{CSV_HEADERS,csvEscapeCell,parseCSV}from"./csv.js?v=1";

const firebaseConfig={
  apiKey:"AIzaSyBssTXYLERqDDcuW62MkGxdydPR_hfMBrw",
  authDomain:"hsshop-10bd9.firebaseapp.com",
  projectId:"hsshop-10bd9",
  storageBucket:"hsshop-10bd9.firebasestorage.app",
  messagingSenderId:"693625648338",
  appId:"1:693625648338:web:7460e5aa1c5e9e55b1a90b"
};
const fbApp=initializeApp(firebaseConfig);
const db=getFirestore(fbApp);
const SITE_DOC="hsshop-10bd9";

/* ── 管理員登入（Firebase Authentication）───────────────────────
   用 try/catch 包起來：萬一 Authentication 服務端還沒設定好，
   只會讓登入功能顯示錯誤訊息，不會讓整份後台程式當掉。 */
let fbAuth=null;
try{
  fbAuth=getAuth(fbApp);
}catch(e){
  console.error("Firebase Auth 初始化失敗",e);
}
window.unlockGate=async function(){
  const errEl=document.getElementById("gateError");
  errEl.style.display="none";
  if(!fbAuth){
    errEl.textContent="登入功能目前無法使用，請確認 Firebase Authentication 是否已啟用。";
    errEl.style.display="block";
    return;
  }
  const email=document.getElementById("gateEmail").value.trim();
  const pw=document.getElementById("gatePw").value;
  if(!email||!pw){
    errEl.textContent="請輸入 Email 與密碼";
    errEl.style.display="block";
    return;
  }
  try{
    await signInWithEmailAndPassword(fbAuth,email,pw);
    // 登入成功後的畫面切換交給 onAuthStateChanged 統一處理
  }catch(e){
    console.warn("登入失敗",e);
    errEl.textContent="登入失敗，請確認帳號密碼是否正確";
    errEl.style.display="block";
    document.getElementById("gatePw").select();
  }
};
window.logoutGate=function(){
  if(fbAuth)signOut(fbAuth).catch(()=>{});
};
if(fbAuth){
  onAuthStateChanged(fbAuth,user=>{
    if(user){
      document.getElementById("gate").style.display="none";
      document.getElementById("app").style.display="block";
      boot();
    }else{
      document.getElementById("gate").style.display="flex";
      document.getElementById("app").style.display="none";
    }
  });
}else{
  // Auth 服務初始化失敗時，至少讓登入畫面顯示錯誤訊息，而不是整頁空白
  document.addEventListener("DOMContentLoaded",()=>{
    const errEl=document.getElementById("gateError");
    if(errEl){
      errEl.textContent="登入功能目前無法使用，請確認 Firebase Authentication 是否已啟用。";
      errEl.style.display="block";
    }
  });
}

let catalog=[];
let products=[];
// 商品狀態：active＝上架中、archived＝封存（前台看不到）、trashed＝在垃圾桶（30 天後自動永久刪除）
const TRASH_DAYS=30;
const isLive=p=>p.status==="active";
function trashDaysLeft(p){return Math.max(0,Math.ceil(((p.trashedAt||0)+TRASH_DAYS*864e5-Date.now())/864e5))}
function updateTotalCount(){document.getElementById("totalCount").textContent=`共 ${products.filter(isLive).length} 個上架商品`}
let contact={};
let pageText={};
let layout={};
let metaRaw={};
const DEFAULT_TAG_DEFS=[
  {key:"sale",label:"特價促銷",color:"#b84236"},
  {key:"limited",label:"限量",color:"#8c491a"},
  {key:"preorder",label:"預購",color:"#4d5d6b"},
  {key:"new",label:"新品",color:"#5b6746"},
  {key:"bestseller",label:"熱銷",color:"#905229"},
  {key:"multicolor",label:"多色",color:"#201e1d"},
  {key:"custom",label:"可客製化",color:"#696255"},
  {key:"madeintw",label:"台灣製造",color:"#645c50"},
];
let tagDefs=[];
let currentFilter="all";
let sortKey="name";
let sortDir=1;
let pageSize="all"; // "10"|"20"|"50"|"100"|"all"
let currentPage=1;
let lastFilterSignature="";
window.setPageSize=function(value){
  pageSize=value;
  currentPage=1;
  renderTable();
};
window.goToPage=function(page){
  currentPage=page;
  renderTable();
};
let catFilterMain=null;
let catFilterSub=null;
let dragModeEnabled=false;
let quickCatMode=false;
let quickCatSelected=new Set();
let openMainCats=new Set();
let strokeCollator;
try{strokeCollator=new Intl.Collator("zh-Hant-u-co-stroke",{numeric:true})}catch(e){strokeCollator=new Intl.Collator("zh-Hant")}
function toast(msg,dur=2600){
  const el=document.getElementById("toast");
  el.textContent=msg;
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer=setTimeout(()=>el.classList.remove("show"),dur);
}

function getMainCat(id){return catalog.find(c=>c.id===id)}
function getMainName(id){return getMainCat(id)?.name||(id?id:"待分類")}
function getSubName(mainId,subId){return (getMainCat(mainId)?.subs||[]).find(s=>s.id===subId)?.name||""}
function categoryLabel(p){
  const sub=getSubName(p.mainCat,p.subCat);
  const main=getMainName(p.mainCat);
  return sub?`${main} / ${sub}`:main;
}
// 「尺寸洽詢」「洽詢」這種字不算尺寸（跟前台、尺寸示意圖的認定一樣）
const isSizeValue=v=>{const t=String(v??"").trim();return !!t&&!/洽詢/.test(t)};
function hasSize(p){
  const d=p.dimensions||{};
  if([d.width,d.depth,d.height].some(isSizeValue))return true;
  // 規格列有填（例如「層板 寬 24 × 深 35」）也算；舊格式的規格列是 {label,value}
  if((p.specs||[]).some(s=>s&&typeof s==="object"&&("part" in s?[s.w,s.d,s.h].some(isSizeValue):isSizeValue(s.value))))return true;
  // 很早以前只有一段尺寸文字、沒有寬深高的舊商品
  return ![d.width,d.depth,d.height].some(v=>String(v??"").trim())&&isSizeValue(p.size);
}
const sorters={
  // 「自訂順序」跟前台的排法一樣：照「分類管理」排好的分類順序（主分類、再子分類）分組，
  // 同一個子分類內才用 sortOrder 排——不同分類的商品不會在「全部」畫面裡穿插。
  order:(a,b)=>catalogOrderCompare(catalog)(a,b),
  name:(a,b)=>strokeCollator.compare(a.name||"",b.name||""),
  cat:(a,b)=>strokeCollator.compare(categoryLabel(a),categoryLabel(b)),
  size:(a,b)=>Number(hasSize(b))-Number(hasSize(a)),
  photos:(a,b)=>(b.photoCount??(b.photos||[]).filter(Boolean).length)-(a.photoCount??(a.photos||[]).filter(Boolean).length),
  status:(a,b)=>(a.status||"").localeCompare(b.status||"")
};
function sortCompare(a,b){return sorters[sortKey]?sorters[sortKey](a,b):0}
async function syncOrderToFrontend(){
  const btn=document.getElementById("syncBtn");
  const active=products.filter(isLive);
  const archived=products.filter(p=>p.status==="archived"); // 垃圾桶裡的商品不參與排序
  const sorted=active.slice().sort((a,b)=>sortDir*sortCompare(a,b));
  if(!confirm(`將依「${sortLabel()}」重新排列前台商品的顯示順序（每個分類裡面照這個順序排），共 ${sorted.length} 個商品。確定要套用嗎？`))return;
  btn.disabled=true;
  btn.textContent="同步中…";
  try{
    const all=[...sorted,...archived];
    all.forEach((p,i)=>p.sortOrder=i);
    await patchProducts(all,["sortOrder"]);
    toast("已套用到前台，前台重新整理後就會是這個順序 ☁️");
  }catch(e){
    toast("同步失敗："+(e.message||String(e)),4000);
  }
  btn.disabled=false;
  renderTable();
}
// 目前表格照哪一欄排（給「依○○重排前台順序」按鈕用）
function sortLabel(){
  const th=document.querySelector(`thead th[data-sort="${sortKey}"]`);
  return (th?.textContent||"商品名稱").replace(/[▲▼↑↓]/g,"").trim();
}
// 拖曳調整順序是拖完就存好；這顆按鈕是「照目前排序欄位一次重排」，表格本身就是自訂順序時不用顯示
function updateSyncBtn(){
  const btn=document.getElementById("syncBtn");
  if(!btn||btn.disabled)return;
  btn.style.display=sortKey==="order"?"none":"";
  btn.textContent=`依「${sortLabel()}」重排前台順序 →`;
}
window.syncOrderToFrontend=syncOrderToFrontend;

/* ── 儲存 catalog／contact（存在 sitedata/{SITE_DOC} 主文件）───── */
async function saveMeta(){
  metaRaw.catalog=catalog;
  metaRaw.contact=contact;
  metaRaw.pageText=pageText;
  metaRaw.layout=layout;
  metaRaw.tagDefs=tagDefs;
  const ref=doc(db,"sitedata",SITE_DOC);
  try{
    // 網站設定也一樣：別的裝置剛存過（分類、聯繫資訊、首頁版面…），先問再蓋
    let remote=null;
    try{remote=await getDoc(ref)}catch(e){console.warn("沒辦法先檢查網站設定有沒有被別的裝置改過",e)}
    if(remote?.exists()&&(remote.data().updatedAt??null)!==(metaRaw.updatedAt??null)){
      const when=remote.data().updatedAt?`（${clockText(remote.data().updatedAt)}）`:"";
      if(!confirm(`網站設定（分類、標籤、聯繫資訊、頁面文字、購買須知、首頁版面）剛剛在別的裝置或別的分頁被修改過${when}，這個畫面上的還是舊的內容。\n\n按「確定」：用你現在的版本蓋掉。\n按「取消」：先不要存，重新整理頁面看最新的內容。`))throw new SaveCancelled();
    }
    const stamp=Date.now();
    await setDoc(ref,{...metaRaw,updatedAt:stamp});
    metaRaw.updatedAt=stamp;
    return true;
  }catch(e){
    toast(saveErrorText(e,"儲存失敗"),e.cancelled?7000:4000);
    return false;
  }
}
window.saveMeta=saveMeta;

/* ── 分類管理（新增／改名／排序／隱藏／刪除，主分類與子分類）───── */
function openCategoryManage(){
  renderCatMgrList();
  openModal("catMgrModal");
}
window.openCategoryManage=openCategoryManage;
async function closeCategoryManage(){
  closeModal("catMgrModal");
  renderSidebar();
  renderCatSelect();
  if(await saveMeta())toast("分類已儲存 ☁️"); // 存不進去時 saveMeta 自己會顯示原因
}
window.closeCategoryManage=closeCategoryManage;
function addMainCategoryInline(){
  const name=(prompt("請輸入新主分類名稱：")||"").trim();
  if(!name)return;
  catalog.push({id:"cat-"+uid(),name,subs:[],hidden:false});
  renderCatMgrList();
  toast("主分類已新增");
}
window.addMainCategoryInline=addMainCategoryInline;
function renameMainCategory(mainId,value){
  const cat=getMainCat(mainId);
  if(cat)cat.name=value;
}
function renameSubCategory(mainId,subId,value){
  const main=getMainCat(mainId);
  const sub=main?.subs?.find(s=>s.id===subId);
  if(sub)sub.name=value;
}
function toggleMainHidden(mainId){
  const cat=getMainCat(mainId);
  if(cat)cat.hidden=!cat.hidden;
  renderCatMgrList();
}
function toggleSubHidden(mainId,subId){
  const main=getMainCat(mainId);
  const sub=main?.subs?.find(s=>s.id===subId);
  if(sub)sub.hidden=!sub.hidden;
  renderCatMgrList();
}
function addSubCategoryInline(mainId){
  const main=getMainCat(mainId);
  if(!main)return;
  const name=(prompt("請輸入新子分類名稱：")||"").trim();
  if(!name)return;
  main.subs=main.subs||[];
  main.subs.push({id:"sub-"+uid(),name,hidden:false});
  renderCatMgrList();
  toast("子分類已新增");
}
let pendingCatDelete=null;
function deleteMainCategoryRequest(mainId){
  const cat=getMainCat(mainId);
  if(!cat)return;
  const affected=products.filter(p=>p.mainCat===mainId&&isLive(p));
  if(!affected.length){
    if(!confirm(`確定要刪除主分類「${cat.name}」嗎？`))return;
    catalog=catalog.filter(c=>c.id!==mainId);
    renderCatMgrList();
    toast("主分類已刪除");
    return;
  }
  pendingCatDelete={kind:"main",mainId};
  document.getElementById("catDeleteTitle").textContent=`刪除主分類「${cat.name}」`;
  document.getElementById("catDeleteDesc").textContent=`此分類底下還有 ${affected.length} 件商品，請選擇要如何處理這些商品：`;
  const targetSel=document.getElementById("catDelTarget");
  targetSel.innerHTML=catalog.filter(c=>c.id!==mainId).map(c=>`<option value="${escapeHTML(c.id)}">${escapeHTML(c.name)}</option>`).join("");
  document.getElementById("catDelMove").checked=true;
  openModal("catDeleteModal");
}
function deleteSubCategoryRequest(mainId,subId){
  const main=getMainCat(mainId);
  const sub=main?.subs?.find(s=>s.id===subId);
  if(!main||!sub)return;
  const affected=products.filter(p=>p.mainCat===mainId&&p.subCat===subId&&isLive(p));
  if(!affected.length){
    if(!confirm(`確定要刪除子分類「${sub.name}」嗎？`))return;
    main.subs=main.subs.filter(s=>s.id!==subId);
    renderCatMgrList();
    toast("子分類已刪除");
    return;
  }
  pendingCatDelete={kind:"sub",mainId,subId};
  document.getElementById("catDeleteTitle").textContent=`刪除子分類「${sub.name}」`;
  document.getElementById("catDeleteDesc").textContent=`此子分類底下還有 ${affected.length} 件商品，請選擇要如何處理這些商品：`;
  const targetSel=document.getElementById("catDelTarget");
  const otherSubs=(main.subs||[]).filter(s=>s.id!==subId);
  targetSel.innerHTML=`<option value="">（不指定子分類）</option>`+otherSubs.map(s=>`<option value="${escapeHTML(s.id)}">${escapeHTML(s.name)}</option>`).join("");
  document.getElementById("catDelMove").checked=true;
  openModal("catDeleteModal");
}
window.deleteMainCategoryRequest=deleteMainCategoryRequest;
window.deleteSubCategoryRequest=deleteSubCategoryRequest;
// 分類被刪掉、選擇「封存商品」時：垃圾桶裡的商品繼續留在垃圾桶，只是之後救回來會回到封存
function archiveForDeletedCategory(p){
  if(p.status==="trashed")p.trashedFrom="archived";
  else p.status="archived";
}
function confirmCatDelete(){
  if(!pendingCatDelete)return;
  const action=document.querySelector('input[name="catDelAction"]:checked').value;
  const targetId=document.getElementById("catDelTarget").value;
  let catAffected=[];
  if(pendingCatDelete.kind==="main"){
    const {mainId}=pendingCatDelete;
    const affected=products.filter(p=>p.mainCat===mainId);
    if(action==="move"){
      if(!targetId){toast("請選擇要移動到的分類");return}
      affected.forEach(p=>{p.mainCat=targetId;p.subCat=null});
    }else{
      affected.forEach(archiveForDeletedCategory);
    }
    catAffected=affected;
    catalog=catalog.filter(c=>c.id!==mainId);
  }else{
    const {mainId,subId}=pendingCatDelete;
    const main=getMainCat(mainId);
    const affected=products.filter(p=>p.mainCat===mainId&&p.subCat===subId);
    if(action==="move"){
      affected.forEach(p=>{p.subCat=targetId||null});
    }else{
      affected.forEach(archiveForDeletedCategory);
    }
    catAffected=affected;
    if(main)main.subs=main.subs.filter(s=>s.id!==subId);
  }
  // 受影響商品需要同步寫回 Firestore（分類異動／封存）
  (async()=>{
    try{
      // 只寫受影響商品的分類／狀態欄位，不會蓋到別的裝置剛改的其他內容
      if(catAffected.length)await patchProducts(catAffected,["mainCat","subCat","status","trashedFrom"]);
    }catch(e){
      toast("商品分類更新寫入失敗："+(e.message||String(e)),4000);
    }
  })();
  pendingCatDelete=null;
  closeModal("catDeleteModal");
  renderCatMgrList();
  renderTable();
  toast("分類已刪除，商品已處理完成");
}
window.confirmCatDelete=confirmCatDelete;
function renderCatMgrList(){
  const wrap=document.getElementById("catmgrList");
  if(!wrap)return;
  wrap.innerHTML="";
  catalog.forEach((cat)=>{
    const row=document.createElement("div");
    row.className="catmgr-main-row";
    row.draggable=true;
    row.dataset.catId=cat.id;
    const top=document.createElement("div");
    top.className="catmgr-row-top";
    top.innerHTML=`
      <span class="drag-handle" title="拖曳調整順序">⠿</span>
      <input type="text" value="${escapeHTML(cat.name)}">
      <button class="catmgr-icon-btn${cat.hidden?" on":""}" title="${cat.hidden?"目前對顧客隱藏，點擊改為顯示":"目前顧客可見，點擊隱藏"}">${cat.hidden?"🙈":"👁"}</button>
      <button class="catmgr-icon-btn danger" title="刪除主分類">🗑</button>
    `;
    const [,nameInput,hideBtn,delBtn]=top.children; // 第一個是拖曳把手，不用綁事件
    nameInput.addEventListener("input",()=>renameMainCategory(cat.id,nameInput.value));
    hideBtn.onclick=()=>toggleMainHidden(cat.id);
    delBtn.onclick=()=>deleteMainCategoryRequest(cat.id);
    row.appendChild(top);
    const subsWrap=document.createElement("div");
    subsWrap.className="catmgr-subs";
    subsWrap.dataset.mainId=cat.id;
    (cat.subs||[]).forEach((sub)=>{
      const subRow=document.createElement("div");
      subRow.className="catmgr-sub-row";
      subRow.draggable=true;
      subRow.dataset.mainId=cat.id;
      subRow.dataset.subId=sub.id;
      subRow.innerHTML=`
        <span class="drag-handle" title="拖曳調整順序">⠿</span>
        <input type="text" value="${escapeHTML(sub.name)}">
        <button class="catmgr-icon-btn${sub.hidden?" on":""}" title="${sub.hidden?"目前對顧客隱藏，點擊改為顯示":"目前顧客可見，點擊隱藏"}">${sub.hidden?"🙈":"👁"}</button>
        <button class="catmgr-icon-btn danger" title="刪除子分類">🗑</button>
      `;
      const [,sName,sHide,sDel]=subRow.children;
      sName.addEventListener("input",()=>renameSubCategory(cat.id,sub.id,sName.value));
      sHide.onclick=()=>toggleSubHidden(cat.id,sub.id);
      sDel.onclick=()=>deleteSubCategoryRequest(cat.id,sub.id);
      subsWrap.appendChild(subRow);
    });
    const addSubBtn=document.createElement("button");
    addSubBtn.className="catmgr-add-sub";
    addSubBtn.textContent="＋ 新增子分類";
    addSubBtn.onclick=()=>addSubCategoryInline(cat.id);
    subsWrap.appendChild(addSubBtn);
    row.appendChild(subsWrap);
    wrap.appendChild(row);
  });
}
/* ── 分類管理：主分類拖曳排序 ───────────────────────────────────── */
let dragMainCatId=null;
let dragSubKey=null;
const catmgrListEl=document.getElementById("catmgrList");
catmgrListEl.addEventListener("dragstart",e=>{
  // 子分類列自己有獨立的拖曳處理（見下方），這裡只處理主分類列；
  // 用 stopPropagation 避免子分類的拖曳事件被主分類列誤判成拖主分類。
  const subRow=e.target.closest(".catmgr-sub-row");
  if(subRow){
    dragSubKey={mainId:subRow.dataset.mainId,subId:subRow.dataset.subId};
    subRow.classList.add("dragging");
    e.stopPropagation();
    return;
  }
  const row=e.target.closest(".catmgr-main-row");
  if(!row)return;
  dragMainCatId=row.dataset.catId;
  row.classList.add("dragging");
});
catmgrListEl.addEventListener("dragend",e=>{
  const subRow=e.target.closest(".catmgr-sub-row");
  if(subRow){
    catmgrListEl.querySelectorAll(".catmgr-sub-row").forEach(r=>r.classList.remove("dragging","drag-over"));
    dragSubKey=null;
    return;
  }
  catmgrListEl.querySelectorAll(".catmgr-main-row").forEach(r=>r.classList.remove("dragging","drag-over"));
  dragMainCatId=null;
});
catmgrListEl.addEventListener("dragover",e=>{
  const subRow=e.target.closest(".catmgr-sub-row");
  if(subRow&&dragSubKey){
    if(subRow.dataset.mainId!==dragSubKey.mainId||subRow.dataset.subId===dragSubKey.subId)return;
    e.preventDefault();
    e.stopPropagation();
    subRow.classList.add("drag-over");
    return;
  }
  const row=e.target.closest(".catmgr-main-row");
  if(!row||!dragMainCatId||row.dataset.catId===dragMainCatId)return;
  e.preventDefault();
  row.classList.add("drag-over");
});
catmgrListEl.addEventListener("dragleave",e=>{
  const subRow=e.target.closest(".catmgr-sub-row");
  if(subRow){subRow.classList.remove("drag-over");return}
  const row=e.target.closest(".catmgr-main-row");
  if(row)row.classList.remove("drag-over");
});
catmgrListEl.addEventListener("drop",e=>{
  const subRow=e.target.closest(".catmgr-sub-row");
  if(subRow&&dragSubKey){
    e.preventDefault();
    e.stopPropagation();
    subRow.classList.remove("drag-over");
    const targetMainId=subRow.dataset.mainId;
    const targetSubId=subRow.dataset.subId;
    const srcKey=dragSubKey;
    dragSubKey=null;
    if(targetMainId!==srcKey.mainId||targetSubId===srcKey.subId)return;
    const main=getMainCat(targetMainId);
    if(!main||!main.subs)return;
    const srcIdx=main.subs.findIndex(s=>s.id===srcKey.subId);
    const targetIdx=main.subs.findIndex(s=>s.id===targetSubId);
    if(srcIdx<0||targetIdx<0)return;
    const [moved]=main.subs.splice(srcIdx,1);
    main.subs.splice(targetIdx,0,moved);
    renderCatMgrList();
    return;
  }
  const row=e.target.closest(".catmgr-main-row");
  if(!row||!dragMainCatId)return;
  e.preventDefault();
  row.classList.remove("drag-over");
  const targetId=row.dataset.catId;
  const srcId=dragMainCatId;
  dragMainCatId=null;
  if(targetId===srcId)return;
  const srcIdx=catalog.findIndex(c=>c.id===srcId);
  const targetIdx=catalog.findIndex(c=>c.id===targetId);
  if(srcIdx<0||targetIdx<0)return;
  const [moved]=catalog.splice(srcIdx,1);
  catalog.splice(targetIdx,0,moved);
  renderCatMgrList();
});

/* ── 聯繫資訊 ─────────────────────────────────────────────────── */
function openContactManage(){
  document.getElementById("cAddr").value=contact.addr||"";
  document.getElementById("cPhone").value=contact.phone||"";
  document.getElementById("cLine").value=contact.line||"";
  document.getElementById("cHours").value=contact.hours||"";
  document.getElementById("cEmail").value=contact.email||"";
  document.getElementById("cFb").value=contact.fbUrl||"";
  document.getElementById("cLineUrl").value=contact.lineUrl||"";
  document.getElementById("cMapUrl").value=contact.mapUrl||"";
  openModal("contactModal");
}
window.openContactManage=openContactManage;
async function saveContactManage(){
  contact={
    addr:document.getElementById("cAddr").value,
    phone:document.getElementById("cPhone").value,
    line:document.getElementById("cLine").value,
    hours:document.getElementById("cHours").value,
    email:document.getElementById("cEmail").value,
    fbUrl:document.getElementById("cFb").value,
    lineUrl:document.getElementById("cLineUrl").value,
    mapUrl:document.getElementById("cMapUrl").value
  };
  if(!await saveMeta())return;
  closeModal("contactModal");
  toast("聯繫資訊已更新 ☁️");
}
window.saveContactManage=saveContactManage;

/* ── 頁面文字（首頁標語等） ───────────────────────────────────── */
const PAGE_TEXT_FIELDS=["heroTag","heroTitle","heroSub","heroDesc","heroCta","contactTitle","contactSub"];
const PAGE_TEXT_INPUT_IDS={
  heroTag:"ptHeroTag",heroTitle:"ptHeroTitle",heroSub:"ptHeroSub",heroDesc:"ptHeroDesc",heroCta:"ptHeroCta",
  contactTitle:"ptContactTitle",contactSub:"ptContactSub"
};
function openPageTextManage(){
  PAGE_TEXT_FIELDS.forEach(key=>{
    document.getElementById(PAGE_TEXT_INPUT_IDS[key]).value=pageText[key]||"";
  });
  openModal("pageTextModal");
}
window.openPageTextManage=openPageTextManage;
async function savePageTextManage(){
  const next={};
  PAGE_TEXT_FIELDS.forEach(key=>{
    const value=document.getElementById(PAGE_TEXT_INPUT_IDS[key]).value.trim();
    if(value)next[key]=value;
  });
  pageText=next;
  if(!await saveMeta())return;
  closeModal("pageTextModal");
  toast("頁面文字已更新 ☁️");
}
window.savePageTextManage=savePageTextManage;

/* ── 購買須知（存在主文件的 buyInfo：[{q:標題,a:內容}]）─────────────
   前台首頁「聯繫我們」上面一整區，選單也有連結；商品頁不放 */
let buyInfoWorking=[];
// 運費每件、每個地點都不一樣，預設請客人直接來問；付款方式要店家自己填
const BUY_INFO_TEMPLATE=[
  {q:"運送方式與運費",a:"運費依送貨地點與商品大小而定，歡迎透過 LINE 或電話直接詢問，我們會盡快回覆報價。"},
  {q:"付款方式",a:""},
  {q:"送貨範圍與時間",a:""},
  {q:"安裝、組裝",a:""},
  {q:"可以到門市看實品嗎？",a:""}
];
function renderBuyInfoRows(){
  const wrap=document.getElementById("buyInfoRows");
  if(!buyInfoWorking.length){wrap.innerHTML='<div class="catmgr-hint">還沒有任何一項，按下面的按鈕新增。</div>';return}
  wrap.innerHTML=buyInfoWorking.map((it,i)=>`
    <div class="buyinfo-row">
      <input type="text" data-k="q" data-i="${i}" placeholder="標題，例如：運送方式與運費" value="${escapeHTML(it.q||"")}">
      <textarea data-k="a" data-i="${i}" placeholder="內容，例如：台北市區免運，其他地區依距離報價…">${escapeHTML(it.a||"")}</textarea>
      <div class="buyinfo-row-tools">
        <button type="button" onclick="moveBuyInfoRow(${i},-1)" ${i===0?"disabled":""}>↑ 上移</button>
        <button type="button" onclick="moveBuyInfoRow(${i},1)" ${i===buyInfoWorking.length-1?"disabled":""}>↓ 下移</button>
        <button type="button" onclick="removeBuyInfoRow(${i})">刪除</button>
      </div>
    </div>`).join("");
  wrap.querySelectorAll("[data-k]").forEach(el=>el.addEventListener("input",()=>{buyInfoWorking[Number(el.dataset.i)][el.dataset.k]=el.value}));
}
function openBuyInfoManage(){
  buyInfoWorking=(Array.isArray(metaRaw.buyInfo)?metaRaw.buyInfo:[]).map(it=>({q:String(it?.q||""),a:String(it?.a||"")}));
  renderBuyInfoRows();
  openModal("buyInfoModal");
}
window.openBuyInfoManage=openBuyInfoManage;
window.addBuyInfoRow=function(){buyInfoWorking.push({q:"",a:""});renderBuyInfoRows();document.querySelector("#buyInfoRows .buyinfo-row:last-child input")?.focus()};
window.removeBuyInfoRow=function(i){
  const it=buyInfoWorking[i];
  if((it.q.trim()||it.a.trim())&&!confirm(`刪除「${it.q.trim()||"（沒有標題）"}」這一項？`))return;
  buyInfoWorking.splice(i,1);renderBuyInfoRows();
};
window.moveBuyInfoRow=function(i,dir){
  const j=i+dir;
  if(j<0||j>=buyInfoWorking.length)return;
  [buyInfoWorking[i],buyInfoWorking[j]]=[buyInfoWorking[j],buyInfoWorking[i]];
  renderBuyInfoRows();
};
// 只有運費附上「請直接詢問」的建議文字，其他內容每家店不一樣，一定要店家自己填，不能幫忙猜
window.fillBuyInfoTemplate=function(){
  const have=new Set(buyInfoWorking.map(it=>it.q.trim()));
  BUY_INFO_TEMPLATE.filter(it=>!have.has(it.q)).forEach(it=>buyInfoWorking.push({...it}));
  renderBuyInfoRows();
};
async function saveBuyInfoManage(){
  const next=buyInfoWorking.map(it=>({q:it.q.trim(),a:it.a.trim()})).filter(it=>it.q||it.a);
  const half=next.filter(it=>!it.q||!it.a).length;
  if(half&&!confirm(`有 ${half} 項只填了標題或內容，那幾項前台不會顯示。要先存起來嗎？`))return;
  const prev=metaRaw.buyInfo;
  metaRaw.buyInfo=next;
  if(!await saveMeta()){metaRaw.buyInfo=prev;return}
  closeModal("buyInfoModal");
  toast("購買須知已更新 ☁️");
}
window.saveBuyInfoManage=saveBuyInfoManage;

/* ── 首頁版面設定：顯示/隱藏區塊、首頁大圖、分類磚縮圖、手動挑選本月選品 ───── */
let layoutHeroImage="";
let heroUploading=false;
let layoutCatImages={};
let layoutPicksIds=[];
function openLayoutSettings(){
  document.getElementById("layoutShowPicks").checked=layout.showPicks!==false;
  document.getElementById("layoutShowCatTiles").checked=layout.showCatTiles!==false;
  layoutHeroImage=layout.heroImage||"";
  layoutCatImages={};
  catalog.forEach(c=>{layoutCatImages[c.id]=c.image||""});
  layoutPicksIds=(layout.picksProductIds||[]).filter(id=>products.some(p=>p.id===id));
  document.getElementById("picksSearchInput").value="";
  renderHeroImageSlot();
  renderCatTileImageSlots();
  renderPicksSelected();
  renderPicksCandidates();
  openModal("layoutModal");
}
window.openLayoutSettings=openLayoutSettings;
function renderHeroImageSlot(){
  const wrap=document.getElementById("heroImageSlotWrap");
  wrap.innerHTML=`
    <div class="photo-slot${layoutHeroImage?" has-img":""}${heroUploading?" is-uploading":""}">
      ${layoutHeroImage?`<img class="slot-img" src="${normalizePhotoUrl(layoutHeroImage)}">`:""}
      <div class="slot-overlay">${layoutHeroImage?"更換":"上傳照片"}</div>
      <input type="file" class="slot-file-input" accept="image/*" onchange="handleHeroImageFile(event)">
      ${layoutHeroImage?`<button class="slot-del" onclick="event.stopPropagation();clearHeroImage()">×</button>`:""}
      ${heroUploading?`<div class="slot-uploading-badge">上傳中…</div>`:""}
    </div>
  `;
}
let heroUploadToken=0;
function handleHeroImageFile(event){
  const file=event.target.files[0];
  if(!file)return;
  event.target.value=""; // 清空，方便下次選同一個檔案也會觸發 change
  // 每次選檔都換一個新代號，兩條非同步流程（本機縮圖／Cloudinary 上傳）
  // 寫回 layoutHeroImage 前都要確認代號沒變，避免其中一個用比較舊的結果
  // 蓋掉另一個已經算好的新結果。
  const token=++heroUploadToken;
  const reader=new FileReader();
  reader.onload=async e=>{
    const preview=await resizeSquareImage(e.target.result,900,0.85);
    if(heroUploadToken!==token)return;
    layoutHeroImage=preview;
    renderHeroImageSlot();
  };
  reader.readAsDataURL(file);
  // 跟商品照片同一套做法：本機先產生預覽版本讓畫面立刻有反應，背景同時
  // 把原始檔上傳到 Cloudinary，成功就換成網址（存進 Firestore 的網站設定
  // 才不會被一張大圖塞爆）；失敗就維持本機版本，不影響存檔。
  heroUploading=true;
  renderHeroImageSlot();
  uploadToCloudinary(file).then(url=>{
    if(heroUploadToken!==token)return;
    layoutHeroImage=url;
  }).catch(e=>{
    console.warn("首頁大圖上傳 Cloudinary 失敗，改用本機暫存",e);
    if(heroUploadToken===token)toast("圖床上傳失敗，已改用本機暫存，建議稍後重新上傳這張照片",4000);
  }).finally(()=>{
    if(heroUploadToken!==token)return;
    heroUploading=false;
    renderHeroImageSlot();
  });
}
window.handleHeroImageFile=handleHeroImageFile;
function clearHeroImage(){layoutHeroImage="";renderHeroImageSlot()}
window.clearHeroImage=clearHeroImage;
function renderCatTileImageSlots(){
  const wrap=document.getElementById("catTileImagesWrap");
  const visible=catalog.filter(c=>!c.hidden);
  if(!visible.length){wrap.innerHTML='<div class="catmgr-hint">目前沒有分類</div>';return}
  wrap.innerHTML=visible.map(c=>{
    const img=layoutCatImages[c.id]||"";
    return `
      <div>
        <div class="photo-slot${img?" has-img":""}">
          ${img?`<img class="slot-img" src="${img}">`:""}
          <div class="slot-overlay">${img?"更換":"上傳"}</div>
          <input type="file" class="slot-file-input" accept="image/*" onchange="handleCatImageFile('${c.id}',event)">
          ${img?`<button class="slot-del" onclick="event.stopPropagation();clearCatImage('${c.id}')">×</button>`:""}
        </div>
        <div style="font-size:11px;color:var(--muted);text-align:center;margin-top:4px">${escapeHTML(c.name)}</div>
      </div>
    `;
  }).join("");
}
function handleCatImageFile(catId,event){
  const file=event.target.files[0];
  if(!file)return;
  const reader=new FileReader();
  reader.onload=async e=>{
    layoutCatImages[catId]=await resizeSquareImage(e.target.result,320,0.82);
    renderCatTileImageSlots();
  };
  reader.readAsDataURL(file);
}
window.handleCatImageFile=handleCatImageFile;
function clearCatImage(catId){layoutCatImages[catId]="";renderCatTileImageSlots()}
window.clearCatImage=clearCatImage;
function renderPicksSelected(){
  const wrap=document.getElementById("picksSelectedList");
  if(!layoutPicksIds.length){
    wrap.innerHTML='<p class="catmgr-hint">尚未手動挑選，目前會自動抓排序最前面的 4 件商品。</p>';
    return;
  }
  wrap.innerHTML=layoutPicksIds.map((id,i)=>{
    const p=products.find(x=>x.id===id);
    if(!p)return "";
    return `
      <div style="display:flex;align-items:center;gap:8px;border:1px solid var(--line);border-radius:8px;padding:6px 8px">
        <span style="flex:1;font-size:13px">${escapeHTML(p.name)}${isLive(p)?"":` <span style="color:var(--danger)">（${p.status==="trashed"?"在垃圾桶":"已封存"}，前台不會顯示）</span>`}</span>
        <button onclick="movePick(${i},-1)" ${i===0?"disabled":""} title="往前移" style="border:0;background:transparent;cursor:pointer;opacity:${i===0?".35":"1"}">▲</button>
        <button onclick="movePick(${i},1)" ${i===layoutPicksIds.length-1?"disabled":""} title="往後移" style="border:0;background:transparent;cursor:pointer;opacity:${i===layoutPicksIds.length-1?".35":"1"}">▼</button>
        <button onclick="removePick('${id}')" title="移除" style="border:0;background:transparent;color:var(--danger);cursor:pointer">×</button>
      </div>
    `;
  }).join("");
}
function movePick(index,dir){
  const target=index+dir;
  if(target<0||target>=layoutPicksIds.length)return;
  [layoutPicksIds[index],layoutPicksIds[target]]=[layoutPicksIds[target],layoutPicksIds[index]];
  renderPicksSelected();
}
window.movePick=movePick;
function removePick(id){
  layoutPicksIds=layoutPicksIds.filter(x=>x!==id);
  renderPicksSelected();
  renderPicksCandidates();
}
window.removePick=removePick;
function addPick(id){
  if(layoutPicksIds.length>=4){toast("最多只能選 4 件商品");return}
  if(layoutPicksIds.includes(id))return;
  layoutPicksIds.push(id);
  renderPicksSelected();
  renderPicksCandidates();
}
window.addPick=addPick;
function renderPicksCandidates(){
  const wrap=document.getElementById("picksCandidatesList");
  const q=(document.getElementById("picksSearchInput").value||"").trim().toLowerCase();
  const list=products.filter(p=>isLive(p)&&!layoutPicksIds.includes(p.id)&&(!q||(p.name||"").toLowerCase().includes(q))).slice(0,30);
  if(!list.length){wrap.innerHTML='<div class="catmgr-hint" style="padding:6px">沒有符合的商品</div>';return}
  wrap.innerHTML=list.map(p=>`
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:5px 6px;cursor:pointer;border-radius:6px" onclick="addPick('${p.id}')" onmouseover="this.style.background='var(--cream)'" onmouseout="this.style.background='transparent'">
      <span style="font-size:13px">${escapeHTML(p.name)}</span>
      <span style="font-size:12px;color:var(--tan-dark)">＋ 加入</span>
    </div>
  `).join("");
}
window.renderPicksCandidates=renderPicksCandidates;
async function saveLayoutSettings(){
  if(heroUploading){toast("首頁大圖還在上傳中，請稍候幾秒再儲存");return}
  const next={
    showPicks:document.getElementById("layoutShowPicks").checked,
    showCatTiles:document.getElementById("layoutShowCatTiles").checked,
    heroImage:layoutHeroImage,
    picksProductIds:layoutPicksIds.slice()
  };
  catalog.forEach(c=>{
    if(layoutCatImages[c.id])c.image=layoutCatImages[c.id];
    else delete c.image;
  });
  layout=next;
  if(!await saveMeta())return;
  closeModal("layoutModal");
  toast("首頁版面已更新 ☁️");
}
window.saveLayoutSettings=saveLayoutSettings;

/* ── 批次上傳照片（依檔名比對商品，沿用前台邏輯）───────────────── */
let bulkReplaceMode=false;
window.setBulkMode=function(mode,btn){
  bulkReplaceMode=mode==="replace";
  btn.parentElement.querySelectorAll(".upload-method-btn").forEach(b=>b.classList.remove("active"));
  btn.classList.add("active");
};
function parseBulkFilename(filename){
  const base=filename.replace(/\.[^.]+$/,"");
  const match=base.match(/^(.*?)[\s_\-\(（]+0*(\d{1,3})[\)）]?$/);
  if(match&&match[1].trim())return {name:match[1].trim(),index:parseInt(match[2],10)};
  return {name:base.trim(),index:1};
}
function groupBulkFiles(fileList){
  const groups=new Map();
  Array.from(fileList).filter(f=>f.type.startsWith("image/")).forEach(file=>{
    const {name,index}=parseBulkFilename(file.name);
    if(!name)return;
    if(!groups.has(name))groups.set(name,[]);
    groups.get(name).push({file,index});
  });
  groups.forEach(items=>items.sort((a,b)=>a.index-b.index));
  return groups;
}
function fileToDataUrl(file){
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=e=>resolve(e.target.result);
    reader.onerror=reject;
    reader.readAsDataURL(file);
  });
}
let bulkBusy=false; // 一批還在處理時又選了檔案：等這批做完，兩批才不會互相蓋掉
window.openBulkUploadModal=function(){
  document.getElementById("bulkFileInput").value="";
  document.getElementById("bulkFolderInput").value="";
  if(!bulkBusy)document.getElementById("bulkLog").innerHTML=""; // 還在處理的話，進度留著
  openModal("bulkUploadModal");
};
// 這件商品現在的完整照片＋對應的原圖（原圖補到跟照片一樣長，位置才對得上）。
// 讀不到就丟出錯誤、這件先不處理——不能拿不完整的照片去蓋掉原本的
async function currentGallery(p){
  let photos=(p.photos||[]).filter(Boolean),originals=[];
  const snap=await getDoc(galleryDocRef(p.id));
  if(snap.exists()){
    const data=snap.data();
    const full=(data.photos||[]).filter(Boolean);
    if(full.length){photos=full;originals=data.photoOriginals||[]}
  }
  photos=photos.slice(0,MAX_PHOTOS);
  return{photos,originals:photos.map((_,i)=>originals[i]||"")};
}
// 一張照片：跟商品編輯一樣先傳到圖床；圖床失敗才退回存在資料庫（畫質、容量都比較差，會提醒）
async function uploadBulkPhoto(file){
  try{
    const url=await uploadToCloudinary(file);
    return{photo:url,original:url,local:false};
  }catch(e){
    console.warn("批次上傳：圖床上傳失敗，改用本機暫存",file.name,e);
    const dataUrl=await fileToDataUrl(file);
    return{photo:await resizeImageToUniform(dataUrl),original:dataUrl,local:true};
  }
}
async function handleBulkFiles(event){
  const input=event.target;
  const files=[...(input.files||[])];
  input.value=""; // 清空，方便下次選同一批檔案也會觸發
  if(!files.length)return;
  if(bulkBusy){toast("上一批照片還在處理中，請等它做完再選");return}
  const log=document.getElementById("bulkLog");
  const groups=groupBulkFiles(files);
  if(!groups.size){log.textContent="沒有找到可用的圖片檔案。";return}
  bulkBusy=true;
  const lines=[];
  const counts={matched:0,created:0,full:0,failed:0};
  let done=0;
  const show=(extra="")=>{log.innerHTML=lines.join("<br>")+extra};
  try{
    for(const [name,items] of groups){
      const safeName=escapeHTML(name);
      show(`${lines.length?"<br>":""}處理中…（${done+1}/${groups.size}）「${safeName}」`);
      // 同名商品：上架中的優先，再來是封存的（批次建立的新商品是封存，之後再補照片也要比對得到）
      const same=products.filter(p=>p.status!=="trashed"&&(p.name||"").trim()===name);
      const existing=same.find(isLive)||same[0];
      try{
        const current=existing&&!bulkReplaceMode?await currentGallery(existing):{photos:[],originals:[]};
        const room=MAX_PHOTOS-current.photos.length;
        if(room<=0){
          counts.full++;
          lines.push(`－ 「${safeName}」已經有 ${MAX_PHOTOS} 張照片，這次的沒有加進去（要換掉請選「取代該商品所有照片」）`);
          continue;
        }
        const picked=items.slice(0,room);
        const uploaded=[];
        for(const {file} of picked)uploaded.push(await uploadBulkPhoto(file));
        const photos=[...current.photos,...uploaded.map(u=>u.photo)];
        const originals=[...current.originals,...uploaded.map(u=>u.original)];
        const notes=[];
        if(items.length>picked.length)notes.push(`有 ${items.length-picked.length} 張超過 ${MAX_PHOTOS} 張上限，沒有放進去`);
        if(uploaded.some(u=>u.local))notes.push("有照片沒傳上圖床，先存在資料庫裡，建議之後再上傳一次");
        const noteText=notes.length?`（${notes.join("；")}）`:"";
        if(existing){
          const next={...existing,photos:[await thumbFor(photos[0])],photoCount:photos.length};
          // 取代後照片可能變少：顏色／款式指到已經沒有的照片，就改成「不換照片」
          if(bulkReplaceMode&&Array.isArray(existing.options))next.options=existing.options.map(o=>Number.isInteger(o.photo)&&o.photo>=photos.length?{...o,photo:null}:o);
          await ensureNoConflict([existing]);
          await saveGallery(existing.id,photos,originals);
          await writeProducts([next],{check:false});
          Object.assign(existing,next); // 兩份都存好了才改畫面上的資料
          counts.matched++;
          lines.push(`✓ 比對到「${safeName}」${existing.status==="archived"?"（封存中）":""}，已${bulkReplaceMode?"取代成":"補上"} ${uploaded.length} 張照片${noteText}`);
        }else{
          // 比對不到就建立新商品，先封存：還沒有分類、尺寸、價格，不要馬上出現在前台
          const product={
            id:uid(),status:"archived",sortOrder:nextSortOrder(),mainCat:"",subCat:null,name,size:"",
            dimensions:{width:"",depth:"",height:""},specs:[],desc:"",
            photos:[await thumbFor(photos[0])],photoCount:photos.length
          };
          await saveGallery(product.id,photos,originals);
          await writeProducts([product],{check:false});
          products.push(product);
          counts.created++;
          lines.push(`＋ 找不到「${safeName}」，已建立新商品，先放在「已封存」${noteText}`);
        }
      }catch(e){
        counts.failed++;
        console.warn("批次上傳失敗",name,e);
        lines.push(`✗ 「${safeName}」沒有存成功：${escapeHTML(e.message||String(e))}`);
      }finally{
        done++;
      }
    }
  }finally{
    bulkBusy=false;
  }
  const summary=[`比對到 ${counts.matched} 件`,counts.created&&`新增 ${counts.created} 件（在「已封存」，分類、尺寸補好後再上架）`,counts.full&&`${counts.full} 件照片已滿`,counts.failed&&`${counts.failed} 件失敗`].filter(Boolean).join("、");
  show(`<br><br>完成：${summary}。`);
  updateTotalCount();
  renderSidebar();
  renderTable();
}
document.getElementById("bulkFileInput").addEventListener("change",handleBulkFiles);
document.getElementById("bulkFolderInput").addEventListener("change",handleBulkFiles);

/* ── 頂部工具列的「網站設定」「商品工具」下拉選單 ───────────────── */
window.toggleHeaderDropdown=function(id){
  const el=document.getElementById(id);
  const willOpen=!el.classList.contains("open");
  closeHeaderDropdowns();
  if(willOpen)el.classList.add("open");
};
window.closeHeaderDropdowns=function(){
  document.querySelectorAll(".dropdown.open").forEach(el=>el.classList.remove("open"));
};
document.addEventListener("click",e=>{
  if(!e.target.closest(".dropdown"))closeHeaderDropdowns();
});

/* ── 批次操作（勾選多個商品，一次改分類／上架／封存／標籤／示意圖／丟垃圾桶）──── */
window.toggleQuickCatMode=function(force){
  quickCatMode=typeof force==="boolean"?force:!quickCatMode;
  quickCatSelected.clear();
  document.body.classList.toggle("quickcat-mode",quickCatMode);
  document.getElementById("quickCatToggleBtn").classList.toggle("active",quickCatMode);
  if(quickCatMode){
    document.getElementById("quickCatMain").innerHTML=catalog.map(c=>`<option value="${escapeHTML(c.id)}">${escapeHTML(c.name)}</option>`).join("");
    updateQuickCatSubSelect();
    updateBulkControls();
  }
  updateQuickCatCount();
  renderTable();
};
window.updateQuickCatSubSelect=function(){
  const mainId=document.getElementById("quickCatMain").value;
  const sub=document.getElementById("quickCatSub");
  const main=getMainCat(mainId);
  if(main?.subs?.length){
    sub.innerHTML=`<option value="">（不指定子分類）</option>`+main.subs.map(s=>`<option value="${escapeHTML(s.id)}">${escapeHTML(s.name)}</option>`).join("");
    sub.style.display="";
  }else{
    sub.innerHTML="";
    sub.style.display="none";
  }
};
window.toggleQuickCatSelect=function(id){
  if(quickCatSelected.has(id))quickCatSelected.delete(id);
  else quickCatSelected.add(id);
  updateQuickCatCount();
};
window.toggleQuickCatSelectAll=function(checkbox){
  const visibleIds=[...document.querySelectorAll("#tbody tr[data-id]")].map(tr=>tr.dataset.id);
  if(checkbox.checked)visibleIds.forEach(id=>quickCatSelected.add(id));
  else visibleIds.forEach(id=>quickCatSelected.delete(id));
  updateQuickCatCount();
  renderTable();
};
function updateQuickCatCount(){
  document.getElementById("quickCatCount").textContent=`已選 ${quickCatSelected.size} 個`;
}
let bulkFigureChoice="";
// 選不同動作時，只顯示那個動作需要的選項
window.updateBulkControls=function(){
  const action=document.getElementById("bulkAction").value;
  document.querySelectorAll("#quickCatBar [data-for]").forEach(el=>{el.hidden=!el.dataset.for.split(" ").includes(action)});
  if(action==="addTag"||action==="removeTag"){
    const sel=document.getElementById("bulkTag");
    const keep=sel.value;
    sel.innerHTML=tagDefs.length
      ?tagDefs.map(d=>`<option value="${escapeHTML(d.key)}">${escapeHTML(d.label)}</option>`).join("")
      :'<option value="">還沒有標籤，先到「標籤管理」新增</option>';
    if(tagDefs.some(d=>d.key===keep))sel.value=keep;
  }
  if(action==="figure")renderBulkFigures();
};
function renderBulkFigures(){
  const wrap=document.getElementById("bulkFigure");
  const tile=(value,content,label)=>`<button type="button" class="figure-tile${bulkFigureChoice===value?" selected":""}" data-value="${value}" aria-pressed="${bulkFigureChoice===value}" aria-label="${label}">${content}</button>`;
  wrap.innerHTML=tile("",'<span class="figure-text">自動</span>',"自動")
    +DIM_FIGURES.map(f=>tile(f.key,dimFigureSvg(f.key),f.label)).join("")
    +tile("none",'<span class="figure-none">不顯示</span>',"不顯示");
  wrap.querySelectorAll(".figure-tile").forEach(btn=>btn.addEventListener("click",()=>{
    bulkFigureChoice=btn.dataset.value;
    renderBulkFigures();
  }));
}
// 改好幾件商品：先寫進資料庫，寫不進去就把畫面上的改動還原，資料庫跟畫面才不會對不上
async function saveProductsChange(list,mutate){
  const before=list.map(p=>JSON.parse(JSON.stringify(p)));
  let saved=0;
  try{
    await ensureNoConflict(list);
    list.forEach(mutate);
    while(saved<list.length){
      const chunk=list.slice(saved,saved+400);
      await writeProducts(chunk,{check:false});
      saved+=chunk.length;
    }
    return true;
  }catch(e){
    list.forEach((p,i)=>{
      if(i<saved)return;
      Object.keys(p).forEach(k=>delete p[k]);
      Object.assign(p,before[i]);
    });
    toast(saveErrorText(e,"儲存失敗"),e.cancelled?6000:4000);
    return false;
  }finally{
    updateTotalCount();
    renderSidebar();
    renderTable();
  }
}
const moveToTrash=p=>{p.trashedFrom=p.status;p.status="trashed";p.trashedAt=Date.now()};
// 救回：回到丟掉之前的狀態（上架中或封存）；回到上架的排到最後面
function takeOutOfTrash(p){
  p.status=p.trashedFrom==="archived"?"archived":"active";
  if(p.status==="active")p.sortOrder=nextSortOrder();
  delete p.trashedFrom;
  delete p.trashedAt;
}
async function applyQuickCat(){
  const mainId=document.getElementById("quickCatMain").value;
  const subId=document.getElementById("quickCatSub").value||null;
  if(!mainId){toast("還沒有分類，先到「分類管理」新增");return}
  const targets=products.filter(p=>quickCatSelected.has(p.id));
  if(await saveProductsChange(targets,p=>{p.mainCat=mainId;p.subCat=subId})){
    toast(`已將 ${targets.length} 個商品分類為「${getMainName(mainId)}」☁️`);
    finishBulk();
  }
}
function finishBulk(){
  quickCatSelected.clear();
  document.getElementById("qcSelectAll").checked=false;
  updateQuickCatCount();
  renderTable();
}
window.applyBulkAction=async function(){
  if(!quickCatSelected.size){toast("請先勾選商品");return}
  const action=document.getElementById("bulkAction").value;
  if(action==="category")return applyQuickCat();
  const selected=products.filter(p=>quickCatSelected.has(p.id));
  let targets,mutate,done;
  if(action==="publish"){
    targets=selected.filter(p=>p.status!=="active");
    if(!targets.length){toast("勾選的商品都已經在上架中");return}
    if(!confirm(`把 ${targets.length} 個商品上架嗎？上架後前台就看得到。`))return;
    mutate=p=>{delete p.trashedFrom;delete p.trashedAt;p.status="active";p.sortOrder=nextSortOrder()};
    done=`已上架 ${targets.length} 個商品`;
  }else if(action==="archive"){
    targets=selected.filter(isLive);
    if(!targets.length){toast("勾選的商品裡沒有上架中的");return}
    if(!confirm(`把 ${targets.length} 個商品封存嗎？封存後前台看不到，隨時可以還原上架。`))return;
    mutate=p=>{p.status="archived"};
    done=`已封存 ${targets.length} 個商品`;
  }else if(action==="addTag"||action==="removeTag"){
    const key=document.getElementById("bulkTag").value;
    const def=tagDefs.find(d=>d.key===key);
    if(!def){toast("還沒有標籤，先到「標籤管理」新增");return}
    const adding=action==="addTag";
    targets=selected.filter(p=>(p.badges||[]).includes(key)!==adding);
    if(!targets.length){toast(adding?`勾選的商品都已經有「${def.label}」`:`勾選的商品都沒有「${def.label}」`);return}
    mutate=adding?p=>{p.badges=[...(p.badges||[]),key]}:p=>{p.badges=(p.badges||[]).filter(b=>b!==key)};
    done=`已${adding?"加上":"拿掉"} ${targets.length} 個商品的「${def.label}」標籤`;
  }else if(action==="figure"){
    const choice=validDimFigure(bulkFigureChoice);
    targets=selected.filter(p=>(p.dimFigure||"")!==choice);
    if(!targets.length){toast("勾選的商品已經都是這張示意圖");return}
    mutate=p=>{p.dimFigure=choice};
    done=`已更換 ${targets.length} 個商品的尺寸示意圖`;
  }else if(action==="trash"){
    targets=selected.filter(p=>p.status!=="trashed");
    if(!targets.length){toast("勾選的商品都已經在垃圾桶裡");return}
    if(!confirm(`把 ${targets.length} 個商品丟進垃圾桶嗎？${TRASH_DAYS} 天內都可以在「垃圾桶」救回來。`))return;
    mutate=moveToTrash;
    done=`已把 ${targets.length} 個商品丟進垃圾桶，${TRASH_DAYS} 天內可以救回`;
  }else if(action==="untrash"){
    targets=selected.filter(p=>p.status==="trashed");
    if(!targets.length){toast("勾選的商品裡沒有在垃圾桶的");return}
    mutate=takeOutOfTrash;
    done=`已救回 ${targets.length} 個商品`;
  }else return;
  if(await saveProductsChange(targets,mutate)){
    toast(done+" ☁️");
    finishBulk();
  }
};

/* ── 表格列拖曳排序（只在依顯示順序、無篩選時開放）─────────────── */
let dragProductId=null;
const tbodyEl=document.getElementById("tbody");
tbodyEl.addEventListener("dragstart",e=>{
  const tr=e.target.closest("tr[draggable='true']");
  if(!tr)return;
  dragProductId=tr.dataset.id;
  tr.classList.add("dragging");
});
tbodyEl.addEventListener("dragend",()=>{
  document.querySelectorAll("#tbody tr").forEach(tr=>tr.classList.remove("dragging","drag-over"));
  dragProductId=null;
});
tbodyEl.addEventListener("dragover",e=>{
  const tr=e.target.closest("tr[draggable='true']");
  if(!tr||!dragProductId||tr.dataset.id===dragProductId)return;
  e.preventDefault();
  tr.classList.add("drag-over");
});
tbodyEl.addEventListener("dragleave",e=>{
  const tr=e.target.closest("tr");
  if(tr)tr.classList.remove("drag-over");
});
tbodyEl.addEventListener("drop",async e=>{
  const tr=e.target.closest("tr[draggable='true']");
  if(!tr||!dragProductId)return;
  e.preventDefault();
  tr.classList.remove("drag-over");
  const targetId=tr.dataset.id;
  const srcId=dragProductId;
  dragProductId=null;
  if(targetId===srcId)return;
  await reorderProductRow(srcId,targetId);
});
async function reorderProductRow(srcId,targetId){
  // 拖曳範圍要跟畫面上看到的一致：有選分類時只在該分類內重排，不動其他分類商品的順序
  let list=products.slice();
  if(catFilterMain){
    list=list.filter(p=>p.mainCat===catFilterMain);
    if(catFilterSub)list=list.filter(p=>p.subCat===catFilterSub);
  }
  // 依照畫面上目前的排序欄位排列（可能是名稱、分類…等，不一定是自訂順序），
  // 這樣拖曳的來源／目標位置才會跟使用者看到的列一致
  list=list.filter(isLive).sort((a,b)=>sortDir*sortCompare(a,b));
  const srcIdx=list.findIndex(p=>p.id===srcId);
  const targetIdx=list.findIndex(p=>p.id===targetId);
  if(srcIdx<0||targetIdx<0)return;
  // 重排後把「這個子集合原本占用的 sortOrder 數值」原地重新分配，
  // 不會影響到子集合以外商品之間的相對順序
  const orderSlots=list.map(p=>p.sortOrder??0);
  const [moved]=list.splice(srcIdx,1);
  list.splice(targetIdx,0,moved);
  list.forEach((p,i)=>p.sortOrder=orderSlots[i]);
  renderTable();
  try{
    await patchProducts(list,["sortOrder"]);
    toast("前台順序已更新 ☁️");
  }catch(e){
    toast("排序更新失敗："+(e.message||String(e)),4000);
  }
}

/* ── 商品新增／編輯（照片處理沿用前台邏輯）───────────────────── */
const MAX_PHOTOS=5;
let editingProductId=null;
let workingPhotos=[];
// 跟 workingPhotos 一一對應的「裁切前原圖」，只有在真的上傳新照片時才會被換掉；
// 套用裁切／縮放時只改 workingPhotos，這個陣列維持原樣，之後才有辦法回去重新調整。
let workingPhotosOriginal=[];
let workingSpecs=[];
let workingOptions=[];   // 顏色／款式：[{name,color,photo}]，編輯時 photo 是第幾格照片（從 0 開始，跟格子上的號碼一致），存檔時換成第幾張；null＝不換照片
let productModalToken=0; // 開窗後非同步讀照片期間又開了別的商品時，舊的讀取結果不要蓋掉畫面
let productFormBaseline=null; // 開窗時表單的內容，用來判斷有沒有還沒儲存的修改
let uploadMethod="file";
// 正在背景上傳到 Cloudinary 的照片格編號，畫面上疊「上傳中…」用
let slotsUploading=new Set();

function productsCol(){return collection(db,"sitedata",SITE_DOC,"products")}
function galleryDocRef(id){return doc(db,"sitedata",SITE_DOC,"products",id,"gallery","full")}
function uid(){return Math.random().toString(36).slice(2,10)}
function nextSortOrder(){return products.length?Math.max(...products.map(p=>p.sortOrder??0))+1:0}
// Firestore 的批次寫入不接受 undefined 欄位值；早期建立的商品文件可能缺少 status，
// 在真正送出批次寫入前再保險檢查一次（不只靠開機時的正規化），任何一次性批次寫入
// 商品都先過這一關，徹底避免「Unsupported field value: undefined」這個錯誤再出現。
function sanitizeProductForWrite(p){
  if(typeof p.status!=="string")p.status="active";
  if(typeof p.sortOrder!=="number")p.sortOrder=nextSortOrder();
  return p;
}

/* ── 兩台裝置（或兩個分頁）同時編輯的保護 ─────────────────────────
   每次寫入商品都記下 updatedAt（存檔當下的時間）。整筆商品存檔前，先去資料庫看一眼：
   資料庫裡的 updatedAt 跟這個畫面當初讀到的不一樣，就代表別的裝置在這段時間改過，
   先問要不要蓋掉，不會悄悄把別人剛改好的內容蓋回舊的。
   只改其中幾個欄位的操作（排序、標籤、分類…）用 patchProducts，只寫那幾個欄位，
   本來就不會蓋到別的內容，不用問。 */
class SaveCancelled extends Error{
  constructor(){super("已取消，沒有儲存。請重新整理頁面（F5）載入最新內容後再改一次");this.cancelled=true}
}
const saveErrorText=(e,prefix)=>e?.cancelled?e.message:`${prefix}：${e?.message||String(e)}`;
const clockText=t=>{const d=new Date(t);return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`};
async function ensureNoConflict(list){
  const existing=list.filter(p=>p&&p.id);
  if(!existing.length)return;
  const remote=new Map();
  try{
    if(existing.length<=3){
      const snaps=await Promise.all(existing.map(p=>getDoc(doc(productsCol(),p.id))));
      snaps.forEach((s,i)=>{if(s.exists())remote.set(existing[i].id,s.data())});
    }else{
      (await getDocs(productsCol())).forEach(s=>remote.set(s.id,s.data()));
    }
  }catch(e){
    console.warn("沒辦法先檢查別的裝置有沒有改過，直接儲存",e);
    return;
  }
  const changed=existing.filter(p=>remote.has(p.id)&&(remote.get(p.id).updatedAt??null)!==(p.updatedAt??null));
  if(!changed.length)return;
  const names=changed.slice(0,3).map(p=>`「${p.name||"未命名商品"}」`).join("、")+(changed.length>3?` 等 ${changed.length} 個商品`:"");
  const latest=Math.max(...changed.map(p=>remote.get(p.id).updatedAt||0));
  const when=latest?`（${clockText(latest)}）`:"";
  if(!confirm(`${names} 剛剛在別的裝置或別的分頁被修改過${when}，這個畫面上的還是舊的內容。\n\n按「確定」：用你現在的版本蓋掉。\n按「取消」：先不要存，重新整理頁面看最新的內容。`))throw new SaveCancelled();
}
// 整筆寫入（存檔前先檢查有沒有被別的裝置改過）
async function writeProducts(list,{check=true}={}){
  if(check)await ensureNoConflict(list);
  for(let i=0;i<list.length;i+=400){ // 一次批次寫入最多 500 筆
    const chunk=list.slice(i,i+400);
    const stamp=Date.now();
    const batch=writeBatch(db);
    chunk.forEach(p=>batch.set(doc(productsCol(),p.id),{...sanitizeProductForWrite(p),updatedAt:stamp}));
    await batch.commit();
    chunk.forEach(p=>p.updatedAt=stamp);
  }
}
// 只寫指定的幾個欄位（沒有值的欄位略過），其他欄位維持資料庫裡的樣子
async function patchProducts(list,fields){
  for(let i=0;i<list.length;i+=400){
    const chunk=list.slice(i,i+400);
    const stamp=Date.now();
    const batch=writeBatch(db);
    chunk.forEach(p=>{
      const data={updatedAt:stamp};
      fields.forEach(k=>{if(p[k]!==undefined)data[k]=p[k]});
      batch.set(doc(productsCol(),p.id),data,{merge:true});
    });
    await batch.commit();
    chunk.forEach(p=>p.updatedAt=stamp);
  }
}
// 商品文件只存封面照＋photoCount，完整多張照片存在 products/{id}/gallery/full 子文件，
// 編輯商品時才讀取，前台清單／表格讀取才不會把所有照片都抓下來。
// photoOriginals 是跟 photos 一一對應的「裁切前原圖」，讓管理員之後還能回去重新調整裁切／縮放。
async function loadGallery(id){
  try{
    const snap=await getDoc(galleryDocRef(id));
    if(!snap.exists())return{photos:[],originals:[]};
    const data=snap.data();
    return{
      photos:(data.photos||[]).filter(Boolean),
      originals:data.photoOriginals||[]
    };
  }catch(e){
    console.warn("圖庫讀取失敗",e);
    return{photos:[],originals:[]};
  }
}
// Firestore 單一文件硬性上限 1,048,576 bytes；抓保守一點的安全值，
// 避免加上欄位名稱等其他 JSON 開銷後還是壓線超過。
const GALLERY_SIZE_BUDGET=950000;
function galleryPayloadSize(photos,originals,batchBackup){
  return JSON.stringify({photos,photoOriginals:originals,batchBackup}).length;
}
async function saveGallery(id,photos,originals){
  // batchBackup 是以前「復原上次搬遷」用的備份，那個功能拿掉了，存檔時順便清掉、空出文件空間
  const batchBackup=null;
  const cleanPhotos=(photos||[]).filter(Boolean);
  const rawOriginals=originals||[];
  // 原圖畫質/尺寸階梯式往下調，直到整包資料在安全範圍內為止：多數情況第一階
  // 就會過關、畫質幾乎沒差；只有照片內容特別難壓縮（木紋、布紋等細節很多）
  // 或單一商品塞滿 5 張照片時，才會再往下調更保守的尺寸/畫質，確保一定存得進去，
  // 不會因為某張照片特別難壓縮就一直存檔失敗。
  const steps=[{maxDim:1600,quality:0.86},{maxDim:1300,quality:0.8},{maxDim:1000,quality:0.72},{maxDim:750,quality:0.6}];
  let cleanOriginals=rawOriginals;
  for(const step of steps){
    cleanOriginals=await Promise.all(rawOriginals.map(o=>capOriginalDataUrl(o,step.maxDim,step.quality)));
    if(galleryPayloadSize(cleanPhotos,cleanOriginals,batchBackup)<GALLERY_SIZE_BUDGET)break;
  }
  await setDoc(galleryDocRef(id),{
    photos:cleanPhotos,
    photoOriginals:cleanOriginals,
    batchBackup
  });
}

window.openModal=function(id){document.getElementById(id).classList.add("open")};
document.addEventListener("keydown",e=>{
  if(e.key!=="Escape"||e.isComposing)return; // 打中文選字時按 Esc 是取消選字，不是關視窗
  const open=document.querySelectorAll(".modal-overlay.open");
  if(open.length){
    e.preventDefault();
    open[open.length-1].querySelector(".modal-close")?.click();
  }else closeHeaderDropdowns();
});
window.closeModal=function(id){document.getElementById(id).classList.remove("open")};

/* ── 自動產文案（規則式樣板，依商品名稱關鍵字比對，非真AI生成）─── */
function autoGenerateDesc(name,catName,subName){
  name=name||"";catName=catName||"";subName=subName||"";
  const has=kw=>name.includes(kw);
  const traits=[];
  if(has("鋁架")||has("鋁"))traits.push("鋁合金材質，輕巧防鏽");
  if(has("白鐵"))traits.push("白鐵材質，耐刮耐用好清潔");
  if(has("實木"))traits.push("實木材質，質感自然溫潤");
  if(has("皮面")||has("皮革"))traits.push("皮革表面，好清潔耐髒污");
  if(has("網布"))traits.push("透氣網布，久坐不悶熱");
  if(has("古銅腳"))traits.push("古銅色澤，耐看好搭配");
  if(has("電金腳"))traits.push("電金色澤，質感亮眼");
  if(has("花紋"))traits.push("花紋表面，美觀耐看");
  if(has("牛角"))traits.push("經典造型，耐看不退流行");
  if(has("靠腰"))traits.push("貼腰椅背設計，久坐較舒適");
  if(has("氣壓"))traits.push("氣壓升降，高度可依需求調整");
  if(has("凹底"))traits.push("凹底椅面設計，坐感較貼合");
  if(has("圓"))traits.push("圓潤造型，百搭多種空間風格");
  if(has("鋼管"))traits.push("鋼管骨架穩重紮實，久坐不搖晃");

  const isFold=has("摺疊")||has("折疊")||has("立桌")||subName.includes("摺疊")||subName.includes("折疊");
  // 看分類名稱裡的關鍵字，不比對完整名稱：「收納櫃/架」「收納櫃／架」斜線全形半形都認得，分類改名也不會失效。
  // 先看子分類、再看主分類，順序跟尺寸示意圖的自動判斷一樣（「床架」是床不是置物架、「床邊桌」是桌子）
  const kindOf=n=>/椅|凳/.test(n)?"chair":/桌|几|台/.test(n)?"table":/床|寢具/.test(n)?"bed":/櫃|架/.test(n)?"rack":"";
  const kind=kindOf(subName)||kindOf(catName);
  const isRack=kind==="rack",isTable=kind==="table",isChair=kind==="chair";
  const matText=traits.join("，")||"簡約造型，線條俐落好搭配";

  let intro,bullets;
  if(isRack){
    intro=`${matText}，收納空間實用，組裝簡易。`;
    bullets=[matText,"收納空間實用，組裝簡易"];
  }else if(isTable){
    if(isFold){
      intro=`${matText}，摺疊桌腳設計，需要時展開即可使用，不用時收合好收納。`;
      bullets=["摺疊收納，不佔空間",matText];
    }else{
      intro=`${matText}，適合居家日常使用。`;
      bullets=[matText,"簡約造型，好搭配空間風格"];
    }
  }else if(isChair){
    if(isFold){
      intro=`${matText}，摺疊設計方便收納移動。`;
      bullets=[matText,"摺疊收納，不佔空間"];
    }else{
      intro=`${matText}，適合居家餐廳日常使用。`;
      bullets=[matText,"穩固耐用，居家日常好搭配"];
    }
  }else if(traits.length){
    // 認不出品類時，商品名稱裡看得出的材質、特色還是要寫進去
    intro=`${matText}，適合居家日常使用。`;
    bullets=[matText,"居家日常好搭配"];
  }else{
    intro="簡約實用設計，適合居家日常使用。";
    bullets=["簡約實用","居家日常好搭配"];
  }
  const bulletHtml=bullets.filter(Boolean).map(b=>`• ${escapeHTML(b)}`).join("<br>");
  return `${escapeHTML(intro)}<br><br>${bulletHtml}`;
}
window.applyAutoDesc=function(){
  const editor=document.getElementById("pDesc");
  if(!richTextIsEmpty(editor.innerHTML)&&!confirm("目前已有商品說明內容，套用自動產生的文案會覆蓋掉，確定要套用嗎？"))return;
  const name=document.getElementById("pName").value.trim();
  if(!name){toast("請先填寫商品名稱");return}
  const mainId=document.getElementById("pMainCat").value;
  const subId=document.getElementById("pSubCat").value;
  const catName=getMainName(mainId);
  const subName=getSubName(mainId,subId);
  editor.innerHTML=autoGenerateDesc(name,catName,subName);
  toast("已自動產生文案，記得檢查一下內容再儲存");
};
/* ── 用免費的 AI 聊天寫商品說明：把這件商品的資料整理成提示詞，你貼到 Gemini／ChatGPT／Claude，
   附上照片請它寫，再把寫好的文字貼回「商品說明」（不用申請金鑰、不用付費）─────────────── */
const AI_PROMPT_SKIP_TAGS=["sale","new","bestseller","preorder","limited"]; // 特價、新品這類會變動的標籤不寫進說明
function buildAiDescPrompt(){
  const val=id=>document.getElementById(id).value.trim();
  const mainId=val("pMainCat"),subId=val("pSubCat");
  const cat=mainId?[getMainName(mainId),getSubName(mainId,subId)].filter(Boolean).join(" / "):"";
  const dims=[["寬",val("pWidth")],["深",val("pDepth")],["高",val("pHeight")]].filter(([,v])=>isSizeValue(v)).map(([k,v])=>`${k} ${v}`).join(" × ");
  const specs=workingSpecs.map(sp=>{
    const bits=[["寬",sp.w],["深",sp.d],["高",sp.h]].filter(([,v])=>isSizeValue(v)).map(([k,v])=>`${k} ${String(v).trim()}`);
    return bits.length?`${String(sp.part||"").trim()||"規格"}：${bits.join("、")}`:"";
  }).filter(Boolean);
  const options=workingOptions.map(o=>o.name.trim()).filter(Boolean);
  const tags=getCheckedBadges().filter(k=>!AI_PROMPT_SKIP_TAGS.includes(k)).map(k=>tagDefs.find(d=>d.key===k)?.label).filter(Boolean);
  const current=richTextIsEmpty(document.getElementById("pDesc").innerHTML)?"":document.getElementById("pDesc").innerText.trim();
  const facts=[
    `商品名稱：${val("pName")}`,
    cat&&`分類：${cat}`,
    dims&&`尺寸：${dims} cm`,
    specs.length&&`其他尺寸：${specs.join("；")}`,
    options.length&&`顏色／款式：${options.join("、")}`,
    tags.length&&`特色：${tags.join("、")}`,
  ].filter(Boolean);
  return [
    "請幫我寫一段家具的商品說明，要放在我們家具行網站的商品頁。我會附上商品照片，請看照片和下面的資料來寫。",
    "",
    "【商品資料】",
    ...facts,
    ...(current?["","【目前的說明】（請參考裡面的資訊，改寫得更通順、更吸引人）",current]:[]),
    "",
    "【寫作要求】",
    "1. 用台灣慣用的繁體中文，語氣親切、實在，像家具行老闆在跟客人介紹。",
    "2. 先寫一段一到兩句的介紹，空一行，再寫 3～4 點特色，每點一行，用「• 重點：說明」的格式。",
    "3. 全部大約 100～180 個字。",
    "4. 只寫照片看得出來、或上面資料有寫的內容。看不出來的材質不要猜（例如實木或木紋貼皮、鋁或鐵），也不要自己加承重、防水、保固、產地這類說法。",
    "5. 不用寫價格和尺寸數字，網站上另外有寫。",
    "6. 不要用 Markdown 符號（例如 # 或 **），不要加標題或表情符號。",
    "7. 直接給我說明文字就好，不用其他解釋。",
    "",
    "【格式範例】（只參考格式，內容請依這件商品重新寫）",
    "（一到兩句介紹這件商品的特色和適合的使用情境）",
    "",
    "• 重點：說明",
    "• 重點：說明",
    "• 重點：說明",
  ].join("\n");
}
async function copyText(text){
  try{await navigator.clipboard.writeText(text);return true}catch(e){}
  // 舊瀏覽器或不允許時，退回用看不見的文字框複製
  const ta=document.createElement("textarea");
  ta.value=text;
  ta.setAttribute("readonly","");
  ta.style.cssText="position:fixed;top:0;left:0;width:1px;height:1px;opacity:0";
  document.body.appendChild(ta);
  ta.select();
  let ok=false;
  try{ok=document.execCommand("copy")}catch(e){}
  ta.remove();
  return ok;
}
// fromTextarea：在「看／修改提示詞內容」裡改過，複製改過的版本
window.copyAiPrompt=async function(fromTextarea=false){
  const box=document.getElementById("aiHelper"),area=document.getElementById("aiPromptText");
  if(!fromTextarea){
    if(!document.getElementById("pName").value.trim()){toast("請先填寫商品名稱");return}
    area.value=buildAiDescPrompt();
  }
  const hasPhoto=workingPhotos.some(Boolean);
  document.getElementById("aiPhotoBtn").hidden=!hasPhoto;
  document.getElementById("aiPhotoNote").hidden=!hasPhoto;
  document.getElementById("aiNoPhoto").hidden=hasPhoto;
  box.hidden=false;
  const ok=await copyText(area.value);
  document.getElementById("aiHelperStatus").textContent=ok?"✓ 提示詞已複製":"沒辦法自動複製：請打開下面的「看／修改提示詞內容」，全選後複製";
  if(!ok)box.querySelector("details").open=true;
  else toast(fromTextarea?"已複製修改後的提示詞":"已複製提示詞，貼到 AI 聊天，再附上商品照片",3200);
};
function closeAiHelper(){
  const box=document.getElementById("aiHelper");
  box.hidden=true;
  box.querySelector("details").open=false;
}
window.closeAiHelper=closeAiHelper;
// 下載第 1 張照片給 AI 看：圖床的照片轉成 1600px 以內的 jpg，檔案小、AI 也看得清楚
window.downloadAiPhoto=async function(){
  const src=workingPhotos.find(Boolean);
  if(!src)return;
  const fileName=`${(document.getElementById("pName").value.trim()||"商品照片").replace(/[\\/:*?"<>|]/g,"_")}.jpg`;
  const url=/res\.cloudinary\.com/i.test(src)?src.replace(/\/image\/upload\//,"/image/upload/c_limit,w_1600,f_jpg,q_auto/"):normalizePhotoUrl(src);
  try{
    const res=await fetch(url);
    if(!res.ok)throw new Error(`HTTP ${res.status}`);
    downloadBlob(await res.blob(),fileName);
  }catch(e){
    // 抓不到（例如 Google 雲端的照片不讓網頁直接下載）就在新分頁打開，讓你自己另存
    window.open(url,"_blank","noopener");
    toast("照片已在新分頁打開，按右鍵（手機長按）另存就可以",4000);
  }
};
window.bulkAutoDesc=async function(){
  const targets=products.filter(p=>isLive(p)&&richTextIsEmpty(p.desc));
  if(!targets.length){toast("目前沒有缺說明的商品");return}
  if(!confirm(`將為 ${targets.length} 個缺商品說明的商品自動產生文案並直接儲存，確定要執行嗎？`))return;
  const btn=document.getElementById("bulkAutoDescBtn");
  btn.disabled=true;
  btn.textContent="產生中…";
  try{
    targets.forEach(p=>{
      const catName=getMainName(p.mainCat);
      const subName=getSubName(p.mainCat,p.subCat);
      p.desc=autoGenerateDesc(p.name,catName,subName);
    });
    await patchProducts(targets,["desc"]);
    toast(`已為 ${targets.length} 個商品產生文案並儲存 ☁️`);
  }catch(e){
    toast("批次產生失敗："+(e.message||String(e)),4000);
  }
  btn.disabled=false;
  btn.textContent="批次產生缺說明商品文案";
  renderTable();
};

// 把還是 base64 的商品照片（通常是這個 Cloudinary 機制上線前留下的舊資料）
// 上傳到 Cloudinary、換成網址存起來。已經是網址的（http 開頭，不管是本來就
// 貼連結、還是之前已經搬過的）直接跳過，這個工具可以放心重複執行。
// 還沒搬到圖床的照片（圖床上傳失敗時暫存在資料庫裡的 base64）：有才在「商品工具」選單顯示搬遷按鈕
const isLocalPhoto=src=>/^data:/i.test(src||"");
function updateMigrateMenu(){
  const n=products.filter(p=>isLive(p)&&(p.photos||[]).some(isLocalPhoto)).length
    +(isLocalPhoto(layout.heroImage)?1:0)+catalog.filter(c=>isLocalPhoto(c.image)).length;
  const wrap=document.getElementById("migrateMenu");
  if(!wrap)return;
  wrap.hidden=!n;
  document.getElementById("migrateMenuBtn").textContent=`☁️ 有 ${n} 處照片還沒搬到圖床`;
}
window.migratePhotosToCloudinary=async function(){
  const targets=products.filter(p=>isLive(p)&&(p.photos||[]).length);
  const heroIsBase64=/^data:/i.test(layout.heroImage||"");
  const catImagesBase64=catalog.filter(c=>/^data:/i.test(c.image||"")).length;
  if(!targets.length&&!heroIsBase64&&!catImagesBase64){toast("目前沒有可以搬遷的照片");return}
  if(!confirm(`將把還沒搬過去的照片（之前圖床上傳失敗、暫存在資料庫裡的商品照片、首頁大圖、分類磚圖）上傳到 Cloudinary、換成網址儲存，最多會檢查 ${targets.length} 個商品（已經是網址的會自動跳過）。確定要執行嗎？`))return;
  toast(`開始搬遷照片到圖床，共檢查 ${targets.length} 個商品…`,4000);
  let done=0,skipped=0,failed=0;
  // 只有 Cloudinary（已經搬過）跟 Google Drive（本來就選擇留在 Drive、不搬）
  // 才算「不用再處理」；其他 http(s) 網址通常是之前 Cloudinary 上傳失敗、
  // 退回直接存原始連結的情況，這次還是要再嘗試搬到 Cloudinary。
  const isMigrated=src=>/res\.cloudinary\.com/i.test(src||"")||/drive\.google\.com/i.test(src||"");
  const migrateOne=async src=>{
    if(isMigrated(src))return src;
    const blob=await(await fetch(src)).blob();
    return await uploadToCloudinary(blob);
  };
  for(const p of targets){
    try{
      const gallery=await loadGallery(p.id);
      const sourcePhotos=gallery.photos.length?gallery.photos:(p.photos||[]);
      const sourceOriginals=gallery.originals.length?gallery.originals:sourcePhotos;
      if(sourcePhotos.every(isMigrated)&&sourceOriginals.every(isMigrated)){skipped++;continue}
      const newFullPhotos=[];
      const newOriginals=[];
      for(let i=0;i<sourcePhotos.length;i++){
        // 沒有另外存原圖時，原圖等於照片本身（同一個字串）——這種情況只上傳一次、
        // 兩邊共用同一個結果，避免對同一張圖重複打兩次 Cloudinary 上傳。
        const uploaded=await migrateOne(sourcePhotos[i]);
        newFullPhotos.push(uploaded);
        const origSrc=sourceOriginals[i]||sourcePhotos[i];
        newOriginals.push(origSrc===sourcePhotos[i]?uploaded:await migrateOne(origSrc));
      }
      if(!newFullPhotos.length)continue;
      // 先寫圖庫子文件，確定成功以後才更新商品文件的封面縮圖（只寫封面那個欄位）
      await saveGallery(p.id,newFullPhotos,newOriginals);
      p.photos=[isUrl(newFullPhotos[0])?newFullPhotos[0]:await resizeToThumb(newFullPhotos[0])];
      await patchProducts([p],["photos"]);
      done++;
    }catch(e){
      console.warn("搬遷照片失敗："+p.name,e);
      failed++;
    }
  }
  // 首頁大圖／分類磚圖如果也還是舊的 base64（這個機制上線前設定的），一併搬到
  // Cloudinary——這兩個是使用者打開首頁最先看到的內容，base64 直接塞在網站設定
  // 文件裡，會拖慢抓取設定的速度，也是首頁 LCP（最大內容繪製時間）變慢的常見原因。
  let metaChanged=false;
  if(/^data:/i.test(layout.heroImage||"")){
    try{
      const blob=await(await fetch(layout.heroImage)).blob();
      layout.heroImage=await uploadToCloudinary(blob);
      metaChanged=true;
    }catch(e){
      console.warn("首頁大圖搬遷失敗",e);
    }
  }
  for(const c of catalog){
    if(!/^data:/i.test(c.image||""))continue;
    try{
      const blob=await(await fetch(c.image)).blob();
      c.image=await uploadToCloudinary(blob);
      metaChanged=true;
    }catch(e){
      console.warn("分類磚圖搬遷失敗："+c.name,e);
    }
  }
  if(metaChanged)await saveMeta();
  updateMigrateMenu();
  toast(failed?`完成 ${done} 個，跳過 ${skipped} 個，${failed} 個失敗`:`已搬遷 ${done} 個商品的照片，跳過 ${skipped} 個（本來就是網址）☁️`,4500);
  renderTable();
};

/* ── 照片裁切／縮放編輯器 ─────────────────────────────────────────
   拖曳移動、滑桿縮放，套用時直接把目前看到的框選範圍畫成
   PHOTO_TARGET_W x PHOTO_TARGET_H 的最終圖片，取代原本自動置中的做法，
   讓每張商品照片可以自己決定要露出哪個部分、佔框架多大比例。 */
let cropState=null;
window.openCropEditor=async function(slotIdx){
  // 一律從「裁切前的原圖」重新裁，不是拿上次裁完的結果再裁一次，
  // 這樣才能保留原始畫質、也才能隨時改變主意調回去。
  // 如果這個欄位還沒有原圖紀錄（例如這個功能上線前就存在的舊商品），
  // 就把目前看到的這張照片直接當作原圖存起來，之後至少不會再繼續劣化。
  if(!workingPhotosOriginal[slotIdx]&&workingPhotos[slotIdx]){
    workingPhotosOriginal[slotIdx]=workingPhotos[slotIdx];
  }
  const src=workingPhotosOriginal[slotIdx]||workingPhotos[slotIdx];
  if(!src)return;
  const cropImg=document.getElementById("cropImg");
  const viewport=document.getElementById("cropViewport");
  openModal("cropModal");
  cropImg.style.transform="none";
  try{
    const img=await loadImage(normalizePhotoUrl(src));
    // 用實際版面量出來的視窗大小來算，不用寫死的數字，避免手機/桌面版尺寸不同時算錯
    const vw=viewport.clientWidth,vh=viewport.clientHeight;
    const iw=img.naturalWidth,ih=img.naturalHeight;
    const minScale=Math.max(vw/iw,vh/ih);
    // 用「圖片中心點目前落在視窗座標的哪裡」來描述位置，比左上角座標更直覺，
    // 旋轉時的邊界計算也比較單純。
    cropState={slotIdx,iw,ih,vw,vh,minScale,scale:minScale,rotation:0,centerX:vw/2,centerY:vh/2};
    // 這裡設定的 #cropImg 是畫面上實際顯示、之後套用裁切時真正拿去畫進 Canvas 的那個元素，
    // 一定要在指定 src 之前就先設好 crossOrigin，不然即使上面 loadImage() 那次讀取有做跨網域
    // 授權，這個元素本身沒有設定，畫進 Canvas 時還是會被瀏覽器視為「受污染」而擋下來。
    cropImg.crossOrigin="anonymous";
    cropImg.src=img.src;
    document.getElementById("cropZoomSlider").value=0;
    document.getElementById("cropRotateSlider").value=0;
    updateCropTransform();
  }catch(e){
    toast("圖片載入失敗，無法調整");
    closeCropModal();
  }
};
window.closeCropModal=function(){
  closeModal("cropModal");
  cropState=null;
};
function updateCropTransform(){
  if(!cropState)return;
  const img=document.getElementById("cropImg");
  img.style.width=cropState.iw+"px";
  img.style.height=cropState.ih+"px";
  img.style.transformOrigin="50% 50%";
  img.style.transform=`translate(${cropState.centerX-cropState.iw/2}px,${cropState.centerY-cropState.ih/2}px) rotate(${cropState.rotation}deg) scale(${cropState.scale})`;
}
// 圖片旋轉後，四個角落會凸出方框之外，要放大到「旋轉後的外接框」剛好蓋住整個
// 視窗才不會露出黑底——這裡算的就是「目前這個旋轉角度下，最少要放大多少倍」。
function minScaleForRotation(rotationDeg){
  const rad=rotationDeg*Math.PI/180;
  const cos=Math.abs(Math.cos(rad)),sin=Math.abs(Math.sin(rad));
  const bboxW=cropState.vw*cos+cropState.vh*sin;
  const bboxH=cropState.vw*sin+cropState.vh*cos;
  return Math.max(bboxW/cropState.iw,bboxH/cropState.ih);
}
function clampCropCenter(){
  const rad=cropState.rotation*Math.PI/180;
  const cos=Math.abs(Math.cos(rad)),sin=Math.abs(Math.sin(rad));
  // 旋轉＋縮放後，圖片在畫面上實際占用的外接矩形大小
  const bboxW=cropState.iw*cropState.scale*cos+cropState.ih*cropState.scale*sin;
  const bboxH=cropState.iw*cropState.scale*sin+cropState.ih*cropState.scale*cos;
  const minCx=cropState.vw-bboxW/2,maxCx=bboxW/2;
  const minCy=cropState.vh-bboxH/2,maxCy=bboxH/2;
  cropState.centerX=Math.min(maxCx,Math.max(minCx,cropState.centerX));
  cropState.centerY=Math.min(maxCy,Math.max(minCy,cropState.centerY));
}
(function initCropDrag(){
  const viewport=document.getElementById("cropViewport");
  let dragStart=null;
  viewport.addEventListener("pointerdown",e=>{
    if(!cropState)return;
    dragStart={x:e.clientX,y:e.clientY,centerX:cropState.centerX,centerY:cropState.centerY};
    viewport.setPointerCapture(e.pointerId);
    viewport.classList.add("dragging");
  });
  viewport.addEventListener("pointermove",e=>{
    if(!dragStart||!cropState)return;
    cropState.centerX=dragStart.centerX+(e.clientX-dragStart.x);
    cropState.centerY=dragStart.centerY+(e.clientY-dragStart.y);
    clampCropCenter();
    updateCropTransform();
  });
  const endDrag=()=>{dragStart=null;viewport.classList.remove("dragging")};
  viewport.addEventListener("pointerup",endDrag);
  viewport.addEventListener("pointercancel",endDrag);
  document.getElementById("cropZoomSlider").addEventListener("input",e=>{
    if(!cropState)return;
    const t=Number(e.target.value)/100;
    const baseMin=minScaleForRotation(cropState.rotation);
    const maxScale=baseMin*3;
    cropState.scale=baseMin+t*(maxScale-baseMin);
    clampCropCenter();
    updateCropTransform();
  });
  document.getElementById("cropRotateSlider").addEventListener("input",e=>{
    if(!cropState)return;
    cropState.rotation=Number(e.target.value);
    // 換了角度之後，「最小要放大多少倍才蓋得住畫面」也會跟著變，
    // 目前的縮放倍數如果已經不夠蓋住畫面了，要自動補上去，不然角落會露出黑底。
    const newMinScale=minScaleForRotation(cropState.rotation);
    if(cropState.scale<newMinScale)cropState.scale=newMinScale;
    clampCropCenter();
    updateCropTransform();
  });
})();
window.autoCenterCrop=function(){
  if(!cropState)return;
  const img=document.getElementById("cropImg");
  const bbox=detectSubjectBBox(img);
  if(!bbox){
    toast("偵測不到明顯的商品主體，這張照片請用滑桿手動調整");
    return;
  }
  const minScale=minScaleForRotation(cropState.rotation);
  const scale=Math.max(minScale,(cropState.vw*SUBJECT_TARGET_FRACTION)/Math.max(bbox.w,bbox.h));
  const dx=(bbox.x+bbox.w/2)-cropState.iw/2,dy=(bbox.y+bbox.h/2)-cropState.ih/2;
  cropState.scale=scale;
  cropState.centerX=cropState.vw/2-dx*scale;
  cropState.centerY=cropState.vh/2-dy*scale;
  clampCropCenter();
  updateCropTransform();
  const maxScale=minScale*3;
  document.getElementById("cropZoomSlider").value=Math.round(100*Math.min(1,Math.max(0,(cropState.scale-minScale)/(maxScale-minScale||1))));
};
window.applyCrop=async function(){
  if(!cropState)return;
  const slotIdx=cropState.slotIdx;
  const img=document.getElementById("cropImg");
  const canvas=document.createElement("canvas");
  canvas.width=PHOTO_TARGET_W;
  canvas.height=PHOTO_TARGET_H;
  const ctx=canvas.getContext("2d");
  const outScale=PHOTO_TARGET_W/cropState.vw; // 視窗像素 → 輸出像素 的比例（視窗跟輸出圖是同一個 1:1 正方形長寬比，可以直接套用同一個比例）
  let dataUrl;
  try{
    ctx.translate(cropState.centerX*outScale,cropState.centerY*outScale);
    ctx.rotate(cropState.rotation*Math.PI/180);
    ctx.scale(cropState.scale*outScale,cropState.scale*outScale);
    ctx.drawImage(img,-cropState.iw/2,-cropState.ih/2,cropState.iw,cropState.ih);
    dataUrl=canvas.toDataURL("image/jpeg",0.86);
  }catch(e){
    toast("套用失敗，這張圖片可能不支援線上裁切（跨網域圖片限制），請改用「新增/更換」重新上傳",4000);
    closeCropModal();
    return;
  }
  // 先用剛裁好的結果讓畫面立刻有反應，背景再把這張圖傳到 Cloudinary，
  // 傳完會把 workingPhotos 換成 Cloudinary 網址（比較不佔資料庫空間），
  // 如果上傳失敗，這張剛裁好的結果還是留著能用，不會整個操作都白費。
  workingPhotos[slotIdx]=dataUrl;
  closeCropModal();
  slotsUploading.add(slotIdx);
  renderPhotoSlots();
  try{
    const blob=await(await fetch(dataUrl)).blob();
    const url=await uploadToCloudinary(blob);
    if(workingPhotos[slotIdx]===dataUrl)workingPhotos[slotIdx]=url; // 這段等待期間使用者沒有再做別的變動才覆蓋
    toast("照片已調整");
  }catch(e){
    console.warn("裁切結果上傳 Cloudinary 失敗，先留在本機",e);
    toast("照片已調整，但圖床上傳失敗，暫時先存在本機（建議稍後重新裁切一次）",4000);
  }
  slotsUploading.delete(slotIdx);
  renderPhotoSlots();
};

window.renderCatSelect=function(){
  const main=document.getElementById("pMainCat");
  main.innerHTML=catalog.map(c=>`<option value="${escapeHTML(c.id)}">${escapeHTML(c.name)}</option>`).join("");
  updateSubSelect();
};
window.updateSubSelect=function(){
  const mainId=document.getElementById("pMainCat").value;
  const sub=document.getElementById("pSubCat");
  const wrap=document.getElementById("pSubCatWrap");
  const main=getMainCat(mainId);
  if(main?.subs?.length){
    sub.innerHTML=main.subs.map(s=>`<option value="${escapeHTML(s.id)}">${escapeHTML(s.name)}</option>`).join("");
    wrap.style.display="block";
  }else{
    sub.innerHTML="";
    wrap.style.display="none";
  }
};

window.addSpecRow=function(part="",w="",d="",h=""){
  workingSpecs.push({part,w,d,h});
  renderSpecEditor();
};
function renderSpecEditor(){
  const editor=document.getElementById("specEditor");
  if(!editor)return;
  editor.innerHTML="";
  if(!workingSpecs.length){
    workingSpecs=[{part:"",w:"",d:"",h:""},{part:"",w:"",d:"",h:""},{part:"",w:"",d:"",h:""}];
  }
  const table=document.createElement("table");
  table.className="spec-table";
  table.innerHTML=`<thead><tr><th>部位</th><th>寬（W）</th><th>深（D）</th><th>高（H）</th><th></th></tr></thead>`;
  const tbody=document.createElement("tbody");
  workingSpecs.forEach((spec,index)=>{
    const tr=document.createElement("tr");
    tr.innerHTML=`
      <td><input type="text" value="${escapeHTML(spec.part)}" placeholder="例：椅面"></td>
      <td><input type="text" value="${escapeHTML(spec.w)}" placeholder="—"></td>
      <td><input type="text" value="${escapeHTML(spec.d)}" placeholder="—"></td>
      <td><input type="text" value="${escapeHTML(spec.h)}" placeholder="—"></td>
      <td><button class="spec-del-btn" type="button">×</button></td>
    `;
    const [partInput,wInput,dInput,hInput]=tr.querySelectorAll("input");
    partInput.style.textAlign="left";
    partInput.addEventListener("input",()=>{workingSpecs[index].part=partInput.value;scheduleFigureRefresh()});
    wInput.addEventListener("input",()=>workingSpecs[index].w=wInput.value);
    dInput.addEventListener("input",()=>workingSpecs[index].d=dInput.value);
    hInput.addEventListener("input",()=>{workingSpecs[index].h=hInput.value;scheduleFigureRefresh()});
    tr.querySelector(".spec-del-btn").addEventListener("click",()=>{workingSpecs.splice(index,1);renderSpecEditor()});
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  editor.appendChild(table);
  renderFigurePicker();
}

/* ── 尺寸示意圖選擇 ─────────────────────────────────────────────
   商品的 dimFigure 欄位：空白＝依分類自動、"none"＝不顯示、其他＝指定哪一張（清單見
   dim-figures.js，那邊加新的示意圖這裡會自動多一個選項）。縮圖跟下面的預覽都是用前台
   同一份程式畫的，看到的就是客人看到的樣子；規格列有填「椅面」高度時會多標座高。 */
let workingDimFigure="";
function validDimFigure(value){return value==="none"||DIM_FIGURES.some(f=>f.key===value)?value:""}
window.renderFigurePicker=function(){
  const picker=document.getElementById("pFigurePicker");
  const preview=document.getElementById("pFigurePreview");
  if(!picker||!preview)return;
  const mainId=document.getElementById("pMainCat").value;
  const autoKey=autoDimFigureKey(getSubName(mainId,document.getElementById("pSubCat").value),getMainName(mainId));
  const seat=hasSeatHeight(workingSpecs);
  const selected=validDimFigure(workingDimFigure); // 不認得的值（例如之後拿掉的示意圖）當成自動
  const figureOf=key=>DIM_FIGURES.find(f=>f.key===key);
  // 示意圖格子只放圖、不寫品類名稱（名稱留在 aria-label 給螢幕閱讀器用，畫面上看不到）；
  // 「自動」「不顯示」兩格只放文字，自動會用哪張圖看下面的預覽
  const tile=(value,content,label="")=>`<button type="button" class="figure-tile${selected===value?" selected":""}" data-value="${value}" aria-pressed="${selected===value}"${label?` aria-label="${label}"`:""}>${content}</button>`;
  picker.innerHTML=tile("",`<span class="figure-text">自動</span>`)
    +DIM_FIGURES.map(f=>tile(f.key,dimFigureSvg(f.key,{seat}),f.label)).join("")
    +tile("none",`<span class="figure-none">不顯示</span>`);
  picker.querySelectorAll(".figure-tile").forEach(btn=>btn.addEventListener("click",()=>{
    workingDimFigure=btn.dataset.value;
    renderFigurePicker();
  }));
  const shownKey=selected==="none"?"":(selected||autoKey);
  if(!shownKey){
    preview.innerHTML=`<div class="figure-preview-text"><strong>前台不顯示示意圖</strong><span>尺寸數字照常顯示。</span></div>`;
    return;
  }
  const notes=[];
  if(!selected)notes.push("目前是「自動」，依分類選的；想換別張就點上面的圖。");
  if(seat)notes.push(figureOf(shownKey).seat?"有填「椅面」的高度，圖上會多標座高。":"這張圖沒有座面，座高只會出現在旁邊的數字。");
  // 預覽照這件商品填的寬深高比例畫，跟前台一樣；上面的格子用一般比例，方便認出是哪一種
  const dims=figureDimsOf({width:document.getElementById("pWidth").value,depth:document.getElementById("pDepth").value,height:document.getElementById("pHeight").value},workingSpecs);
  preview.innerHTML=`${dimFigureSvg(shownKey,{seat,dims})}<div class="figure-preview-text"><strong>前台會顯示這張圖</strong>${notes.map(n=>`<span>${n}</span>`).join("")}</div>`;
};
// 打字時很多次 input 事件併成一次重畫
let figureRefreshQueued=false;
// 改寬深高時預覽跟著變
for(const id of ["pWidth","pDepth","pHeight"])document.getElementById(id).addEventListener("input",()=>scheduleFigureRefresh());
function scheduleFigureRefresh(){
  if(figureRefreshQueued)return;
  figureRefreshQueued=true;
  requestAnimationFrame(()=>{figureRefreshQueued=false;renderFigurePicker()});
}

/* ── 顏色／款式編輯 ─────────────────────────────────────────── */
function renderOptionEditor(){
  const editor=document.getElementById("optionEditor");
  if(!editor)return;
  const filledSlots=workingPhotos.map((photo,k)=>photo?k:-1).filter(k=>k>=0);
  editor.innerHTML=workingOptions.map((o,i)=>`<div class="option-row" data-i="${i}">
    <input type="color" value="${/^#[0-9a-f]{6}$/i.test(o.color||"")?o.color:"#d8cbb8"}" title="顏色" aria-label="顏色">
    <input type="text" value="${escapeHTML(o.name||"")}" placeholder="名稱，例：白橡、梧桐木紋" aria-label="顏色／款式名稱">
    <select aria-label="點了換成哪張照片"><option value="">不換照片</option>${filledSlots.map(k=>`<option value="${k}"${o.photo===k?" selected":""}>換成照片 ${k+1}</option>`).join("")}</select>
    <button type="button" class="spec-del-btn" aria-label="刪除這個顏色／款式">×</button>
  </div>`).join("");
  editor.querySelectorAll(".option-row").forEach(row=>{
    const i=Number(row.dataset.i),o=workingOptions[i];
    const [color,name]=row.querySelectorAll("input");
    color.addEventListener("input",()=>{o.color=color.value});
    name.addEventListener("input",()=>{o.name=name.value});
    row.querySelector("select").addEventListener("change",e=>{o.photo=e.target.value===""?null:Number(e.target.value)});
    row.querySelector("button").addEventListener("click",()=>{workingOptions.splice(i,1);renderOptionEditor()});
  });
}
window.addOptionRow=function(){
  workingOptions.push({name:"",color:"#d8cbb8",photo:null});
  renderOptionEditor();
  document.querySelector("#optionEditor .option-row:last-child input[type=text]")?.focus();
};
// 照片換位置或刪掉時，顏色／款式指定的照片格跟著調整（換掉照片內容、補到空格都不用動）
function remapOptionPhotos(mapIndex){
  workingOptions.forEach(o=>{
    if(!Number.isInteger(o.photo))return;
    const next=mapIndex(o.photo);
    o.photo=Number.isInteger(next)?next:null;
  });
}
window.setLeadTime=function(text){document.getElementById("pLeadTime").value=text};

/* ── 價格：自動加「$」和千分位 ───────────────────────────────── */
// 純金額（可以已經打了 $／NT$、千分位逗號、空格、全形數字或「元」）→ 只留數字；
// 「洽詢」這類文字 → null，照原樣存、照原樣顯示
function priceDigits(text){
  const t=String(text??"").replace(/[０-９]/g,c=>String.fromCharCode(c.charCodeAt(0)-0xFEE0)).replace(/[\s,，]/g,"");
  const m=/^(?:NT\$|\$|＄)?(\d+)元?$/i.exec(t);
  return m?m[1].replace(/^0+(?=\d)/,""):null;
}
const groupThousands=digits=>digits.replace(/\B(?=(\d{3})+(?!\d))/g,",");
// 表格、匯入預覽顯示用：「100000」→「$ 100,000」（跟前台一樣），文字原樣
function priceLabel(text){
  const t=String(text??"").trim(),digits=priceDigits(t);
  return digits!=null?`$ ${groupThousands(digits)}`:t;
}
// 存檔用：金額只存數字（「100,000」→「100000」），文字原樣
function priceForSave(text){
  const t=String(text??"").trim(),digits=priceDigits(t);
  return digits!=null?digits:t;
}
function setPriceKind(input){
  const t=input.value.trim();
  input.parentElement.dataset.kind=!t?"empty":priceDigits(t)!=null?"num":"text";
}
function setPriceField(id,value){
  const input=document.getElementById(id);
  const t=String(value??"").trim(),digits=priceDigits(t);
  input.value=digits!=null?groupThousands(digits):t;
  setPriceKind(input);
}
// 邊打邊加千分位；游標放回原本那個數字後面，不然每打一個字游標就跳到最後
function formatPriceInput(input){
  const raw=input.value,digits=priceDigits(raw);
  if(digits!=null&&groupThousands(digits)!==raw){
    const formatted=groupThousands(digits);
    const half=raw.replace(/[０-９]/g,c=>String.fromCharCode(c.charCodeAt(0)-0xFEE0));
    const caret=input.selectionStart??raw.length;
    const dropped=half.replace(/\D/g,"").length-digits.length; // 拿掉的開頭 0
    const keep=Math.max(0,half.slice(0,caret).replace(/\D/g,"").length-dropped);
    let pos=0;
    for(let seen=0;pos<formatted.length&&seen<keep;pos++)if(formatted[pos]!==",")seen++;
    input.value=formatted;
    if(document.activeElement===input)input.setSelectionRange(pos,pos);
  }
  setPriceKind(input);
}
["pPrice","pSalePrice"].forEach(id=>{
  const input=document.getElementById(id);
  // 注音輸入選字中先不要動欄位內容，選完字（compositionend）再整理
  input.addEventListener("input",e=>{if(e.isComposing)setPriceKind(input);else formatPriceInput(input)});
  input.addEventListener("compositionend",()=>formatPriceInput(input));
});

/* ── 還沒儲存就關閉的提醒 ───────────────────────────────────── */
function productFormState(){
  const val=id=>document.getElementById(id).value;
  return JSON.stringify([val("pMainCat"),val("pSubCat"),val("pName"),val("pPrice"),val("pSalePrice"),val("pSaleEnd"),val("pLeadTime"),
    getCheckedBadges(),val("pWidth"),val("pDepth"),val("pHeight"),workingSpecs.filter(sp=>sp.part||sp.w||sp.d||sp.h),
    workingDimFigure,document.getElementById("pDesc").innerHTML,workingPhotos,workingOptions]);
}
function productFormDirty(){return productFormBaseline!==null&&productFormState()!==productFormBaseline}
window.requestCloseProductModal=function(){
  if(productFormDirty()&&!confirm("這個商品還有修改沒有儲存，確定要關閉嗎？（沒儲存的修改會不見）"))return;
  productFormBaseline=null;
  closeModal("productModal");
};
window.addEventListener("beforeunload",e=>{
  if(document.getElementById("productModal").classList.contains("open")&&productFormDirty()){e.preventDefault();e.returnValue=""}
});
window.duplicateProductRow=function(id){openProductModal(id,{copy:true})};

window.setUploadMethod=function(method,el){
  uploadMethod=method;
  el.parentElement.querySelectorAll(".upload-method-btn").forEach(b=>b.classList.remove("active")); // 只換這一排，批次上傳視窗那排不要動到
  el.classList.add("active");
  document.getElementById("urlInputPanel").style.display=method==="url"?"block":"none";
  document.getElementById("gdriveInputPanel").style.display=method==="gdrive"?"block":"none";
  renderPhotoSlots();
};
function renderPhotoSlots(){
  const container=document.getElementById("photoSlots");
  container.innerHTML="";
  let dragSrcIdx=null;
  for(let i=0;i<MAX_PHOTOS;i++){
    const src=workingPhotos[i];
    const slot=document.createElement("div");
    slot.className="photo-slot"+(src?" has-img":"")+(slotsUploading.has(i)?" is-uploading":"");
    slot.dataset.idx=i;
    if(src){
      const img=document.createElement("img");
      img.className="slot-img";
      img.src=normalizePhotoUrl(src);
      img.alt="";
      slot.appendChild(img);
      slot.draggable=true;
      slot.addEventListener("dragstart",e=>{
        dragSrcIdx=i;
        slot.classList.add("dragging");
        e.dataTransfer.effectAllowed="move";
      });
      slot.addEventListener("dragend",()=>{
        slot.classList.remove("dragging");
        container.querySelectorAll(".photo-slot").forEach(s=>s.classList.remove("drag-over"));
      });
      slot.addEventListener("dragover",e=>{
        e.preventDefault();
        e.dataTransfer.dropEffect="move";
        if(dragSrcIdx!==i)slot.classList.add("drag-over");
      });
      slot.addEventListener("dragleave",()=>slot.classList.remove("drag-over"));
      slot.addEventListener("drop",e=>{
        e.preventDefault();
        slot.classList.remove("drag-over");
        if(dragSrcIdx===null||dragSrcIdx===i)return;
        const tmp=workingPhotos[dragSrcIdx];
        workingPhotos[dragSrcIdx]=workingPhotos[i];
        workingPhotos[i]=tmp;
        const tmpOrig=workingPhotosOriginal[dragSrcIdx];
        workingPhotosOriginal[dragSrcIdx]=workingPhotosOriginal[i];
        workingPhotosOriginal[i]=tmpOrig;
        const from=dragSrcIdx;
        remapOptionPhotos(k=>k===from?i:k===i?from:k);
        dragSrcIdx=null;
        renderPhotoSlots();
        toast("圖片順序已更新");
      });
      const handle=document.createElement("div");
      handle.className="slot-drag-handle";
      handle.textContent="⠿ 拖曳排序";
      handle.addEventListener("mousedown",e=>e.stopPropagation());
      slot.appendChild(handle);
    }
    const num=document.createElement("span");
    num.className="slot-num";
    num.textContent=i+1;
    slot.appendChild(num);
    if(slotsUploading.has(i)){
      const spinner=document.createElement("div");
      spinner.className="slot-uploading-badge";
      spinner.textContent="上傳中…";
      slot.appendChild(spinner);
    }
    const overlay=document.createElement("div");
    overlay.className="slot-overlay";
    overlay.innerHTML=src?"更換":"新增";
    if(uploadMethod==="file"){
      const file=document.createElement("input");
      file.type="file";
      file.accept="image/*";
      file.className="slot-file-input";
      file.addEventListener("change",event=>handleSlotFile(i,event));
      slot.appendChild(file);
    }else{
      overlay.style.cursor="pointer";
      overlay.addEventListener("click",()=>promptUrlForSlot(i));
    }
    slot.appendChild(overlay);
    if(src){
      const del=document.createElement("button");
      del.className="slot-del";
      del.textContent="×";
      del.addEventListener("click",event=>{
        event.stopPropagation();
        workingPhotos[i]="";
        workingPhotosOriginal[i]="";
        const newIndex=new Map();
        workingPhotos.forEach((photo,idx)=>{if(photo)newIndex.set(idx,newIndex.size)});
        remapOptionPhotos(k=>newIndex.get(k));
        const filledPairs=workingPhotos.map((p,idx)=>[p,workingPhotosOriginal[idx]]).filter(([p])=>Boolean(p));
        workingPhotos=new Array(MAX_PHOTOS).fill("");
        workingPhotosOriginal=new Array(MAX_PHOTOS).fill("");
        filledPairs.forEach(([photo,orig],index)=>{workingPhotos[index]=photo;workingPhotosOriginal[index]=orig});
        renderPhotoSlots();
      });
      slot.appendChild(del);
      const crop=document.createElement("button");
      crop.className="slot-crop";
      crop.title="調整照片位置與縮放";
      crop.innerHTML="✂";
      crop.addEventListener("click",event=>{
        event.stopPropagation();
        openCropEditor(i);
      });
      slot.appendChild(crop);
    }
    container.appendChild(slot);
  }
  renderOptionEditor(); // 照片張數變了，顏色／款式的「換成照片 N」選單跟著更新
}
function handleSlotFile(slotIdx,event){
  const file=event.target.files[0];
  if(!file)return;
  event.target.value=""; // 清空，方便下次選同一個檔案也會觸發 change
  const openedFor=editingProductId;
  slotsUploading.add(slotIdx);
  renderPhotoSlots();
  uploadToCloudinary(file).then(url=>{
    if(editingProductId!==openedFor)return; // 上傳期間切換到別的商品了，不要寫進現在畫面
    // 原圖跟顯示用的圖先設成同一個網址（都是剛上傳的原始畫質），
    // 之後如果用裁切編輯器調整過，只有顯示用那份會換成裁切後的新網址，
    // 原圖這份維持不動，才能隨時回去重新調整。
    workingPhotosOriginal[slotIdx]=url;
    workingPhotos[slotIdx]=url;
  }).catch(async e=>{
    console.warn("Cloudinary 上傳失敗，改用本機暫存",e);
    if(editingProductId!==openedFor)return;
    toast("圖床上傳失敗，已改用本機暫存，建議稍後重新上傳這張照片",4000);
    try{
      const dataUrl=await new Promise((resolve,reject)=>{
        const reader=new FileReader();
        reader.onload=ev=>resolve(ev.target.result);
        reader.onerror=reject;
        reader.readAsDataURL(file);
      });
      if(editingProductId!==openedFor)return;
      workingPhotosOriginal[slotIdx]=dataUrl;
      workingPhotos[slotIdx]=await resizeImageToUniform(dataUrl);
    }catch(e2){
      toast("圖片讀取失敗，請重試");
    }
  }).finally(()=>{
    slotsUploading.delete(slotIdx);
    renderPhotoSlots();
  });
}
async function promptUrlForSlot(slotIdx){
  const inputId=uploadMethod==="gdrive"?"gdriveInput":"urlInput";
  const raw=document.getElementById(inputId).value.trim();
  if(!raw){toast("請先在上方輸入連結");return}
  // Google Drive 分享連結要先轉成可以直接讀取圖片的網址格式，Cloudinary 才抓得到
  const fetchable=uploadMethod==="gdrive"?convertGdriveUrl(raw):raw;
  const openedFor=editingProductId;
  slotsUploading.add(slotIdx);
  renderPhotoSlots();
  try{
    const url=await uploadToCloudinary(fetchable);
    if(editingProductId===openedFor){
      workingPhotosOriginal[slotIdx]=url;
      workingPhotos[slotIdx]=url;
      toast("圖片已設定");
    }
  }catch(e){
    console.warn("Cloudinary 上傳失敗，改用原始連結",e);
    if(editingProductId===openedFor){
      toast("圖床上傳失敗，改直接使用你貼的連結（畫質/穩定度可能較差）",4000);
      const normalized=normalizePhotoUrl(fetchable);
      workingPhotosOriginal[slotIdx]=normalized;
      workingPhotos[slotIdx]=await resizeImageToUniform(normalized);
    }
  }
  slotsUploading.delete(slotIdx);
  renderPhotoSlots();
}

window.addPhotoByUrl=async function(){
  const raw=document.getElementById("urlInput").value.trim();
  if(!raw){toast("請輸入圖片網址");return}
  await addWorkingPhoto(raw);
};
window.addPhotoByGdrive=async function(){
  const raw=document.getElementById("gdriveInput").value.trim();
  if(!raw){toast("請輸入 Google Drive 連結");return}
  await addWorkingPhoto(convertGdriveUrl(raw));
};
async function addWorkingPhoto(raw){
  // 排除 slotsUploading 裡「正在上傳、畫面上還沒填值」的格子，避免兩個上傳
  // 幾乎同時開始時算出同一個「空格」，導致其中一張照片被另一張蓋掉遺失。
  let empty=-1;
  for(let i=0;i<MAX_PHOTOS;i++){
    if(!workingPhotos[i]&&!slotsUploading.has(i)){empty=i;break}
  }
  if(empty===-1){toast(`已達 ${MAX_PHOTOS} 張上限`);return}
  const openedFor=editingProductId;
  slotsUploading.add(empty);
  renderPhotoSlots();
  try{
    const url=await uploadToCloudinary(raw);
    if(editingProductId===openedFor){
      workingPhotosOriginal[empty]=url;
      workingPhotos[empty]=url;
      toast("圖片已新增");
    }
  }catch(e){
    console.warn("Cloudinary 上傳失敗，改用原始連結",e);
    if(editingProductId===openedFor){
      toast("圖床上傳失敗，改直接使用你貼的連結（畫質/穩定度可能較差）",4000);
      const normalized=normalizePhotoUrl(raw);
      workingPhotosOriginal[empty]=normalized;
      workingPhotos[empty]=await resizeImageToUniform(normalized);
    }
  }
  slotsUploading.delete(empty);
  renderPhotoSlots();
}

/* ── 商品標籤（可在後台新增／改名／刪除，順序＝優先順序，存進 Firestore 的 tagDefs）── */
function renderBadgeCheckboxes(selected){
  const wrap=document.getElementById("pBadges");
  if(!tagDefs.length){
    wrap.innerHTML=`<span style="font-size:13px;color:var(--soft)">尚未建立任何標籤，點右邊「標籤管理」新增</span>`;
    return;
  }
  wrap.innerHTML=tagDefs.map(def=>`
    <label class="tag-checkbox-item">
      <input type="checkbox" value="${escapeHTML(def.key)}" ${selected.includes(def.key)?"checked":""}>
      <span class="swatch" style="background:${escapeHTML(def.color)}"></span>
      ${escapeHTML(def.label)}
    </label>
  `).join("");
}
function getCheckedBadges(){
  return [...document.querySelectorAll('#pBadges input[type="checkbox"]:checked')].map(el=>el.value);
}

/* ── 標籤管理（新增／改名／刪除／排序，跟分類管理是同一套邏輯）───── */
const TAG_SWATCH_PALETTE=["#b84236","#8c491a","#905229","#5b6746","#4d5d6b","#201e1d","#696255","#645c50","#6b4c7a","#3d6b70"];
function nextTagColor(){
  const used=new Set(tagDefs.map(d=>d.color));
  return TAG_SWATCH_PALETTE.find(c=>!used.has(c))||TAG_SWATCH_PALETTE[tagDefs.length%TAG_SWATCH_PALETTE.length];
}
window.openTagManage=function(){
  renderTagMgrList();
  openModal("tagMgrModal");
};
window.closeTagManage=async function(){
  closeModal("tagMgrModal");
  if(await saveMeta())toast("標籤已儲存 ☁️");
};
function renderTagMgrList(){
  const wrap=document.getElementById("tagMgrList");
  if(!tagDefs.length){
    wrap.innerHTML=`<div style="padding:16px 0;color:var(--soft);font-size:13px">目前沒有任何標籤，點下方新增。</div>`;
    return;
  }
  wrap.innerHTML="";
  tagDefs.forEach((def)=>{
    const row=document.createElement("div");
    row.className="tagmgr-row";
    row.draggable=true;
    row.dataset.key=def.key;
    row.innerHTML=`
      <span class="drag-handle" title="拖曳調整順序">⠿</span>
      <input type="color" value="${escapeHTML(def.color)}" title="標籤顏色">
      <input type="text" value="${escapeHTML(def.label)}" placeholder="標籤名稱">
      <button class="catmgr-icon-btn danger" title="刪除標籤">🗑</button>
    `;
    const [,colorInput,nameInput,delBtn]=row.children;
    colorInput.addEventListener("input",()=>{def.color=colorInput.value});
    nameInput.addEventListener("input",()=>{def.label=nameInput.value});
    delBtn.onclick=()=>deleteTagRequest(def.key);
    wrap.appendChild(row);
  });
}
let dragTagKey=null;
const tagMgrListEl=document.getElementById("tagMgrList");
tagMgrListEl.addEventListener("dragstart",e=>{
  const row=e.target.closest(".tagmgr-row");
  if(!row)return;
  dragTagKey=row.dataset.key;
  row.classList.add("dragging");
});
tagMgrListEl.addEventListener("dragend",()=>{
  tagMgrListEl.querySelectorAll(".tagmgr-row").forEach(r=>r.classList.remove("dragging","drag-over"));
  dragTagKey=null;
});
tagMgrListEl.addEventListener("dragover",e=>{
  const row=e.target.closest(".tagmgr-row");
  if(!row||!dragTagKey||row.dataset.key===dragTagKey)return;
  e.preventDefault();
  row.classList.add("drag-over");
});
tagMgrListEl.addEventListener("dragleave",e=>{
  const row=e.target.closest(".tagmgr-row");
  if(row)row.classList.remove("drag-over");
});
tagMgrListEl.addEventListener("drop",e=>{
  const row=e.target.closest(".tagmgr-row");
  if(!row||!dragTagKey)return;
  e.preventDefault();
  row.classList.remove("drag-over");
  const targetKey=row.dataset.key;
  const srcKey=dragTagKey;
  dragTagKey=null;
  if(targetKey===srcKey)return;
  const srcIdx=tagDefs.findIndex(d=>d.key===srcKey);
  const targetIdx=tagDefs.findIndex(d=>d.key===targetKey);
  if(srcIdx<0||targetIdx<0)return;
  const [moved]=tagDefs.splice(srcIdx,1);
  tagDefs.splice(targetIdx,0,moved);
  renderTagMgrList();
});
window.addTagInline=function(){
  const name=(prompt("請輸入新標籤名稱：")||"").trim();
  if(!name)return;
  const key="tag-"+uid();
  tagDefs.push({key,label:name,color:nextTagColor()});
  renderTagMgrList();
  toast("標籤已新增");
};
function deleteTagRequest(key){
  const def=tagDefs.find(d=>d.key===key);
  if(!def)return;
  const affected=products.filter(p=>(p.badges||[]).includes(key));
  const msg=affected.length
    ?`確定要刪除標籤「${def.label}」嗎？目前有 ${affected.length} 件商品掛著這個標籤，刪除後會一併從這些商品身上移除。`
    :`確定要刪除標籤「${def.label}」嗎？`;
  if(!confirm(msg))return;
  tagDefs=tagDefs.filter(d=>d.key!==key);
  if(affected.length){
    affected.forEach(p=>{p.badges=(p.badges||[]).filter(b=>b!==key)});
    (async()=>{
      try{
        await patchProducts(affected,["badges"]);
      }catch(e){
        toast("商品標籤更新寫入失敗："+(e.message||String(e)),4000);
      }
    })();
  }
  renderTagMgrList();
  toast("標籤已刪除");
}

// copy：複製這件商品——帶入它的全部內容（含照片）開成「新增商品」，按儲存才會建立新商品
window.openProductModal=async function(id,{copy=false}={}){
  const token=++productModalToken;
  productFormBaseline=null;
  editingProductId=copy?null:id;
  workingPhotos=new Array(MAX_PHOTOS).fill("");
  workingPhotosOriginal=new Array(MAX_PHOTOS).fill("");
  workingSpecs=[];
  workingOptions=[];
  const source=id?products.find(p=>p.id===id):null;
  document.getElementById("productModalTitle").textContent=copy?`新增商品（複製自「${source?.name||""}」）`:id?"編輯商品":"新增商品";
  const viewLink=document.getElementById("productViewLink");
  viewLink.hidden=!(id&&!copy&&source?.status==="active");
  viewLink.href=`index.html#product-${encodeURIComponent(id||"")}`;
  document.getElementById("urlInput").value="";
  document.getElementById("gdriveInput").value="";
  setUploadMethod("file",document.querySelector(".upload-method-btn"));
  renderCatSelect();
  rteInit("pDesc");
  closeAiHelper(); // 上一件商品的提示詞不要留著
  if(id){
    const product=products.find(p=>p.id===id);
    if(!product)return;
    document.getElementById("pMainCat").value=product.mainCat||"";
    updateSubSelect();
    document.getElementById("pSubCat").value=product.subCat||"";
    document.getElementById("pName").value=copy?`${product.name||""}（複製）`:product.name||"";
    setPriceField("pPrice",product.price);
    setPriceField("pSalePrice",product.salePrice);
    document.getElementById("pSaleEnd").value=product.saleEnd||"";
    document.getElementById("pLeadTime").value=product.leadTime||"";
    workingOptions=(product.options||[]).map(o=>({name:o.name||"",color:o.color||"#d8cbb8",photo:Number.isInteger(o.photo)?o.photo:null}));
    renderBadgeCheckboxes(product.badges||[]);
    const dims=product.dimensions||{};
    document.getElementById("pWidth").value=dims.width||"";
    document.getElementById("pDepth").value=dims.depth||"";
    document.getElementById("pHeight").value=dims.height||"";
    workingSpecs=(product.specs||[]).map(spec=>{
      if("part" in spec)return {...spec};
      return {part:spec.label||"",w:spec.value||"",d:"",h:""};
    });
    // 尺寸文字現在一律照寬深高產生；很早以前只有一段尺寸文字的商品，把那段字放進規格列，看得到也改得到，存檔時才不會不見
    if(!workingSpecs.length&&![dims.width,dims.depth,dims.height].some(v=>String(v??"").trim())&&isSizeValue(product.size)){
      workingSpecs=[{part:"尺寸備註",w:String(product.size).trim(),d:"",h:""}];
    }
    workingDimFigure=product.dimFigure||"";
    renderFigurePicker();
    // 商品說明是直接從資料庫讀出來的 HTML，理論上只有存檔時經過這個編輯器
    // 自己的過濾，但資料庫本身不會強制套用這層過濾——用同一個 sanitizeRichText
    // 保險起見再過濾一次，才不會有已經寫進資料庫的內容一打開編輯就直接執行。
    document.getElementById("pDesc").innerHTML=sanitizeRichText(product.desc||"");
    let cover=(product.photos||[]).filter(Boolean);
    let coverOriginals=[];
    // 商品文件的封面只是縮圖，編輯時一律要換成 gallery 子文件裡的原始畫質照片
    const totalCount=product.photoCount??cover.length;
    if(totalCount>0){
      renderPhotoSlots();
      openModal("productModal");
      const galleryData=await loadGallery(id);
      if(token!==productModalToken)return; // 使用者切換到別的商品了，不要覆蓋畫面
      if(galleryData.photos.length){cover=galleryData.photos;coverOriginals=galleryData.originals}
    }
    cover.slice(0,MAX_PHOTOS).forEach((photo,index)=>workingPhotos[index]=photo);
    workingPhotosOriginal=new Array(MAX_PHOTOS).fill("");
    coverOriginals.slice(0,MAX_PHOTOS).forEach((orig,index)=>{if(orig)workingPhotosOriginal[index]=orig});
  }else{
    document.getElementById("pMainCat").value=catalog[0]?.id||"";
    updateSubSelect();
    ["pName","pWidth","pDepth","pHeight"].forEach(fid=>document.getElementById(fid).value="");
    ["pSaleEnd","pLeadTime"].forEach(fid=>document.getElementById(fid).value="");
    setPriceField("pPrice","");
    setPriceField("pSalePrice","");
    renderBadgeCheckboxes([]);
    document.getElementById("pDesc").innerHTML="";
    workingDimFigure="";
  }
  renderSpecEditor();
  renderPhotoSlots();
  openModal("productModal");
  productFormBaseline=productFormState();
};

function getSizeSummary(dimensions,size){
  const parts=[];
  if(dimensions.width)parts.push(`寬 ${dimensions.width}`);
  if(dimensions.depth)parts.push(`深 ${dimensions.depth}`);
  if(dimensions.height)parts.push(`高 ${dimensions.height}`);
  return parts.length?`${parts.join(" x ")} cm`:(size||"");
}

// 提醒：前台 index.html 的 Google Fonts 網址有做「字型子集」優化，只包含當初產生時
// 網站文字＋商品資料裡出現過的中文字（約 831 個），藉此縮小字型檔案大小。這裡新增/修改的
// 商品名稱、說明如果用到全新的字，前台不會壞掉，只是那個字會自動改用瀏覽器內建字型顯示，
// 字體會跟其他文字不太一樣。商品種類變多、或想確保新字都涵蓋到的話，可以請 Claude
// 「重新產生字型子集」，掃一次目前的商品資料重新產生 index.html 那三個字型網址。
let productSaving=false; // 儲存中：擋掉連按，新增商品時才不會建立兩件一樣的
window.saveProduct=async function(){
  if(productSaving)return;
  if(slotsUploading.size){toast("還有照片正在上傳中，請稍候幾秒再儲存");return}
  const name=document.getElementById("pName").value.trim();
  if(!name){toast("請填寫商品名稱");return}
  const dimensions={
    width:document.getElementById("pWidth").value.trim(),
    depth:document.getElementById("pDepth").value.trim(),
    height:document.getElementById("pHeight").value.trim()
  };
  // 尺寸文字跟著寬深高走（前台卡片、收藏清單、LINE 訊息用）；寬深高清空就跟著清空，不會留下舊尺寸
  const size=getSizeSummary(dimensions,"");
  const rawDesc=document.getElementById("pDesc").innerHTML.trim();
  const data={
    mainCat:document.getElementById("pMainCat").value,
    subCat:document.getElementById("pSubCat").value||null,
    name,
    price:priceForSave(document.getElementById("pPrice").value),
    badges:getCheckedBadges(),
    size,
    dimensions,
    specs:workingSpecs.filter(spec=>spec.part||spec.w||spec.d||spec.h).map(spec=>({
      part:(spec.part||"").trim(),
      w:(spec.w||"").trim(),
      d:(spec.d||"").trim(),
      h:(spec.h||"").trim()
    })),
    dimFigure:validDimFigure(workingDimFigure),
    salePrice:priceForSave(document.getElementById("pSalePrice").value),
    saleEnd:document.getElementById("pSaleEnd").value,
    leadTime:document.getElementById("pLeadTime").value.trim(),
    options:workingOptions.filter(o=>o.name.trim()).map(o=>({
      name:o.name.trim(),
      color:/^#[0-9a-f]{6}$/i.test(o.color)?o.color:"#d8cbb8",
      // 照片格位置 → 存起來的第幾張（照片中間有空格時兩者不一樣）
      photo:Number.isInteger(o.photo)&&workingPhotos[o.photo]?workingPhotos.slice(0,o.photo).filter(Boolean).length:null
    })),
    desc:richTextIsEmpty(rawDesc)?"":sanitizeRichText(rawDesc)
  };
  // 這裡故意不用 normalizePhotoUrl：那個函式現在會幫 Cloudinary 網址加上
  // f_auto,q_auto 之類的顯示用轉換參數，只適合在「畫面上要顯示」的當下呼叫，
  // 不能存進資料庫——不然轉換參數會永久烤進存起來的網址，之後想依照顯示位置
  // 動態加不同尺寸（例如列表縮圖用 w_500）就會疊出一長串重複的轉換參數。
  // Google Drive 連結例外：分享連結本身不是圖片網址，一定要轉成真正的縮圖
  // 網址格式才能當 <img src> 使用，所以還是要轉，只是只轉 Drive、不轉 Cloudinary。
  const saveBtn=document.getElementById("productSaveBtn");
  productSaving=true;
  saveBtn.disabled=true;
  saveBtn.textContent="儲存中…";
  try{
    await retryLocalPhotos();
    const fullPhotos=workingPhotos.filter(Boolean).map(url=>/drive\.google\.com/i.test(url)?convertGdriveUrl(url):url);
    // 原圖陣列要跟 fullPhotos 用同一套「哪些欄位有值」規則過濾，位置才會對得上
    const fullOriginals=workingPhotos.map((p,i)=>p?(workingPhotosOriginal[i]||""):null).filter(v=>v!==null);
    // 商品文件只存封面照的縮圖版本＋photoCount，原始畫質照片另外寫進 gallery 子文件
    data.photos=fullPhotos.length?[await thumbFor(fullPhotos[0])]:[];
    data.photoCount=fullPhotos.length;
    const index=editingProductId?products.findIndex(p=>p.id===editingProductId):-1;
    let product;
    if(index>=0){
      const prev=products[index];
      product={id:editingProductId,status:prev.status,sortOrder:prev.sortOrder,updatedAt:prev.updatedAt,...data};
      // 在垃圾桶裡改內容也要記得是什麼時候丟的，30 天到期一樣會自動清掉
      if(prev.status==="trashed")Object.assign(product,{trashedAt:prev.trashedAt??Date.now(),trashedFrom:prev.trashedFrom||"active"});
    }else{
      product={id:uid(),status:"active",sortOrder:nextSortOrder(),...data};
    }
    try{
      await writeProducts([product],{check:index>=0});
    }catch(e){
      // 沒存進去：畫面跟表格都不動，編輯視窗留著，改好的內容還在，可以再按一次
      showProductSaveError(e,"儲存失敗");
      return;
    }
    if(index>=0)products[index]=product;
    else{
      products.push(product);
      editingProductId=product.id; // 新商品已經建立了，照片沒存到而再按一次儲存時，要改同一件、不能再建一件
    }
    updateTotalCount();
    renderSidebar();
    renderTable();
    try{
      await saveGallery(product.id,fullPhotos,fullOriginals);
    }catch(e){
      showProductSaveError(e,"商品資料已儲存，但照片沒有存成功");
      return;
    }
    toast(index>=0?"商品已更新 ☁️":"商品已新增 ☁️");
    productFormBaseline=null;
    closeModal("productModal");
  }catch(e){
    showProductSaveError(e,"儲存失敗");
  }finally{
    productSaving=false;
    saveBtn.disabled=false;
    saveBtn.textContent="儲存商品";
  }
};
// 之前圖床上傳失敗、暫存成 base64 的照片，存檔時再試一次搬到圖床；還是失敗就照舊先存在資料庫
async function retryLocalPhotos(){
  const upload=async src=>uploadToCloudinary(await(await fetch(src)).blob());
  for(let i=0;i<workingPhotos.length;i++){
    const photo=workingPhotos[i],original=workingPhotosOriginal[i];
    if(!isLocalPhoto(photo)&&!isLocalPhoto(original))continue;
    try{
      const url=isLocalPhoto(photo)?await upload(photo):photo;
      workingPhotos[i]=url;
      if(isLocalPhoto(original))workingPhotosOriginal[i]=original===photo?url:await upload(original);
    }catch(e){
      console.warn("暫存照片補傳圖床失敗，先照舊存在資料庫",e);
    }
  }
}
function showProductSaveError(e,prefix){
  if(e?.cancelled){toast(e.message+"（編輯視窗還開著，改好的內容還在）",7000);return}
  const msg=e.message||String(e);
  if(/exceeds the maximum allowed size/i.test(msg))toast(`${prefix}：這個商品的照片加起來太大了，請減少照片張數，或用「調整照片位置與縮放」裁切掉不必要的部分後再試一次`,6000);
  else toast(`${prefix}：${msg}（編輯視窗還開著，可以再按一次「儲存商品」）`,6000);
}

window.archiveProductRow=async function(id){
  const p=products.find(p=>p.id===id);
  if(p&&await saveProductsChange([p],p=>{p.status="archived"}))toast("已封存");
};
window.restoreProductRow=async function(id){
  const p=products.find(p=>p.id===id);
  // 還原上架時排到最後面，避免沿用封存前的舊排序數值跟現在其他商品「撞號」，
  // 導致還原後的商品出現在畫面上很奇怪的位置。
  if(p&&await saveProductsChange([p],p=>{p.status="active";p.sortOrder=nextSortOrder()}))toast("已還原上架");
};
window.trashProductRow=async function(id){
  const p=products.find(p=>p.id===id);
  if(!p)return;
  if(!confirm(`把「${p.name}」丟進垃圾桶嗎？${TRASH_DAYS} 天內都可以在「垃圾桶」救回來。`))return;
  if(await saveProductsChange([p],moveToTrash))toast(`已丟進垃圾桶，${TRASH_DAYS} 天內可以救回`);
};
window.untrashProductRow=async function(id){
  const p=products.find(p=>p.id===id);
  if(p&&await saveProductsChange([p],takeOutOfTrash))toast(p.status==="active"?"已救回並上架":"已救回（封存中）");
};
// 只有垃圾桶裡的商品可以永久刪除
window.deleteProductRow=async function(id){
  const p=products.find(p=>p.id===id);
  if(!p)return;
  if(!confirm(`永久刪除後就救不回來了，確定要刪除「${p.name}」嗎？`))return;
  try{
    await deleteDoc(doc(productsCol(),id));
  }catch(e){
    toast("刪除失敗："+(e.message||String(e)),4000);
    return;
  }
  try{await deleteDoc(galleryDocRef(id))}catch(e){}
  products=products.filter(p=>p.id!==id);
  toast("已永久刪除");
  updateTotalCount();
  renderSidebar();
  renderTable();
};

function missingFlags(p){
  return {
    noCat: !p.mainCat,
    noSize: !hasSize(p),
    noDesc: richTextIsEmpty(p.desc),
    noPhoto: !(p.photos||[]).filter(Boolean).length
  };
}

/* ── 詢價熱度：統計客人存下的收藏清單（前台「一次詢問」「複製清單連結」都會存一份，
   存在 sitedata/{SITE_DOC}/wishlists，每份是 {ids, createdAt}）──────────────── */
let heatLists=null;
let heatRange="30";
let heatShowAll=false;
const HEAT_TOP=15;
window.openHeatReport=async function(){
  heatLists=null;
  heatShowAll=false;
  renderHeatRange();
  document.getElementById("heatBody").innerHTML='<p class="heat-empty">讀取中…</p>';
  openModal("heatModal");
  try{
    const snap=await getDocs(collection(db,"sitedata",SITE_DOC,"wishlists"));
    heatLists=snap.docs.map(d=>d.data()).filter(d=>Array.isArray(d.ids));
  }catch(e){
    const denied=/permission/i.test(`${e.code||""} ${e.message||""}`);
    document.getElementById("heatBody").innerHTML=`<p class="heat-empty">${denied
      ?"讀不到收藏清單：資料庫的權限設定沒有開放後台讀取「wishlists」。"
      :"讀取收藏清單失敗，請稍後再試一次。"}<br>（${escapeHTML(e.message||String(e))}）</p>`;
    return;
  }
  renderHeatReport();
};
function renderHeatRange(){
  document.querySelectorAll("#heatModal .heat-range button").forEach(b=>{
    const on=b.dataset.range===heatRange;
    b.classList.toggle("active",on);
    b.setAttribute("aria-pressed",String(on));
  });
}
document.querySelectorAll("#heatModal .heat-range button").forEach(b=>b.addEventListener("click",()=>{
  heatRange=b.dataset.range;
  heatShowAll=false;
  renderHeatRange();
  if(heatLists)renderHeatReport();
}));
// 統計：每件商品出現在幾份清單、最近一次是什麼時候，以及哪兩件常常一起出現
function heatStats(lists){
  const byId=new Map(products.map(p=>[p.id,p]));
  const items=new Map(),pairs=new Map();
  let missing=0;
  for(const list of lists){
    const ids=[...new Set(list.ids.filter(id=>typeof id==="string"))];
    const known=ids.filter(id=>byId.has(id)).sort();
    missing+=ids.length-known.length;
    for(const id of known){
      const it=items.get(id)||{product:byId.get(id),count:0,last:0};
      it.count++;
      it.last=Math.max(it.last,list.createdAt||0);
      items.set(id,it);
    }
    for(let i=0;i<known.length;i++)for(let j=i+1;j<known.length;j++){
      const key=known[i]+"|"+known[j];
      pairs.set(key,(pairs.get(key)||0)+1);
    }
  }
  const ranked=[...items.values()].sort((a,b)=>b.count-a.count||b.last-a.last||(a.product.name||"").localeCompare(b.product.name||"","zh-Hant"));
  const topPairs=[...pairs.entries()].filter(([,n])=>n>=2).sort((a,b)=>b[1]-a[1]).slice(0,8)
    .map(([key,n])=>({a:byId.get(key.split("|")[0]),b:byId.get(key.split("|")[1]),count:n}));
  return{ranked,topPairs,missing};
}
const heatStatusNote=p=>isLive(p)?"":`<small>${p.status==="trashed"?"在垃圾桶":"已封存"}</small>`;
const shortDate=ms=>{const d=new Date(ms);return `${d.getMonth()+1}/${d.getDate()}`};
function renderHeatReport(){
  const body=document.getElementById("heatBody");
  const since=Date.now()-Number(heatRange)*864e5;
  const lists=heatRange==="all"?heatLists:heatLists.filter(l=>typeof l.createdAt==="number"&&l.createdAt>=since);
  const rangeText=heatRange==="all"?"到目前為止":`近 ${heatRange} 天`;
  if(!lists.length){
    body.innerHTML=`<p class="heat-empty">${rangeText}還沒有客人存收藏清單。客人把商品加進收藏、按「一次詢問」之後，這裡就會開始有資料。</p>`;
    return;
  }
  const {ranked,topPairs,missing}=heatStats(lists);
  const itemTotal=lists.reduce((sum,l)=>sum+new Set(l.ids).size,0);
  const max=ranked[0]?.count||1;
  const shown=heatShowAll?ranked:ranked.slice(0,HEAT_TOP);
  body.innerHTML=`
    <div class="heat-kpis">
      <div class="heat-kpi"><div class="heat-kpi-v">${lists.length}</div><div class="heat-kpi-l">份收藏清單</div></div>
      <div class="heat-kpi"><div class="heat-kpi-v">${ranked.length}</div><div class="heat-kpi-l">件商品被問過</div></div>
      <div class="heat-kpi"><div class="heat-kpi-v">${(itemTotal/lists.length).toFixed(1)}</div><div class="heat-kpi-l">平均每份幾件</div></div>
    </div>
    <div class="heat-h">最常被詢問的商品</div>
    ${ranked.length?`<ol class="heat-bars">${shown.map((it,i)=>`
      <li><button type="button" class="heat-row" data-id="${escapeHTML(it.product.id)}" data-i="${i}">
        <span class="heat-rank">${i+1}</span>
        <span class="heat-name">${escapeHTML(it.product.name||"（未命名）")}${heatStatusNote(it.product)}</span>
        <span class="heat-track"><span class="heat-bar" style="width:calc((100% - 34px) * ${(it.count/max).toFixed(4)})"></span><span class="heat-val">${it.count}</span></span>
      </button></li>`).join("")}</ol>
      ${ranked.length>HEAT_TOP?`<button type="button" class="heat-more" id="heatMoreBtn">${heatShowAll?"只看前 "+HEAT_TOP+" 名":`顯示全部 ${ranked.length} 件`}</button>`:'<div class="heat-gap"></div>'}`
      :'<p class="heat-empty">清單裡的商品都已經永久刪除了。</p>'}
    <div class="heat-h">常一起被詢問的組合</div>
    ${topPairs.length?`<ul class="heat-pairs">${topPairs.map(pr=>`
      <li><span>${escapeHTML(pr.a.name||"（未命名）")}<span class="heat-plus">＋</span>${escapeHTML(pr.b.name||"（未命名）")}</span><span class="heat-pair-n">${pr.count} 次</span></li>`).join("")}</ul>`
      :'<p class="heat-empty">還沒有兩件商品一起出現在 2 份以上的清單。</p>'}
    ${missing?`<p class="heat-foot">另有 ${missing} 次詢問的商品已經永久刪除，沒有列在上面。</p>`:""}`;
  document.getElementById("heatMoreBtn")?.addEventListener("click",()=>{heatShowAll=!heatShowAll;renderHeatReport()});
  const tip=document.getElementById("heatTip");
  const modal=tip.parentElement;
  const showTip=(row,x,y)=>{
    const it=shown[Number(row.dataset.i)];
    const pct=Math.round(it.count/lists.length*100);
    tip.replaceChildren();
    const strong=document.createElement("strong");
    strong.textContent=`${it.count} 份清單有這件`;
    const name=document.createElement("span");
    name.textContent=it.product.name||"（未命名）";
    const more=document.createElement("span");
    more.textContent=`佔${rangeText}清單的 ${pct}%${it.last?`・最近一次 ${shortDate(it.last)}`:""}・點一下打開商品`;
    tip.append(strong,name,more);
    tip.hidden=false;
    const box=modal.getBoundingClientRect();
    const left=Math.min(x-box.left+14,box.width-tip.offsetWidth-8);
    let top=y-box.top+16;
    if(top+tip.offsetHeight>box.height-8)top=y-box.top-tip.offsetHeight-12;
    tip.style.left=Math.max(8,left)+"px";
    tip.style.top=Math.max(8,top)+"px";
  };
  const hideTip=()=>{tip.hidden=true};
  body.querySelectorAll(".heat-row").forEach(row=>{
    row.addEventListener("pointermove",e=>showTip(row,e.clientX,e.clientY));
    row.addEventListener("pointerleave",hideTip);
    row.addEventListener("focus",()=>{const r=row.getBoundingClientRect();showTip(row,r.left+r.width*.55,r.bottom-6)});
    row.addEventListener("blur",hideTip);
    row.addEventListener("click",()=>{hideTip();closeModal("heatModal");openProductModal(row.dataset.id)});
  });
}

/* ── 完整備份與還原：網站設定＋所有商品（含封存、垃圾桶）＋每件商品的完整照片清單 ── */
const BACKUP_FORMAT="hsshop-backup";
let pendingRestore=null;
const backupFileName=(note="")=>`信通家俱行-完整備份${note?"-"+note:""}-${localDateStr()}.json`;
// 直接從資料庫讀最新的一份（不是用畫面上的資料），照片清單一次讀 8 件
async function buildFullBackup(onProgress){
  const siteSnap=await getDoc(doc(db,"sitedata",SITE_DOC));
  const productsSnap=await getDocs(productsCol());
  const list=productsSnap.docs.map(d=>d.data());
  const galleries={};
  for(let i=0;i<list.length;i+=8){
    await Promise.all(list.slice(i,i+8).map(async p=>{
      const snap=await getDoc(galleryDocRef(p.id));
      if(!snap.exists())return;
      const g=snap.data();
      galleries[p.id]={photos:g.photos||[],photoOriginals:g.photoOriginals||[]};
    }));
    onProgress?.(Math.min(i+8,list.length),list.length);
  }
  return{format:BACKUP_FORMAT,version:1,createdAt:new Date().toISOString(),site:siteSnap.exists()?siteSnap.data():{},products:list,galleries};
}
const downloadBackup=(data,note)=>downloadBlob(new Blob([JSON.stringify(data)],{type:"application/json"}),backupFileName(note));
window.downloadFullBackup=async function(){
  toast("正在準備備份…",3000);
  try{
    const data=await buildFullBackup((done,total)=>toast(`正在備份… ${done}/${total}`,3000));
    downloadBackup(data);
    toast(`已下載完整備份（${data.products.length} 件商品）`,3500);
  }catch(e){
    toast("備份失敗："+(e.message||String(e)),5000);
  }
};
// 檢查是不是這個後台下載的備份檔，格式不對就整份不用
function parseBackup(text){
  let data;
  try{data=JSON.parse(text)}catch(e){throw new Error("讀不懂這個檔案，請選後台「下載完整備份」存下來的 .json 檔")}
  if(!data||data.format!==BACKUP_FORMAT)throw new Error("這不是後台「下載完整備份」存下來的檔案");
  if(data.version!==1)throw new Error("這個備份檔的版本這個後台看不懂");
  if(!data.site||typeof data.site!=="object"||Array.isArray(data.site))throw new Error("備份檔裡少了網站設定");
  if(!Array.isArray(data.products))throw new Error("備份檔裡少了商品資料");
  const ids=new Set();
  for(const p of data.products){
    if(!p||typeof p!=="object"||typeof p.id!=="string"||!p.id||p.id.includes("/"))throw new Error("備份檔裡有商品資料格式不對");
    if(ids.has(p.id))throw new Error(`備份檔裡有重複的商品（${p.id}）`);
    ids.add(p.id);
  }
  const galleries={};
  for(const [id,g] of Object.entries(data.galleries&&typeof data.galleries==="object"?data.galleries:{})){
    if(!ids.has(id))continue;
    if(!g||!Array.isArray(g.photos))throw new Error("備份檔裡有照片資料格式不對");
    galleries[id]={photos:g.photos,photoOriginals:Array.isArray(g.photoOriginals)?g.photoOriginals:[]};
  }
  data.galleries=galleries;
  return data;
}
window.handleBackupFile=async function(event){
  const file=event.target.files[0];
  event.target.value="";
  if(!file)return;
  try{
    pendingRestore=parseBackup(await file.text());
  }catch(e){
    toast(e.message,5000);
    return;
  }
  renderRestoreSummary(pendingRestore);
  openModal("restoreModal");
};
function renderRestoreSummary(data){
  const list=data.products;
  const count=st=>list.filter(p=>(p.status||"active")===st).length;
  const statusText=[["active","上架中"],["archived","封存"],["trashed","垃圾桶"]].map(([st,label])=>count(st)?`${label} ${count(st)}`:"").filter(Boolean).join("、");
  const backupIds=new Set(list.map(p=>p.id));
  const extra=products.filter(p=>!backupIds.has(p.id));
  const when=new Date(data.createdAt);
  const site=data.site;
  const siteParts=[
    Array.isArray(site.catalog)&&`分類 ${site.catalog.length} 個`,
    Array.isArray(site.tagDefs)&&`標籤 ${site.tagDefs.length} 個`,
    site.contact&&"聯繫資訊",site.pageText&&"頁面文字",site.layout&&"首頁版面"
  ].filter(Boolean);
  document.getElementById("restoreSummary").innerHTML=`
    <dl class="restore-facts">
      <dt>備份時間</dt><dd>${isNaN(when)?"（不明）":escapeHTML(when.toLocaleString("zh-TW",{dateStyle:"medium",timeStyle:"short"}))}</dd>
      <dt>商品</dt><dd>${list.length} 件${statusText?`（${statusText}）`:""}</dd>
      <dt>網站設定</dt><dd>${escapeHTML(siteParts.join("、")||"（空的）")}</dd>
    </dl>
    <div class="restore-h">按下「確認還原」會：</div>
    <ol class="restore-steps">
      <li>先自動下載一份<strong>現在</strong>的完整備份，還原錯了可以用它再還原回來</li>
      <li>網站設定（分類、標籤、聯繫資訊、頁面文字、首頁版面）整份換成備份裡的</li>
      <li>備份裡的 ${list.length} 件商品（含照片）改回備份當時的內容</li>
      <li>${extra.length
        ?`現在有、但備份裡沒有的 ${extra.length} 件商品<strong>不會被刪除</strong>，會照原樣留著：<div class="restore-extra">${extra.slice(0,12).map(p=>escapeHTML(p.name||"（未命名）")).join("、")}${extra.length>12?` …等 ${extra.length} 件`:""}</div>`
        :"現在的商品都在備份裡，不會多出或少掉商品"}</li>
    </ol>`;
}
window.confirmRestore=async function(){
  const data=pendingRestore;
  if(!data)return;
  const btn=document.getElementById("restoreConfirmBtn");
  btn.disabled=true;
  try{
    toast("先下載一份現在的備份…",4000);
    downloadBackup(await buildFullBackup(),"還原前");
  }catch(e){
    btn.disabled=false;
    toast("沒辦法先備份現在的資料，所以還沒有還原："+(e.message||String(e)),5000);
    return;
  }
  let step="網站設定";
  try{
    await setDoc(doc(db,"sitedata",SITE_DOC),data.site);
    step="商品";
    for(let i=0;i<data.products.length;i+=400){
      const batch=writeBatch(db);
      const stamp=Date.now();
      data.products.slice(i,i+400).forEach(p=>batch.set(doc(productsCol(),p.id),{...p,updatedAt:stamp}));
      await batch.commit();
    }
    step="照片";
    for(const [i,p] of data.products.entries()){
      const g=data.galleries[p.id];
      // 備份當時沒有照片清單的商品，現在的也拿掉，照片數才會跟商品資料對得上
      if(g)await setDoc(galleryDocRef(p.id),{photos:g.photos,photoOriginals:g.photoOriginals,batchBackup:null});
      else await deleteDoc(galleryDocRef(p.id));
      if(i%10===9)toast(`還原照片中… ${i+1}/${data.products.length}`,3000);
    }
  }catch(e){
    toast(`還原到「${step}」時失敗：${e.message||String(e)}。可以用剛剛自動下載的「還原前」備份再還原一次，回到原本的樣子。`,8000);
    return finishRestore();
  }
  toast(`已還原網站設定和 ${data.products.length} 件商品 ☁️`,4000);
  return finishRestore();
};
async function finishRestore(){
  pendingRestore=null;
  document.getElementById("restoreConfirmBtn").disabled=false;
  closeModal("restoreModal");
  await boot();
}

async function boot(){
  document.getElementById("tbody").innerHTML='<tr><td colspan="10" class="loading">載入中…</td></tr>';
  try{
    const metaSnap=await getDoc(doc(db,"sitedata",SITE_DOC));
    metaRaw=metaSnap.exists()?metaSnap.data():{};
    catalog=metaRaw.catalog||[];
    contact=metaRaw.contact||{};
    pageText=metaRaw.pageText||{};
    layout=metaRaw.layout||{};
    // 第一次沒有 tagDefs 時，用內建的8個當預設值，確保舊商品身上已經標記的標籤鍵值不會失效
    tagDefs=Array.isArray(metaRaw.tagDefs)&&metaRaw.tagDefs.length?metaRaw.tagDefs:DEFAULT_TAG_DEFS.map(d=>({...d}));
    const productsSnap=await getDocs(collection(db,"sitedata",SITE_DOC,"products"));
    products=productsSnap.docs.map(d=>d.data());
    const needsStatusBackfill=[];
    products.forEach((p,i)=>{
      if(typeof p.sortOrder!=="number")p.sortOrder=i;
      // 早期建立的商品文件可能沒有 status 欄位（undefined），Firestore 的批次寫入
      // 不接受 undefined 欄位值——排序/同步功能一次寫回多筆商品時會直接報錯，
      // 在這裡統一補成 "active"，從源頭避免這個問題再冒出來。
      if(typeof p.status!=="string"){
        p.status="active";
        needsStatusBackfill.push(p);
      }
    });
    // 光是補在記憶體裡不夠：前台 index.html 是用 status=="active" 的伺服器端查詢
    // 篩選商品，Firestore 的查詢對「完全沒有這個欄位」的文件一律不會比對到（不像
    // 這裡的 typeof 檢查，undefined 會被當成「不是 archived」）。如果只補在這裡、
    // 沒寫回 Firestore，這個商品在前台會一直維持「查不到、消失」的狀態，直到剛好
    // 又被其他操作（重新排序、改分類等）連帶存檔才會修好——保險起見，一發現缺欄位
    // 就直接補寫回去，不用等下一次剛好觸發別的存檔動作。
    if(needsStatusBackfill.length){
      try{
        const productsColRef=collection(db,"sitedata",SITE_DOC,"products");
        const backfillBatch=writeBatch(db);
        needsStatusBackfill.forEach(p=>backfillBatch.set(doc(productsColRef,p.id),{status:"active"},{merge:true}));
        await backfillBatch.commit();
      }catch(e){
        console.warn("補寫 status 欄位失敗，暫時只在畫面上生效",e);
      }
    }
  }catch(e){
    document.getElementById("tbody").innerHTML=`<tr><td colspan="10" class="empty-state">讀取失敗：${escapeHTML(e.message||String(e))}</td></tr>`;
    return;
  }
  await purgeExpiredTrash();
  updateTotalCount();
  if(window.innerWidth>760)catalog.forEach(c=>openMainCats.add(c.id));
  renderSidebar();
  renderTable();
}
window.boot=boot;
async function purgeExpiredTrash(){
  const expired=products.filter(p=>p.status==="trashed"&&typeof p.trashedAt==="number"&&Date.now()-p.trashedAt>TRASH_DAYS*864e5);
  const purged=[];
  for(const p of expired){
    try{
      await deleteDoc(doc(productsCol(),p.id));
      try{await deleteDoc(galleryDocRef(p.id))}catch(e){}
      purged.push(p.id);
    }catch(e){
      console.warn("清除過期的垃圾桶商品失敗",p.id,e);
    }
  }
  if(!purged.length)return;
  products=products.filter(p=>!purged.includes(p.id));
  toast(`已自動清除 ${purged.length} 個在垃圾桶超過 ${TRASH_DAYS} 天的商品`,3500);
}

function renderSidebar(){
  const activeProducts=products.filter(isLive);
  const allRow=`
    <div class="cat-row ${catFilterMain===null?"active":""}" onclick="setCatFilter(null,null)">
      <span class="cat-toggle"></span>
      <span class="cat-label">全部分類</span>
      <span class="cat-count">${activeProducts.length}</span>
    </div>`;
  const nodes=catalog.map(c=>{
    const mainCount=activeProducts.filter(p=>p.mainCat===c.id).length;
    const isOpen=openMainCats.has(c.id);
    const subs=(c.subs||[]).map(s=>{
      const subCount=activeProducts.filter(p=>p.mainCat===c.id&&p.subCat===s.id).length;
      const active=catFilterMain===c.id&&catFilterSub===s.id;
      return `<div class="cat-sub-row ${active?"active":""}" onclick="setCatFilter('${c.id}','${s.id}')">
        <span>${escapeHTML(s.name)}</span>${subCount?`<span class="cat-count">${subCount}</span>`:""}
      </div>`;
    }).join("");
    return `
      <div class="cat-node">
        <div class="cat-row ${catFilterMain===c.id&&!catFilterSub?"active":""}">
          <button class="cat-toggle ${isOpen?"open":""}" onclick="event.stopPropagation();toggleCatNode('${c.id}')">▸</button>
          <span class="cat-label" onclick="setCatFilter('${c.id}',null)">${escapeHTML(c.name)}</span>
          <span class="cat-count">${mainCount}</span>
        </div>
        <div class="cat-subs ${isOpen?"open":""}">${subs}</div>
      </div>`;
  }).join("");
  document.getElementById("catTree").innerHTML=allRow+nodes;
}
window.toggleCatNode=function(id){
  if(openMainCats.has(id))openMainCats.delete(id);else openMainCats.add(id);
  renderSidebar();
};
window.setCatFilter=function(mainId,subId){
  catFilterMain=mainId;
  catFilterSub=subId;
  if(!mainId&&dragModeEnabled){
    // 拖曳排序只在選了分類的畫面下有意義，回到「全部分類」就順便關掉，
    // 避免表頭一直顯示拖曳模式已開啟、但商品列其實已經不能拖了
    dragModeEnabled=false;
    document.querySelectorAll("thead th").forEach(t=>t.classList.remove("drag-active","sorted"));
  }
  renderSidebar();
  renderTable();
};

window.setFilter=function(f){
  currentFilter=f;
  document.querySelectorAll(".filter-chip").forEach(b=>b.classList.toggle("active",b.dataset.filter===f));
  renderTable();
};

/* ── CSV 匯出／匯入（價格、尺寸、分類皆可批次編輯）────────────── */
// 左邊選的分類範圍內的商品（上面篩選籤的數字也是在這個範圍內統計）
function catFilteredProducts(){
  let list=products.slice();
  if(catFilterMain){
    list=list.filter(p=>p.mainCat===catFilterMain);
    if(catFilterSub)list=list.filter(p=>p.subCat===catFilterSub);
  }
  return list;
}
// 再套上篩選籤、搜尋、排序：表格跟匯出 CSV 用同一份
function filterAndSort(list){
  const q=(document.getElementById("searchBox").value||"").trim().toLowerCase();
  if(currentFilter==="archived"||currentFilter==="trashed"){
    list=list.filter(p=>p.status===currentFilter);
  }else{
    list=list.filter(isLive);
    if(currentFilter!=="all")list=list.filter(p=>missingFlags(p)[currentFilter]);
  }
  if(q){
    list=list.filter(p=>{
      const cat=categoryLabel(p).toLowerCase();
      const descText=(p.desc||"").replace(/<[^>]*>/g," ").toLowerCase();
      return (p.name||"").toLowerCase().includes(q)||descText.includes(q)||cat.includes(q);
    });
  }
  return list.sort((a,b)=>sortDir*sortCompare(a,b));
}
function getCurrentFilteredList(){return filterAndSort(catFilteredProducts())}
function findMainCatByName(name){
  const target=(name||"").trim();
  if(!target)return null;
  return catalog.find(c=>(c.name||"").trim()===target)||null;
}
function findSubByName(mainCat,name){
  const target=(name||"").trim();
  if(!target||!mainCat)return null;
  return (mainCat.subs||[]).find(s=>(s.name||"").trim()===target)||null;
}
window.exportProductsCSV=function(){
  const list=getCurrentFilteredList();
  if(!list.length){toast("目前沒有可匯出的商品");return}
  const lines=[CSV_HEADERS.map(csvEscapeCell).join(",")];
  list.forEach(p=>{
    const d=p.dimensions||{};
    const statusLabel=p.status==="trashed"?"垃圾桶":p.status==="archived"?"封存":"上架";
    lines.push([
      p.id,
      p.name||"",
      getMainName(p.mainCat),
      getSubName(p.mainCat,p.subCat),
      d.width||"",
      d.depth||"",
      d.height||"",
      p.price||"",
      statusLabel
    ].map(csvEscapeCell).join(","));
  });
  const csvContent="﻿"+lines.join("\n"); // 加 BOM，Excel 開啟中文才不會亂碼
  downloadBlob(new Blob([csvContent],{type:"text/csv;charset=utf-8"}),`hsshop-商品清單-${localDateStr()}.csv`);
  toast(`已匯出 ${list.length} 筆商品`);
};
// 今天的日期（電腦上的當地時間，不是 UTC），檔名用
function localDateStr(){
  const d=new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function downloadBlob(blob,filename){
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url;
  a.download=filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),10000);
}

let pendingCSVChanges=[];
window.handleCSVImport=async function(event){
  const file=event.target.files[0];
  event.target.value=""; // 清空，方便下次選同一個檔案也會觸發 change
  if(!file)return;
  let text;
  try{
    text=await file.text();
  }catch(e){
    toast("讀取檔案失敗："+(e.message||String(e)));
    return;
  }
  let rows;
  try{
    rows=parseCSV(text);
  }catch(e){
    toast("CSV 格式解析失敗，請確認是用「匯出 CSV」產生的檔案再編輯");
    return;
  }
  if(!rows.length){toast("這個 CSV 檔案沒有資料列");return}

  const changes=[];
  const skipped=[];
  rows.forEach(cells=>{
    const [id,,mainCatCell,subCatCell,widthCell,depthCell,heightCell,priceCell,statusCell]=cells;
    const product=products.find(p=>p.id===(id||"").trim());
    if(!product){
      skipped.push({id:(id||"").trim()||"(空白)",reason:"找不到對應的商品 ID"});
      return;
    }
    if(product.status==="trashed"){
      skipped.push({id:product.id,reason:"這個商品在垃圾桶裡，先救回來再匯入"});
      return;
    }
    const fieldChanges=[];

    // 分類：主分類空白＝不變更；主分類有值但找不到對應分類＝略過分類變更並警告
    let newMainCat=product.mainCat,newSubCat=product.subCat;
    const mainCatName=(mainCatCell||"").trim();
    if(mainCatName){
      const matchedMain=findMainCatByName(mainCatName);
      if(!matchedMain){
        skipped.push({id:product.id,reason:`找不到主分類「${mainCatName}」，此列的分類變更已略過`});
      }else{
        newMainCat=matchedMain.id;
        const subCatName=(subCatCell||"").trim();
        if(subCatName){
          const matchedSub=findSubByName(matchedMain,subCatName);
          if(!matchedSub){
            skipped.push({id:product.id,reason:`分類「${mainCatName}」底下找不到子分類「${subCatName}」，此列的子分類變更已略過`});
            newSubCat=matchedMain.id===product.mainCat?product.subCat:null;
          }else{
            newSubCat=matchedSub.id;
          }
        }else{
          newSubCat=null;
        }
      }
    }
    const mainCatChanged=newMainCat!==product.mainCat;
    const subCatChanged=newSubCat!==(product.subCat||null);
    if(mainCatChanged||subCatChanged){
      fieldChanges.push({
        key:"category",
        label:"分類",
        oldVal:categoryLabel(product),
        newVal:[getMainName(newMainCat),newSubCat?getSubName(newMainCat,newSubCat):""].filter(Boolean).join(" / ")
      });
    }

    // 尺寸：寬/深/高，空白視為清空該欄位
    const d=product.dimensions||{};
    const newWidth=(widthCell||"").trim();
    const newDepth=(depthCell||"").trim();
    const newHeight=(heightCell||"").trim();
    const dimsChanged=newWidth!==(d.width||"")||newDepth!==(d.depth||"")||newHeight!==(d.height||"");
    if(dimsChanged){
      const oldSize=getSizeSummary(d,product.size)||"（空白）";
      const newSize=getSizeSummary({width:newWidth,depth:newDepth,height:newHeight},"")||"（空白）";
      fieldChanges.push({key:"dims",label:"尺寸",oldVal:oldSize,newVal:newSize});
    }

    // 價格：金額跟編輯商品一樣只存數字，「3,200」「NT$ 3,200」都算 3200，比對時才不會把沒改的當成有改
    const newPrice=priceForSave(priceCell);
    const priceChanged=newPrice!==priceForSave(product.price);
    if(priceChanged){
      fieldChanges.push({key:"price",label:"價格",oldVal:priceLabel(product.price)||"（空白）",newVal:priceLabel(newPrice)||"（空白）"});
    }

    // 狀態
    const statusText=(statusCell||"").trim();
    let newStatus=product.status==="archived"?"archived":"active";
    if(statusText==="封存")newStatus="archived";
    else if(statusText==="上架")newStatus="active";
    else if(statusText){
      skipped.push({id:product.id,reason:`狀態欄位「${statusText}」看不懂，只接受「上架」或「封存」，此列的狀態變更已略過`});
    }
    const statusChanged=newStatus!==(product.status==="archived"?"archived":"active");
    if(statusChanged){
      fieldChanges.push({key:"status",label:"狀態",oldVal:product.status==="archived"?"封存":"上架",newVal:newStatus==="archived"?"封存":"上架"});
    }

    if(fieldChanges.length){
      changes.push({
        product,name:product.name||"（未命名）",fieldChanges,
        newMainCat,newSubCat,mainCatChanged,subCatChanged,
        newWidth,newDepth,newHeight,dimsChanged,
        newPrice,priceChanged,
        newStatus,statusChanged
      });
    }
  });

  pendingCSVChanges=changes;
  renderCSVImportPreview(changes,skipped,rows.length);
  openModal("csvImportModal");
};
function renderCSVImportPreview(changes,skipped,totalRows){
  const summary=document.getElementById("csvImportSummary");
  const preview=document.getElementById("csvImportPreview");
  summary.textContent=`讀到 ${totalRows} 列，其中 ${changes.length} 筆有變更需要套用${skipped.length?`，${skipped.length} 項略過`:""}。請確認以下變更沒問題再套用。`;
  if(!changes.length&&!skipped.length){
    preview.innerHTML='<div style="padding:20px;color:var(--soft)">沒有偵測到任何變更。</div>';
    document.getElementById("csvImportConfirmBtn").disabled=true;
    return;
  }
  document.getElementById("csvImportConfirmBtn").disabled=changes.length===0;
  let html='<table class="csv-diff-table"><thead><tr><th>商品</th><th>變更內容</th></tr></thead><tbody>';
  changes.forEach(c=>{
    const changeHtml=c.fieldChanges.map(fc=>
      `<div><b>${escapeHTML(fc.label)}：</b><span class="csv-diff-old">${escapeHTML(fc.oldVal)}</span> → <span class="csv-diff-new">${escapeHTML(fc.newVal)}</span></div>`
    ).join("");
    html+=`<tr><td>${escapeHTML(c.name)}</td><td>${changeHtml}</td></tr>`;
  });
  skipped.forEach(s=>{
    html+=`<tr class="csv-diff-skip-row"><td colspan="2"><span class="csv-diff-skip-tag">略過</span> ${escapeHTML(s.id)}：${escapeHTML(s.reason)}</td></tr>`;
  });
  html+="</tbody></table>";
  preview.innerHTML=html;
}
window.confirmCSVImport=async function(){
  if(!pendingCSVChanges.length){closeModal("csvImportModal");return}
  const btn=document.getElementById("csvImportConfirmBtn");
  btn.disabled=true;
  btn.textContent="套用中…";
  try{
    await ensureNoConflict(pendingCSVChanges.map(c=>c.product));
    pendingCSVChanges.forEach(c=>{
      if(c.mainCatChanged)c.product.mainCat=c.newMainCat;
      if(c.subCatChanged)c.product.subCat=c.newSubCat;
      if(c.dimsChanged){
        c.product.dimensions=c.product.dimensions||{};
        c.product.dimensions.width=c.newWidth;
        c.product.dimensions.depth=c.newDepth;
        c.product.dimensions.height=c.newHeight;
        c.product.size=getSizeSummary(c.product.dimensions,""); // 跟編輯商品一樣，尺寸文字跟著寬深高走
      }
      if(c.priceChanged)c.product.price=c.newPrice;
      if(c.statusChanged)c.product.status=c.newStatus;
    });
    await writeProducts(pendingCSVChanges.map(c=>c.product),{check:false});
    toast(`已套用 ${pendingCSVChanges.length} 筆變更 ☁️`);
  }catch(e){
    toast(saveErrorText(e,"套用失敗"),e.cancelled?6000:4000);
  }
  btn.disabled=false;
  btn.textContent="確認套用變更";
  pendingCSVChanges=[];
  closeModal("csvImportModal");
  updateTotalCount();
  renderSidebar();
  renderTable();
};

document.querySelectorAll("thead th[data-sort]").forEach(th=>{
  th.addEventListener("click",()=>{
    const key=th.dataset.sort;
    if(key==="order"){
      // 拖曳排序現在只在「已選一個主分類」的畫面下開放：因為自訂順序只在同一個
      // 主／子分類內才有意義（跨分類的話，畫面重新整理時會依分類分組跳回原位，
      // 拖曳看起來像沒生效），選了分類才能保證拖曳的結果會真的被記住。
      if(!dragModeEnabled&&!catFilterMain){
        toast("請先在左側選一個分類，才能拖曳調整該分類內的順序");
        return;
      }
      // 開啟拖曳排序時，強制把目前排序欄位切成「自訂順序」本身，
      // 拖曳時看到的、動到的都是真正的自訂順序，不會因為表格當下剛好用
      // 名稱／分類等其他欄位排序，而讓拖曳結果變成「不是你以為的順序」。
      dragModeEnabled=!dragModeEnabled;
      if(dragModeEnabled){sortKey="order";sortDir=1}
      th.classList.toggle("drag-active",dragModeEnabled);
      document.querySelectorAll("thead th").forEach(t=>t.classList.remove("sorted"));
      if(sortKey==="order")th.classList.add("sorted");
      renderTable();
      return;
    }
    if(sortKey===key)sortDir*=-1;else{sortKey=key;sortDir=1}
    document.querySelectorAll("thead th").forEach(t=>t.classList.remove("sorted"));
    th.classList.add("sorted");
    renderTable();
  });
});

// 尺寸欄：有寬深高就直接顯示（沒填的那邊顯示 –），只有文字尺寸或規格表的顯示「已填」
function sizeCellHtml(p,m){
  if(m.noSize)return '<span class="pill pill-missing">缺尺寸</span>';
  const d=p.dimensions||{};
  const parts=[d.width,d.depth,d.height].map(v=>String(v??"").trim());
  if(!parts.some(Boolean))return '<span class="pill pill-ok">已填</span>';
  return `<span class="cell-dims" title="寬 × 深 × 高（cm）">${parts.map(v=>escapeHTML(v||"–")).join("×")}</span>`;
}
// 售價欄：售價是選填，沒填就顯示「—」；有特價時多一行特價（過了結束日顯示已結束）
function priceCellHtml(p){
  const base=String(p.price??"").trim(),sale=String(p.salePrice??"").trim();
  let html=base?escapeHTML(priceLabel(base)):'<span class="cell-muted">—</span>';
  if(!sale)return html;
  const ended=p.saleEnd&&!(new Date(`${p.saleEnd}T23:59:59`)>=new Date());
  if(ended)return html+'<div class="cell-sale ended">特價已結束</div>';
  const [,mm,dd]=String(p.saleEnd||"").split("-");
  return html+`<div class="cell-sale">特價 ${escapeHTML(priceLabel(sale))}${p.saleEnd?`<span>到 ${Number(mm)}/${Number(dd)}</span>`:""}</div>`;
}
window.renderTable=function(){
  const q=(document.getElementById("searchBox").value||"").trim().toLowerCase();
  // 左邊分類是第一層篩選，上面的篩選籤（含數字）只在左邊選到的分類範圍內統計／篩選
  const catFiltered=catFilteredProducts();
  const counts={all:0,noCat:0,noSize:0,noDesc:0,noPhoto:0,archived:0,trashed:0};
  catFiltered.forEach(p=>{
    if(!isLive(p)){if(p.status in counts)counts[p.status]++;return}
    counts.all++;
    const m=missingFlags(p);
    if(m.noCat)counts.noCat++;
    if(m.noSize)counts.noSize++;
    if(m.noDesc)counts.noDesc++;
    if(m.noPhoto)counts.noPhoto++;
  });
  Object.keys(counts).forEach(k=>{const el=document.getElementById("fc-"+k);if(el)el.textContent=counts[k]});
  updateSyncBtn();
  updateMigrateMenu();
  const list=filterAndSort(catFiltered);

  // 篩選條件（搜尋／狀態篩選／分類／排序欄位）只要有任何一項變動，分頁就跳回第 1 頁，
  // 不然容易切換篩選後停在一個已經沒有那麼多頁的頁碼、畫面變空白。
  const filterSignature=JSON.stringify([q,currentFilter,catFilterMain,catFilterSub,sortKey,sortDir]);
  if(filterSignature!==lastFilterSignature){currentPage=1;lastFilterSignature=filterSignature}

  const totalCount=list.length;
  const pageSizeNum=pageSize==="all"?totalCount:Number(pageSize);
  const totalPages=pageSizeNum>0?Math.max(1,Math.ceil(totalCount/pageSizeNum)):1;
  if(currentPage>totalPages)currentPage=totalPages;
  if(currentPage<1)currentPage=1;
  const startIdx=pageSizeNum>0?(currentPage-1)*pageSizeNum:0;
  const pagedList=pageSizeNum>0?list.slice(startIdx,startIdx+pageSizeNum):list;

  const pageSizeSelect=document.getElementById("pageSizeSelect");
  if(pageSizeSelect&&pageSizeSelect.value!==pageSize)pageSizeSelect.value=pageSize;

  document.getElementById("summaryLine").textContent=totalCount&&pageSizeNum<totalCount
    ? `顯示第 ${startIdx+1}–${Math.min(startIdx+pageSizeNum,totalCount)} 個，共 ${totalCount} 個商品`
    : `顯示 ${totalCount} 個商品`;

  const paginationBar=document.getElementById("paginationBar");
  if(totalPages<=1){
    paginationBar.innerHTML="";
  }else{
    paginationBar.innerHTML=`
      <button class="btn-secondary" ${currentPage<=1?"disabled":""} onclick="goToPage(${currentPage-1})">‹ 上一頁</button>
      <span>第 ${currentPage} / ${totalPages} 頁</span>
      <button class="btn-secondary" ${currentPage>=totalPages?"disabled":""} onclick="goToPage(${currentPage+1})">下一頁 ›</button>
    `;
  }

  const tbody=document.getElementById("tbody");
  if(!list.length){
    tbody.innerHTML='<tr><td colspan="10" class="empty-state">沒有符合條件的商品</td></tr>';
    return;
  }
  // 拖曳排序只在「未篩選」時開放，避免在篩選/搜尋/批次操作模式下拖曳造成順序混亂；
  // 拖曳模式本身用獨立的開關（⠿ 按鈕）控制，不綁定目前的排序欄位
  const canReorder=dragModeEnabled&&!quickCatMode&&!q&&currentFilter==="all"&&!!catFilterMain;
  tbody.innerHTML=pagedList.map(p=>{
    const m=missingFlags(p);
    const photos=(p.photos||[]).filter(Boolean);
    const thumb=photos.length
      ? `<img class="cell-thumb" src="${escapeHTML(photos[0])}" alt="">`
      : `<div class="cell-thumb-empty">無圖</div>`;
    // 還缺哪些資料直接寫在商品名稱下面（原本只有幾個沒標字的小圓點）
    const missing=[m.noCat&&"分類",m.noSize&&"尺寸",m.noDesc&&"說明",m.noPhoto&&"照片"].filter(Boolean);
    const missingNote=missing.length?`<div class="missing-text">缺：${missing.join("、")}</div>`:"";
    return `
      <tr class="${isLive(p)?"":"is-archived"}${canReorder?" reorderable":""}" data-id="${p.id}"${canReorder?' draggable="true"':""}>
        <td class="qc-cell"><input type="checkbox" ${quickCatSelected.has(p.id)?"checked":""} onchange="toggleQuickCatSelect('${p.id}')"></td>
        <td class="drag-handle-cell">${canReorder?'<span class="drag-handle" title="拖曳調整順序">⠿</span>':""}</td>
        <td class="cell-thumb-link" onclick="openProductModal('${p.id}')" title="編輯這件商品">${thumb}</td>
        <td>
          <div class="cell-name cell-name-link" onclick="openProductModal('${p.id}')">${escapeHTML(p.name||"（未命名）")}</div>
          ${missingNote}
        </td>
        <td class="cell-cat">${m.noCat?'<span class="pill pill-missing">待分類</span>':`
          <div>${escapeHTML(getMainName(p.mainCat))}</div>
          ${p.subCat?`<div class="cell-subcat">${escapeHTML(getSubName(p.mainCat,p.subCat))}</div>`:""}
        `}</td>
        <td>${sizeCellHtml(p,m)}</td>
        <td>${priceCellHtml(p)}</td>
        <td>${m.noPhoto?'<span class="pill pill-missing">0 張</span>':(p.photoCount??photos.length)+' 張'}</td>
        <td>${p.status==="trashed"?`<span class="pill pill-archived">垃圾桶・剩 ${trashDaysLeft(p)} 天</span>`
          :p.status==="archived"?'<span class="pill pill-archived">已封存</span>':'<span class="pill pill-active">上架中</span>'}</td>
        <td><div class="row-actions">
          ${p.status==="trashed"
            ? `<button onclick="untrashProductRow('${p.id}')">救回</button><button class="danger" onclick="deleteProductRow('${p.id}')">永久刪除</button>`
            : p.status==="archived"
            ? `<button onclick="restoreProductRow('${p.id}')">還原上架</button><button onclick="duplicateProductRow('${p.id}')">複製</button><button class="danger" onclick="trashProductRow('${p.id}')">刪除</button>`
            : `<a href="index.html#product-${encodeURIComponent(p.id)}" target="_blank" rel="noopener" title="在前台看這件商品">前台 ↗</a><button onclick="duplicateProductRow('${p.id}')">複製</button><button onclick="archiveProductRow('${p.id}')">封存</button>`}
        </div></td>
      </tr>
    `;
  }).join("");
};
