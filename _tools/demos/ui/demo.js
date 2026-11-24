/* 示意頁的互動（2026-11 第二輪：視覺和逛起來的感覺優先，版面以「1 快速瀏覽」為底）。
   讀 /data/site.json 拿商品資料（標籤、說明、分類、尺寸），用商品卡上的連結 /p/商品編號 對到是哪一件，
   在卡片上加東西；網站本身的程式完全不改。
   A 清爽型錄、B 雜誌節奏（1＋3）、C 溫暖質感 只差在樣子；下面這些三種都有：
   點商品先跳快速預覽（含同類推薦）、篩選、最近看過、商品頁底部收藏列。 */
(function(){
  "use strict";
  var DESC={
    O:"現在：目前正式網站的樣子",
    A:"A 清爽型錄：照片就是卡片，字少、留白多。點商品先跳預覽，往下有同類推薦",
    B:"B 雜誌節奏（1＋3）：分類封面拼圖、每 5 件穿插一張大圖、往下捲慢慢浮現",
    C:"C 溫暖質感：白色圓角卡片、柔和陰影，「台製」「可客製化」做成彩色小牌子"
  };
  var LABEL={O:"現在",A:"A 清爽",B:"B 雜誌",C:"C 溫暖"};
  var V="A",BY={},CAT=[],TAGS={},ready=false,bypass=false,mo=null,io=null;
  var $=function(s,r){return (r||document).querySelector(s)},$$=function(s,r){return Array.prototype.slice.call((r||document).querySelectorAll(s))};
  var esc=function(s){return String(s==null?"":s).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]})};
  var num=function(v){var m=String(v==null?"":v).match(/[\d.]+/);return m?parseFloat(m[0]):null};
  var store={get:function(k,d){try{var v=JSON.parse(localStorage.getItem(k)||"null");return v==null?d:v}catch(_){return d}},set:function(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(_){}}};
  function dimsOf(p){var d=(p&&p.dimensions)||{};var r={w:String(d.width||"").trim(),d:String(d.depth||"").trim(),h:String(d.height||"").trim()};return (r.w||r.d||r.h)?r:null}
  function pidOf(card){var a=card.querySelector(".product-name a");var m=a&&(a.getAttribute("href")||"").match(/\/p\/([^\/?#.]+)/);return m?m[1]:null}
  function photo(p,w){var u=((p&&p.photos)||[])[0]||"";return u.replace(/\/image\/upload\//,"/image/upload/f_auto,q_auto,w_"+(w||600)+"/")}
  function catPath(p){var c=CAT.find(function(x){return x.id===p.mainCat});if(!c)return "";var s=(c.subs||[]).find(function(x){return x.id===p.subCat});return s?c.name+" » "+s.name:c.name}
  // 標籤底色是後台設的顏色；深色底配白字、淺色底配深字
  function inkFor(hex){var m=String(hex||"").match(/^#?([0-9a-f]{6})$/i);if(!m)return "#221d18";var n=parseInt(m[1],16),r=n>>16&255,g=n>>8&255,b=n&255;return (0.299*r+0.587*g+0.114*b)>150?"#221d18":"#fff"}
  function tagsOf(p){return (p.badges||[]).map(function(k){return TAGS[k]}).filter(Boolean)}
  function pills(p,max){return tagsOf(p).slice(0,max||9).map(function(t){return '<span class="dz-pill" style="background:'+esc(t.color)+';color:'+inkFor(t.color)+'">'+esc(t.label)+'</span>'}).join("")}
  // 說明的第一段（清單、換行前面那段），給大卡片和快速預覽用
  function descText(p){
    var h=String((p&&p.desc)||"");
    var first=h.split(/<br\s*\/?>\s*<br\s*\/?>|\n\s*\n|<ul|<ol|(?:<br\s*\/?>|\n)\s*[•・●▪‧\-]/i)[0];
    var t=first.replace(/<br\s*\/?>/gi,"\n").replace(/<[^>]*>/g,"").replace(/&nbsp;/g," ").replace(/&amp;/g,"&");
    t=t.replace(/([。！？；，、])\s*\n\s*/g,"$1").replace(/\s*\n\s*/g,"，").replace(/\s+/g," ").trim();
    return t.replace(/[，、]$/,"");
  }
  function sizeShort(p){var d=dimsOf(p);if(!d)return null;var v=[d.w,d.d,d.h].filter(Boolean);return v.join("×")+" cm"}
  function sizeLong(p){var d=dimsOf(p);if(!d)return null;return [["寬",d.w],["深",d.d],["高",d.h]].filter(function(x){return x[1]}).map(function(x){return x[0]+" "+x[1]}).join("・")+" 公分"}
  function cardOf(id){return $$("#productsGrid .product-card").find(function(c){return (c.dataset.pid||pidOf(c))===id})||null}
  function listed(){return Object.keys(BY).map(function(id){return BY[id]}).filter(function(p){return !p.status||p.status==="active"})}

  /* ── 從下面滑上來的面板（快速預覽、篩選共用）：點背景、按 ×、往下拉、按 Esc 都會關 ── */
  var sheet=(function(){
    var bd,el,body,onClose=null;
    function ensure(){
      if(el)return;
      bd=document.createElement("div");bd.className="dz-backdrop";
      el=document.createElement("div");el.className="dz-sheet";el.setAttribute("role","dialog");el.setAttribute("aria-modal","true");
      el.innerHTML='<div class="dz-grip"></div><button type="button" class="dz-close" aria-label="關閉">×</button><div class="dz-sheet-body"></div>';
      body=el.querySelector(".dz-sheet-body");document.body.appendChild(bd);document.body.appendChild(el);
      bd.addEventListener("click",close);el.querySelector(".dz-close").addEventListener("click",close);
      var grip=el.querySelector(".dz-grip"),y0=null,dy=0;
      grip.addEventListener("pointerdown",function(e){y0=e.clientY;dy=0;el.classList.add("dragging");try{grip.setPointerCapture(e.pointerId)}catch(_){}});
      grip.addEventListener("pointermove",function(e){if(y0==null)return;dy=Math.max(0,e.clientY-y0);el.style.transform="translateY("+dy+"px)"});
      var end=function(){if(y0==null)return;y0=null;el.classList.remove("dragging");el.style.transform="";if(dy>90)close()};
      grip.addEventListener("pointerup",end);grip.addEventListener("pointercancel",end);
      document.addEventListener("keydown",function(e){if(e.key==="Escape"&&el.classList.contains("open"))close()});
    }
    // 每次打開都換一個新的內容容器：上一次面板裡按鈕的動作跟著舊容器一起丟掉，不會累積、按一下做好幾次
    function open(html,cb){ensure();var c=document.createElement("div");c.innerHTML=html;body.replaceChildren(c);body.scrollTop=0;onClose=cb||null;requestAnimationFrame(function(){bd.classList.add("open");el.classList.add("open")});document.documentElement.style.overflow="hidden";return c}
    function close(){if(!el||!el.classList.contains("open"))return;bd.classList.remove("open");el.classList.remove("open");document.documentElement.style.overflow="";var cb=onClose;onClose=null;if(cb)cb()}
    function scrollTop(){if(body)body.scrollTop=0}
    return {open:open,close:close,scrollTop:scrollTop};
  })();

  /* ── 每張卡片：依目前的方案加東西（換方案時先清掉上一個方案加的）────────── */
  function enhance(card,i){
    var id=pidOf(card);if(!id)return;card.dataset.pid=id;
    if(card.dataset.ord==null)card.dataset.ord=String(i);
    if(card.dataset.dzv===V)return; // 這個方案已經處理過（「載入更多」時只處理新出現的卡片，舊卡片不會重來、不會一直閃）
    card.dataset.dzv=V;
    var p=BY[id],sz=card.querySelector(".product-size"),wrap=card.querySelector(".product-img-wrap");
    $$(".dz-add",card).forEach(function(n){n.remove()});
    card.classList.remove("dz-big","dz-pre","dz-in","dz-hide");
    if(sz){if(sz.dataset.orig==null)sz.dataset.orig=sz.textContent;sz.textContent=sz.dataset.orig}
    if(V==="O"||!p)return;
    var s=sizeShort(p);if(sz&&s)sz.textContent=s;
    var d=descText(p);
    if(d&&sz)(sz.closest(".product-meta-row")||sz).insertAdjacentHTML("beforebegin",'<p class="dz-desc dz-add">'+esc(d)+'</p>');
    var t=pills(p,1); // 卡片上只放一個標籤，照片才不會被蓋住；全部標籤在快速預覽看
    if(t&&wrap)wrap.insertAdjacentHTML("beforeend",'<div class="dz-tagrow dz-add">'+t+'</div>');
  }

  /* ── 篩選（特色標籤＋排序）────────────────────────────────── */
  var F={t:[],s:"default"};
  function match(p,f){f=f||F;return !f.t.length||f.t.some(function(k){return (p.badges||[]).indexOf(k)>=0})}
  function sortKey(p){if(F.s==="new")return -(p.updatedAt||0);var w=num((dimsOf(p)||{}).w);return w==null?1e9:w}
  function applyFilter(){
    var grid=$("#productsGrid");if(!grid)return;
    var cards=$$(".product-card",grid),shown=0;
    cards.forEach(function(c){var p=BY[c.dataset.pid];var ok=V==="O"||!p||match(p);c.classList.toggle("dz-hide",!ok);if(ok)shown++});
    var useSort=V!=="O"&&F.s!=="default";
    var order=cards.slice().sort(function(a,b){
      if(!useSort)return (+a.dataset.ord)-(+b.dataset.ord);
      return sortKey(BY[a.dataset.pid]||{})-sortKey(BY[b.dataset.pid]||{})||(+a.dataset.ord)-(+b.dataset.ord);
    });
    if(order.some(function(c,i){return c!==cards[i]})){
      // 商品卡照新順序排到最後面（「載入更多」的記號 .grid-more 要留在最後）；分區標題排序時藏起來，恢復預設時插回各分類前面
      var tail=grid.querySelector(".grid-more");
      order.forEach(function(c){grid.insertBefore(c,tail)});
      if(!useSort)rebuildHeads(grid);
    }
    $$(".products-section-head",grid).forEach(function(h){
      var n=h.nextElementSibling,any=false;
      while(n&&!n.classList.contains("products-section-head")){if(n.classList.contains("product-card")&&!n.classList.contains("dz-hide"))any=true;n=n.nextElementSibling}
      h.classList.toggle("dz-hide",V!=="O"&&(!any||useSort));
    });
    var active=F.t.length||F.s!=="default",b=$(".dz-fab b");
    if(b)b.textContent=active?String(shown):"";
  }
  function rebuildHeads(grid){
    $$(".products-section-head",grid).forEach(function(h){
      var name=(h.querySelector(".products-section-title")||{}).textContent;
      var first=$$(".product-card",grid).find(function(c){var p=BY[c.dataset.pid],m=p&&CAT.find(function(x){return x.id===p.mainCat});return m&&m.name===name});
      if(first)grid.insertBefore(h,first);
    });
  }
  function openFilter(){
    var present={};$$("#productsGrid .product-card").forEach(function(c){var p=BY[c.dataset.pid];if(p)(p.badges||[]).forEach(function(k){present[k]=(present[k]||0)+1})});
    var keys=Object.keys(TAGS).filter(function(k){return present[k]||F.t.indexOf(k)>=0});
    var draft={t:F.t.slice(),s:F.s};
    var chip=function(g,val,label,on){return '<button type="button" class="dz-chip" data-g="'+g+'" data-val="'+val+'" aria-pressed="'+on+'">'+label+'</button>'};
    var body=sheet.open('<h3>篩選</h3>'
      +'<div class="dz-label">特色（符合任一個）</div>'+(keys.length?'<div class="dz-chips">'+keys.map(function(k){return chip("t",k,esc(TAGS[k].label)+' <small>'+(present[k]||0)+'</small>',draft.t.indexOf(k)>=0)}).join("")+'</div>':'<p class="dz-empty">這一頁的商品還沒有加特色標籤（後台「標籤管理」可以加）。</p>')
      +'<div class="dz-label">排序</div><div class="dz-chips">'+[["default","店長推薦順序"],["new","最近更新"],["w","由小到大"]].map(function(x){return chip("s",x[0],x[1],draft.s===x[0])}).join("")+'</div>'
      +'<div style="display:flex;gap:10px;margin-top:24px"><button type="button" class="dz-btn ghost" data-act="reset">清除</button><button type="button" class="dz-btn" data-act="apply" style="flex:1"></button></div>');
    var count=function(){var n=$$("#productsGrid .product-card").filter(function(c){var p=BY[c.dataset.pid];return !p||match(p,draft)}).length;body.querySelector('[data-act="apply"]').textContent="看 "+n+" 件商品"};
    count();
    body.addEventListener("click",function(e){
      var b=e.target.closest("button");if(!b)return;
      if(b.dataset.g==="t"){var k=b.dataset.val,i=draft.t.indexOf(k);if(i>=0)draft.t.splice(i,1);else draft.t.push(k);b.setAttribute("aria-pressed",String(i<0))}
      else if(b.dataset.g==="s"){draft.s=b.dataset.val;$$('[data-g="s"]',body).forEach(function(x){x.setAttribute("aria-pressed",String(x===b))})}
      else if(b.dataset.act==="reset"){draft={t:[],s:"default"};$$(".dz-chip",body).forEach(function(x){x.setAttribute("aria-pressed",String(x.dataset.g==="s"&&x.dataset.val==="default"))})}
      else if(b.dataset.act==="apply"){F=draft;sheet.close();refresh();var g=$("#productsGrid");if(g)window.scrollTo({top:g.getBoundingClientRect().top+scrollY-120,behavior:"instant"});return}
      count();
    });
  }

  /* ── 快速預覽：大照片、標籤、說明第一段、尺寸，下面是同類推薦（點了直接換成那件）── */
  function similar(p){
    var all=listed().filter(function(x){return x.id!==p.id});
    var bySort=function(a,b){return (a.sortOrder||0)-(b.sortOrder||0)};
    var same=all.filter(function(x){return p.subCat&&x.subCat===p.subCat}).sort(bySort);
    var main=all.filter(function(x){return x.mainCat===p.mainCat&&same.indexOf(x)<0}).sort(bySort);
    return same.concat(main).slice(0,8);
  }
  function qvHtml(p){
    var card=cardOf(p.id),fav=card&&card.querySelector(".favorite-btn"),on=fav&&fav.classList.contains("active");
    var size=sizeLong(p),desc=descText(p),sims=similar(p),n=p.photoCount||((p.photos||[]).length);
    return '<div class="dz-qv-photo"><img src="'+esc(photo(p,800))+'" alt="">'+(n>1?'<span class="dz-pill">共 '+n+' 張照片</span>':'')+'</div>'
      +'<div class="dz-qv-cat">'+esc(catPath(p))+'</div>'
      +'<div class="dz-qv-name">'+esc(p.name)+'</div>'
      +(tagsOf(p).length?'<div class="dz-qv-tags">'+pills(p)+'</div>':'')
      +(desc?'<p class="dz-qv-desc">'+esc(desc)+'</p>':'')
      +'<div class="dz-qv-size"><b>尺寸</b>'+(size?esc(size):"請洽詢（收藏後從清單一起問）")+'</div>'
      +'<div class="dz-qv-actions"'+(fav?'':' style="grid-template-columns:1fr"')+'>'
        +(fav?'<button type="button" class="dz-btn ghost'+(on?' on':'')+'" data-act="fav">'+(on?"♥ 已收藏":"♡ 收藏")+'</button>':'')
        +'<button type="button" class="dz-btn" data-act="open" data-id="'+esc(p.id)+'">看完整介紹 →</button></div>'
      +(sims.length?'<div class="dz-sim"><div class="dz-sim-t">同類還有這些</div><div class="dz-sim-row">'+sims.map(function(s){return '<button type="button" class="dz-sim-item" data-id="'+esc(s.id)+'"><span style="background-image:url(\''+esc(photo(s,300))+'\')"></span><em>'+esc(s.name)+'</em></button>'}).join("")+'</div></div>':'');
  }
  function openQuick(id){
    var p=BY[id];if(!p)return;
    pushRecent(id);
    var box=sheet.open('<div class="dz-qv">'+qvHtml(p)+'</div>',renderRecent);
    var qv=box.firstChild,cur=id;
    box.addEventListener("click",function(e){
      var b=e.target.closest("button");if(!b)return;
      if(b.dataset.act==="fav"){var c=cardOf(cur),f=c&&c.querySelector(".favorite-btn");if(f){f.click();setTimeout(function(){var on=f.classList.contains("active");b.textContent=on?"♥ 已收藏":"♡ 收藏";b.classList.toggle("on",on)},60)}}
      else if(b.dataset.act==="open"){sheet.close();openFull(cur)}
      else if(b.classList.contains("dz-sim-item")){
        var next=BY[b.dataset.id];if(!next)return;cur=next.id;pushRecent(cur);
        qv.classList.add("swap");
        setTimeout(function(){qv.innerHTML=qvHtml(next);sheet.scrollTop();qv.classList.remove("swap")},170);
      }
    });
  }
  // 打開完整商品頁：列表上有這張卡就照網站原本的方式點它（照片會從卡片飛出來）；沒有就換網址讓網站自己開
  function openFull(id){
    var c=cardOf(id);
    if(c){bypass=true;try{c.click()}finally{bypass=false}return}
    try{history.pushState({product:id},"","/p/"+id);dispatchEvent(new PopStateEvent("popstate",{state:{product:id}}))}catch(_){}
  }
  // 點商品卡：先開快速預覽（愛心照舊直接收藏）。要比網站自己的點擊更早攔下來，所以在 head 就掛上
  document.addEventListener("click",function(e){
    if(V==="O"||bypass)return;
    var card=e.target.closest&&e.target.closest("#productsGrid .product-card");
    if(!card||e.target.closest(".favorite-btn"))return;
    var id=card.dataset.pid||pidOf(card);if(!id||!BY[id])return;
    e.preventDefault();e.stopImmediatePropagation();openQuick(id);
  },true);

  /* ── 最近看過（只記在這支手機上，看過才出現）──────────────────── */
  function pushRecent(id){var r=store.get("dz_recent",[]).filter(function(x){return x!==id});r.unshift(id);store.set("dz_recent",r.slice(0,12))}
  function renderRecent(){
    var box=$(".dz-recent");if(!box)return;
    var r=store.get("dz_recent",[]).filter(function(id){return BY[id]}).slice(0,10);
    box.classList.toggle("has",r.length>0);
    box.querySelector(".dz-recent-row").innerHTML=r.map(function(id){return '<button type="button" data-id="'+esc(id)+'" aria-label="'+esc(BY[id].name)+'" style="background-image:url(\''+esc(photo(BY[id],200))+'\')"></button>'}).join("");
  }

  /* ── B：分類封面拼圖、每 5 件一張大圖、捲動淡入 ─────────────────────── */
  function postB(){
    var grid=$("#productsGrid"),cover=$(".dz-cover");if(!grid)return;
    var local=0,vis=[];
    Array.prototype.forEach.call(grid.children,function(n){
      if(n.classList.contains("products-section-head")){local=0;return}
      if(!n.classList.contains("product-card"))return;
      var big=V==="B"&&!n.classList.contains("dz-hide")&&local%5===4;
      n.classList.toggle("dz-big",big);
      if(!n.classList.contains("dz-hide")){local++;vis.push(n)}
      if(V==="B"&&io&&!n.classList.contains("dz-in")&&!n.classList.contains("dz-pre")){n.classList.add("dz-pre");io.observe(n)}
    });
    if(!cover)return;
    // 封面放這個分類後面才會出現的商品（有標籤的優先），跟最上面幾張卡片不重複
    var pool=vis.slice(4).map(function(c){return BY[c.dataset.pid]}).filter(Boolean);
    pool.sort(function(a,b){return tagsOf(b).length-tagsOf(a).length});
    if(pool.length<3)pool=vis.map(function(c){return BY[c.dataset.pid]}).filter(Boolean);
    var pick=pool.slice(0,3);
    cover.classList.toggle("has",V==="B"&&pick.length===3);
    cover.innerHTML=pick.length===3?pick.map(function(p,i){return '<span style="background-image:url(\''+esc(photo(p,i?400:800))+'\')"></span>'}).join(""):"";
  }

  /* ── 商品頁底部收藏列：看不到原本的收藏鈕時才出現 ─────────────────── */
  var askIO=null,askEl=null,askSeen=true;
  function currentPid(){var m=location.pathname.match(/\/p\/([^\/?#.]+)/);return m?m[1]:null}
  function updateBar(){
    var bar=$(".dz-pbar");if(!bar)return;
    var open=document.body.classList.contains("lightbox-open"),id=currentPid(),p=id&&BY[id];
    var ask=$("#lbAskBtn");
    if(ask!==askEl&&askIO){if(askEl)askIO.unobserve(askEl);askEl=ask;askSeen=!ask;if(ask)askIO.observe(ask)}
    if(!open||!p||V==="O"){bar.classList.remove("show");return}
    var img=bar.querySelector("img"),src=photo(p,200);if(img.getAttribute("src")!==src)img.setAttribute("src",src);
    bar.querySelector("div").textContent=p.name;
    var on=ask&&ask.classList.contains("is-added"),btn=bar.querySelector("button");
    btn.textContent=on?"♥ 已收藏・看清單":"♡ 收藏這件";btn.classList.toggle("ghost",!!on);
    bar.classList.toggle("show",!askSeen);
  }

  /* ── 整理畫面：卡片 → 篩選排序 → B 的大圖和封面 → 最近看過 ───────────── */
  function refresh(){
    if(!ready)return;
    $$("#productsGrid .product-card").forEach(enhance);
    applyFilter();postB();renderRecent();updateBar();
    if(mo)mo.takeRecords(); // 自己排順序造成的變動不用再處理一次
  }

  /* ── 切換方案 ──────────────────────────────────────────────── */
  function pick(k){
    V=k;document.body.dataset.v=k;document.body.classList.toggle("dz-on",k!=="O");sheet.close();
    $$(".demo-sw button").forEach(function(b){b.setAttribute("aria-pressed",String(b.dataset.k===k))});
    var p=$(".demo-sw p");if(p)p.textContent=DESC[k];
    if(io)$$("#productsGrid .product-card").forEach(function(c){io.unobserve(c)});
    refresh();
    setTimeout(function(){dispatchEvent(new Event("resize"))},30);
  }
  window.__demoPick=pick;

  // 第一次打開直接進「椅子」分類（網址換成 /c/cat-chair 是網站自己做的）
  if(!location.hash&&!/^\/(c|p)\//.test(location.pathname))history.replaceState(null,"",location.pathname+"#cat-cat-chair");
  document.addEventListener("DOMContentLoaded",function(){
    var bar=document.createElement("div");bar.className="demo-sw";
    bar.innerHTML='<div class="row">'+["O","A","B","C"].map(function(k){return '<button type="button" data-k="'+k+'">'+LABEL[k]+'</button>'}).join("")+'</div><p></p>';
    document.body.appendChild(bar);bar.addEventListener("click",function(e){var b=e.target.closest("button");if(b)pick(b.dataset.k)});
    // 篩選按鈕
    var fab=document.createElement("button");fab.type="button";fab.className="dz-fab";
    fab.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>篩選 <b></b>';
    fab.addEventListener("click",openFilter);document.body.appendChild(fab);
    var lastY=scrollY;addEventListener("scroll",function(){var y=scrollY;if(Math.abs(y-lastY)<8)return;fab.classList.toggle("away",y>lastY&&y>300);lastY=y},{passive:true});
    // 分類標題下面：B 的封面拼圖、最近看過
    var head=$(".listing-head");
    if(head){var cv=document.createElement("div");cv.className="dz-cover";head.parentNode.insertBefore(cv,head.nextSibling)}
    // 分類介紹先顯示兩行，按「更多」再展開（文字都還在，Google 照樣看得到）
    var intro=$("#listingIntro");
    if(intro){var more=document.createElement("button");more.type="button";more.className="dz-more";more.textContent="更多";intro.insertAdjacentElement("afterend",more);
      more.addEventListener("click",function(){var open=intro.classList.toggle("dz-open");more.textContent=open?"收起":"更多"});
      var syncMore=function(){more.hidden=intro.hidden||!intro.textContent.trim()};new MutationObserver(syncMore).observe(intro,{attributes:true,childList:true,characterData:true,subtree:true});syncMore()}
    var tb=$(".cat-toolbar");
    if(tb){
      var rc=document.createElement("div");rc.className="dz-recent";
      rc.innerHTML='<div class="dz-recent-t">最近<br>看過</div><div class="dz-recent-row"></div><button type="button" class="dz-recent-x" data-act="clear" aria-label="清除最近看過">×</button>';
      tb.appendChild(rc);
      rc.addEventListener("click",function(e){var b=e.target.closest("button");if(!b)return;if(b.dataset.act==="clear"){store.set("dz_recent",[]);renderRecent();return}if(b.dataset.id)openQuick(b.dataset.id)});
    }
    // 商品頁底部收藏列
    var pb=document.createElement("div");pb.className="dz-pbar";pb.innerHTML='<img alt=""><div></div><button type="button" class="dz-btn"></button>';
    document.body.appendChild(pb);
    pb.querySelector("button").addEventListener("click",function(){if(window.lbAskClick)window.lbAskClick();setTimeout(updateBar,80)});
    if("IntersectionObserver" in window){
      askIO=new IntersectionObserver(function(es){es.forEach(function(en){if(en.target===askEl)askSeen=en.isIntersecting});updateBar()});
      io=new IntersectionObserver(function(es){es.forEach(function(en){if(en.isIntersecting){en.target.classList.add("dz-in");en.target.classList.remove("dz-pre");io.unobserve(en.target)}})},{rootMargin:"0px 0px -6% 0px"});
    }
    var grid=$("#productsGrid");
    if(grid){mo=new MutationObserver(function(){requestAnimationFrame(refresh)});mo.observe(grid,{childList:true})}
    var info=$("#lbInfo");
    if(info)new MutationObserver(function(){var id=currentPid();if(id&&BY[id]&&document.body.classList.contains("lightbox-open")&&V!=="O")pushRecent(id);updateBar()}).observe(info,{childList:true,subtree:true,attributes:true,attributeFilter:["class"]});
    new MutationObserver(function(){updateBar();if(!document.body.classList.contains("lightbox-open"))renderRecent()}).observe(document.body,{attributes:true,attributeFilter:["class"]});
    fetch("/data/site.json").then(function(r){return r.json()}).then(function(d){
      (d.products||[]).forEach(function(p){BY[p.id]=p});
      CAT=(d.meta&&d.meta.catalog)||[];((d.meta&&d.meta.tagDefs)||[]).forEach(function(t){TAGS[t.key]={label:t.label,color:t.color}});
      ready=true;pick(V);
    }).catch(function(){ready=true;pick(V)});
    pick(V);
    window.addEventListener("load",function(){setTimeout(function(){var g=$("#categories");if(g)window.scrollTo({top:g.getBoundingClientRect().top+scrollY-60,behavior:"instant"})},900)});
  });
})();
