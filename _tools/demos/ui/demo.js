/* 示意頁的互動（四種整套體驗）。讀 /data/site.json 拿商品資料（尺寸、標籤、分類），
   用商品卡上的連結 /p/商品編號 對到是哪一件，在卡片上加東西；網站本身的程式完全不改。 */
(function(){
  "use strict";
  var DESC={
    O:"現在：目前正式網站的樣子",
    "1":"1 快速瀏覽：右下「篩選・排序」；點商品先跳出快速預覽，看尺寸、收藏，不離開列表",
    "2":"2 尺寸比一比：一列一件，勾「比一比」最多 3 件，用同一個比例畫出來比大小",
    "3":"3 情境大圖：上方圓形分類（往下捲變小膠囊）、大小卡交錯、捲動淡入",
    "4":"4 量好空間再挑：填家裡空間，每件都標放不放得下；商品頁畫出比例圖"
  };
  var LABEL={O:"現在","1":"1 快速","2":"2 比一比","3":"3 大圖","4":"4 量空間"};
  var V="1",BY={},CAT=[],TAGS={},ready=false,bypass=false,mo=null;
  var $=function(s,r){return (r||document).querySelector(s)},$$=function(s,r){return Array.prototype.slice.call((r||document).querySelectorAll(s))};
  var esc=function(s){return String(s==null?"":s).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]})};
  var num=function(v){var m=String(v==null?"":v).match(/[\d.]+/);return m?parseFloat(m[0]):null};
  function dimsOf(p){var d=(p&&p.dimensions)||{};var r={w:String(d.width||"").trim(),d:String(d.depth||"").trim(),h:String(d.height||"").trim()};return (r.w||r.d||r.h)?r:null}
  function pidOf(card){var a=card.querySelector(".product-name a");var m=a&&(a.getAttribute("href")||"").match(/\/p\/([^\/?#.]+)/);return m?m[1]:null}
  function photo(p,w){var u=((p&&p.photos)||[])[0]||"";return u.replace(/\/image\/upload\//,"/image/upload/f_auto,q_auto,w_"+(w||600)+"/")}
  function catName(p){var c=CAT.find(function(x){return x.id===p.mainCat});if(!c)return "";var s=(c.subs||[]).find(function(x){return x.id===p.subCat});return s?s.name:c.name}
  function tagNames(p){return (p.badges||[]).map(function(k){return TAGS[k]}).filter(Boolean)}
  function short(t,n){t=String(t||"");return t.length>n?t.slice(0,n)+"…":t}
  function dimCells(d){return '<div class="dz-dims">'+[["寬",d.w],["深",d.d],["高",d.h]].filter(function(x){return x[1]}).map(function(x){return '<span><i>'+x[0]+'</i>'+esc(x[1])+'<em>cm</em></span>'}).join("")+'</div>'}
  // 尺寸一行：放不下時字縮小一點（最小 10.5px）→ 拿掉空格 → 還是放不下才換行（不會被切掉）
  function fitLine(el){
    el.style.fontSize="";el.style.whiteSpace="";
    var over=function(){return el.scrollWidth>el.clientWidth+0.5};
    var s=parseFloat(getComputedStyle(el).fontSize);
    while(over()&&s>10.5){s-=0.5;el.style.fontSize=s+"px"}
    if(over()){var before=el.innerHTML;el.innerHTML=before.replace(/ ([·×]) /g,"$1").replace(/ cm$/,"cm");if(over()){el.innerHTML=before;el.style.whiteSpace="normal"}}
  }

  /* ── 從下面滑上來的面板（快速預覽、篩選、比一比共用）：點背景、按 ×、往下拉、按 Esc 都會關 ── */
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
    return {open:open,close:close};
  })();

  /* ── 每張卡片：依目前的方案加東西（先清掉上一個方案加的）────────── */
  var SPACE={w:"60",d:"",h:""};
  try{var saved=JSON.parse(localStorage.getItem("dz_space")||"null");if(saved)SPACE=saved}catch(_){}
  function spaceNums(){return {w:num(SPACE.w)||0,d:num(SPACE.d)||0,h:num(SPACE.h)||0}}
  function fitOf(p){
    var d=dimsOf(p),s=spaceNums();
    if(!s.w&&!s.d&&!s.h)return {state:"none",over:{}};
    if(!d)return {state:"ask",over:{}};
    var over={},first=null;
    [["w","寬"],["d","深"],["h","高"]].forEach(function(k){var v=num(d[k[0]]),lim=s[k[0]];if(lim&&v!=null&&v>lim){over[k[0]]=Math.round((v-lim)*10)/10;if(!first)first=k}});
    return first?{state:"no",over:over,text:first[1]+"多 "+over[first[0]]}:{state:"ok",over:over};
  }
  function enhance(card,i){
    var id=pidOf(card);if(!id)return;card.dataset.pid=id;
    if(card.dataset.ord==null)card.dataset.ord=String(i);
    var p=BY[id],sz=card.querySelector(".product-size");
    $$(".dz-add",card).forEach(function(n){n.remove()});
    card.classList.remove("dz3-big","dz3-pre","dz3-in","dz4-nofit","dz-picked","dz-hide");
    if(sz){if(sz.dataset.orig==null)sz.dataset.orig=sz.textContent;sz.classList.remove("dz-size");sz.style.fontSize="";sz.style.whiteSpace="";sz.textContent=sz.dataset.orig}
    if(V==="O"||!p)return;
    var d=dimsOf(p),parts=d?[["寬",d.w,"w"],["深",d.d,"d"],["高",d.h,"h"]].filter(function(x){return x[1]}):[];
    if(sz&&d){
      sz.classList.add("dz-size");
      if(V==="1")sz.textContent=parts.map(function(x){return x[1]}).join("×")+" cm";
      else if(V==="2")sz.textContent=parts.map(function(x){return x[0]+" "+x[1]}).join(" · ")+" cm";
      else if(V==="3")sz.textContent=parts.map(function(x){return x[0]+" "+x[1]}).join(" × ")+" cm";
      else if(V==="4"){var f=fitOf(p);sz.innerHTML=parts.map(function(x){return '<span'+(f.over[x[2]]!=null?' class="over"':'')+'>'+x[0]+esc(x[1])+'</span>'}).join(" ")}
    }
    if(V==="1"){var t=tagNames(p);if(t.length&&sz)sz.insertAdjacentHTML("afterend",'<span class="dz-tags dz-add">'+esc(t.slice(0,2).join("・"))+'</span>')}
    if(V==="2"){
      var on=picked.indexOf(id)>=0;card.classList.toggle("dz-picked",on);
      var b=document.createElement("button");b.type="button";b.className="dz2-cmp dz-add";b.setAttribute("aria-pressed",String(on));b.textContent=on?"✓ 比較中":"＋ 比一比";
      b.addEventListener("click",function(e){e.preventDefault();e.stopPropagation();togglePick(id)});
      card.querySelector(".product-info").appendChild(b);
    }
    if(V==="4"){
      var f4=fitOf(p),wrap=card.querySelector(".product-img-wrap");
      if(wrap&&f4.state!=="none"){wrap.insertAdjacentHTML("beforeend",'<span class="dz4-fit dz-add'+(f4.state==="no"?" no":f4.state==="ask"?" ask":"")+'">'+(f4.state==="ok"?"✓ 放得下":f4.state==="ask"?"尺寸洽詢":esc(f4.text))+'</span>')}
      card.classList.toggle("dz4-nofit",f4.state==="no");
    }
    if(sz&&d)fitLine(sz);
  }
  function hideEmptyHeads(){
    $$("#productsGrid .products-section-head").forEach(function(h){
      var n=h.nextElementSibling,any=false;
      while(n&&!n.classList.contains("products-section-head")){if(n.classList.contains("product-card")&&!n.classList.contains("dz-hide"))any=true;n=n.nextElementSibling}
      h.classList.toggle("dz-hide",!any||(V==="1"&&F1.s!=="default"));
    });
  }
  function refresh(){
    if(!ready)return;
    var cards=$$("#productsGrid .product-card");
    cards.forEach(enhance);
    if(V==="1")apply1();
    if(V==="2")updateTray();
    if(V==="3")post3();
    if(V==="4")apply4();
    if(V!=="1"&&V!=="4")$$("#productsGrid .products-section-head").forEach(function(h){h.classList.remove("dz-hide")});
    if(mo)mo.takeRecords(); // 自己排順序造成的變動不用再處理一次
  }

  /* ── 1 快速瀏覽：篩選・排序面板、快速預覽 ─────────────────────── */
  var F1={w:0,t:[],s:"default"};
  function match1(p){
    if(F1.w){var w=num((dimsOf(p)||{}).w);if(w==null||w>F1.w)return false}
    if(F1.t.length&&!F1.t.some(function(k){return (p.badges||[]).indexOf(k)>=0}))return false;
    return true;
  }
  function sortKey(p){var d=dimsOf(p)||{};var v=F1.s==="w"?num(d.w):num(d.h);return v==null?1e9:v}
  function apply1(){
    var grid=$("#productsGrid");if(!grid)return;
    var cards=$$(".product-card",grid),shown=0;
    cards.forEach(function(c){var p=BY[c.dataset.pid];var ok=!p||match1(p);c.classList.toggle("dz-hide",!ok);if(ok)shown++});
    var order=cards.slice().sort(function(a,b){
      if(F1.s==="default")return (+a.dataset.ord)-(+b.dataset.ord);
      return sortKey(BY[a.dataset.pid])-sortKey(BY[b.dataset.pid])||(+a.dataset.ord)-(+b.dataset.ord);
    });
    if(order.some(function(c,i){return c!==cards[i]})){
      // 商品卡照新順序排到最後面（「載入更多」的記號 .grid-more 要留在最後）；分區標題排序時藏起來，恢復預設時插回各分類前面
      var tail=grid.querySelector(".grid-more");
      order.forEach(function(c){grid.insertBefore(c,tail)});
      if(F1.s==="default")rebuildHeads(grid,$$(".products-section-head",grid));
    }
    hideEmptyHeads();
    var fab=$(".dz1-fab b");if(fab)fab.textContent=String(shown);
  }
  function rebuildHeads(grid,heads){
    // 恢復網站預設順序時，把分區標題插回各分類第一張卡片前面
    heads.forEach(function(h){
      var name=(h.querySelector(".products-section-title")||{}).textContent;
      var first=$$(".product-card",grid).find(function(c){var p=BY[c.dataset.pid];return p&&catMainName(p)===name});
      if(first)grid.insertBefore(h,first);else grid.appendChild(h);
    });
  }
  function catMainName(p){var c=CAT.find(function(x){return x.id===p.mainCat});return c?c.name:""}
  function openFilter1(){
    var present={};Object.keys(BY).forEach(function(id){(BY[id].badges||[]).forEach(function(k){present[k]=1})});
    var tagKeys=Object.keys(TAGS).filter(function(k){return present[k]});
    var draft={w:F1.w,t:F1.t.slice(),s:F1.s};
    var chip=function(g,val,label,on){return '<button type="button" class="dz-chip" data-g="'+g+'" data-val="'+val+'" aria-pressed="'+on+'">'+label+'</button>'};
    var body=sheet.open('<h3>篩選・排序</h3>'
      +'<div class="dz-label">寬度</div><div class="dz-chips">'+[0,40,60,90].map(function(w){return chip("w",w,w?w+" 公分內":"不限",draft.w===w)}).join("")+'</div>'
      +'<div class="dz-label">特色（符合任一個）</div><div class="dz-chips">'+tagKeys.map(function(k){return chip("t",k,esc(TAGS[k]),draft.t.indexOf(k)>=0)}).join("")+'</div>'
      +'<div class="dz-label">排序</div><div class="dz-chips">'+[["default","網站預設"],["w","由窄到寬"],["h","由矮到高"]].map(function(x){return chip("s",x[0],x[1],draft.s===x[0])}).join("")+'</div>'
      +'<div style="display:flex;gap:10px;margin-top:22px"><button type="button" class="dz-btn ghost" data-act="reset">清除</button><button type="button" class="dz-btn" data-act="apply" style="flex:1"></button></div>');
    var count=function(){var n=$$("#productsGrid .product-card").filter(function(c){var p=BY[c.dataset.pid];if(!p)return true;var keep=F1;F1=draft;var ok=match1(p);F1=keep;return ok}).length;body.querySelector('[data-act="apply"]').textContent="看 "+n+" 件商品"};
    count();
    body.addEventListener("click",function(e){
      var b=e.target.closest("button");if(!b)return;
      if(b.dataset.g==="w"){draft.w=+b.dataset.val;$$('[data-g="w"]',body).forEach(function(x){x.setAttribute("aria-pressed",String(x===b))})}
      else if(b.dataset.g==="t"){var k=b.dataset.val,i=draft.t.indexOf(k);if(i>=0)draft.t.splice(i,1);else draft.t.push(k);b.setAttribute("aria-pressed",String(i<0))}
      else if(b.dataset.g==="s"){draft.s=b.dataset.val;$$('[data-g="s"]',body).forEach(function(x){x.setAttribute("aria-pressed",String(x===b))})}
      else if(b.dataset.act==="reset"){draft={w:0,t:[],s:"default"};$$(".dz-chip",body).forEach(function(x){x.setAttribute("aria-pressed",String((x.dataset.g==="w"&&x.dataset.val==="0")||(x.dataset.g==="s"&&x.dataset.val==="default")))})}
      else if(b.dataset.act==="apply"){F1=draft;sheet.close();apply1();var g=$("#productsGrid");if(g)window.scrollTo({top:g.getBoundingClientRect().top+scrollY-140,behavior:"instant"});return}
      count();
    });
  }
  function openQuick(card){
    var p=BY[card.dataset.pid||pidOf(card)];if(!p)return;
    var d=dimsOf(p),t=tagNames(p),img=card.querySelector(".product-img-wrap img");
    var favBtn=card.querySelector(".favorite-btn");
    var favText=function(){return favBtn&&favBtn.classList.contains("active")?"♥ 已收藏":"♡ 收藏"};
    var body=sheet.open('<div class="dz1-qv-photo"><img src="'+esc(img?img.currentSrc||img.src:photo(p))+'" alt=""></div>'
      +'<div class="dz1-qv-name">'+esc(p.name)+'</div>'
      +'<div class="dz1-qv-cat">'+esc(catName(p))+(t.length?" ・ "+esc(t.join("・")):"")+((p.photoCount||1)>1?" ・ 共 "+p.photoCount+" 張照片":"")+'</div>'
      +(d?dimCells(d):'<div class="dz1-qv-cat">尺寸請洽詢：先收藏，再從收藏清單一起問</div>')
      +'<div class="dz1-qv-actions"><button type="button" class="dz-btn ghost" data-act="fav">'+favText()+'</button><button type="button" class="dz-btn" data-act="open">看完整介紹 →</button></div>'
      +'<div class="dz1-qv-note">往下拉或點旁邊就能關掉，回到原本的位置</div>');
    body.addEventListener("click",function(e){
      var b=e.target.closest("[data-act]");if(!b)return;
      if(b.dataset.act==="fav"&&favBtn){favBtn.click();setTimeout(function(){b.textContent=favText()},50)}
      if(b.dataset.act==="open"){sheet.close();bypass=true;try{card.click()}finally{bypass=false}}
    });
  }
  // 點商品卡：先開快速預覽（愛心照舊直接收藏）。要比網站自己的點擊更早攔下來，所以在 head 就掛上
  document.addEventListener("click",function(e){
    if(V!=="1"||bypass)return;
    var card=e.target.closest&&e.target.closest("#productsGrid .product-card");
    if(!card||e.target.closest(".favorite-btn"))return;
    e.preventDefault();e.stopImmediatePropagation();openQuick(card);
  },true);

  /* ── 2 尺寸比一比 ───────────────────────────────────────────── */
  var picked=[],COLORS=["#8a4520","#4d6b5b","#4d5d6b"];
  function togglePick(id){
    var i=picked.indexOf(id);
    if(i>=0)picked.splice(i,1);
    else if(picked.length>=3){var tr=$(".dz2-tray");if(tr){tr.animate&&tr.animate([{transform:"translateX(0)"},{transform:"translateX(-6px)"},{transform:"translateX(6px)"},{transform:"translateX(0)"}],{duration:260})}return}
    else picked.push(id);
    $$("#productsGrid .product-card").forEach(function(c){if(c.dataset.pid===id)enhance(c)});
    updateTray();
  }
  function updateTray(){
    var tr=$(".dz2-tray");if(!tr)return;
    tr.classList.toggle("show",V==="2"&&picked.length>0);
    tr.querySelector(".dz2-thumbs").innerHTML=picked.map(function(id){return '<span style="background-image:url(\''+esc(photo(BY[id],120))+'\')"></span>'}).join("");
    var b=tr.querySelector("button");b.textContent=picked.length<2?"再選 1 件":"比較 "+picked.length+" 件 →";b.disabled=picked.length<2;
  }
  function personSvg(x,base,sc,label){
    var h=170*sc,head=h*0.13;
    return '<g fill="#c9bba5"><circle cx="'+(x+head*0.55)+'" cy="'+(base-h+head*0.55)+'" r="'+(head*0.55)+'"/>'
      +'<rect x="'+(x)+'" y="'+(base-h+head*1.15)+'" width="'+(head*1.1)+'" height="'+(h-head*1.15)+'" rx="'+(head*0.45)+'"/></g>'
      +(label?'<text x="'+(x+head*0.55)+'" y="'+(base-h-6)+'" font-size="10.5" fill="#8b7f70" text-anchor="middle">人 170</text>':"");
  }
  function openCompare(){
    var items=picked.map(function(id){var p=BY[id],d=dimsOf(p)||{};return {p:p,w:num(d.w)||0,d:num(d.d)||0,h:num(d.h)||0}});
    var W=360,base=236,gap=18,personW=170*0.13*1.1;
    var totalW=personW+gap+items.reduce(function(s,it){return s+it.w},0)+gap*(items.length-1);
    var maxH=Math.max(170,Math.max.apply(null,items.map(function(it){return it.h})));
    var sc=Math.min((W-28)/totalW,190/maxH);
    var x=14,svg=personSvg(x,base,sc,true);x+=personW*sc+gap*sc;
    items.forEach(function(it,i){
      var w=it.w*sc,h=it.h*sc,c=COLORS[i];
      svg+='<rect x="'+x+'" y="'+(base-h)+'" width="'+w+'" height="'+h+'" fill="'+c+'" fill-opacity=".14" stroke="'+c+'" stroke-width="1.6" rx="2"/>'
        +'<text x="'+(x+w/2)+'" y="'+(base-h-6)+'" paint-order="stroke" stroke="#fff" stroke-width="3" font-size="11" font-weight="700" fill="'+c+'" text-anchor="middle">寬'+it.w+'・高'+it.h+'</text>'
        +'<text x="'+(x+w/2)+'" y="'+(base+15)+'" font-size="10.5" fill="#5f5446" text-anchor="middle">'+esc(short(it.p.name,6))+'</text>';
      x+=w+gap*sc;
    });
    var top='',maxD=Math.max.apply(null,items.map(function(it){return it.d}).concat([1])),sumW=items.reduce(function(s,it){return s+it.w},0)+gap*(items.length-1);
    var sc2=Math.min((W-28)/sumW,96/maxD),x2=14;
    items.forEach(function(it,i){var w=it.w*sc2,dd=it.d*sc2,c=COLORS[i];top+='<rect x="'+x2+'" y="22" width="'+w+'" height="'+dd+'" fill="'+c+'" fill-opacity=".14" stroke="'+c+'" stroke-width="1.6" rx="2"/><text x="'+(x2+w/2)+'" y="'+(22+dd+14)+'" font-size="10.5" fill="'+c+'" text-anchor="middle">深'+it.d+'</text>';x2+=w+gap*sc2});
    var row=function(label,key){var vals=items.map(function(it){return it[key]}),mx=Math.max.apply(null,vals);return '<tr><td>'+label+'</td>'+vals.map(function(v){return '<td'+(v===mx&&vals.length>1?' class="max"':'')+'>'+(v||"—")+'</td>'}).join("")+'</tr>'};
    sheet.open('<h3>尺寸比一比（同一個比例）</h3>'
      +'<svg class="dz2-svg" viewBox="0 0 '+W+' 262" role="img" aria-label="正面看的大小比較">'+'<text x="14" y="18" font-size="11.5" font-weight="700" fill="#8b7f70">正面看（寬 × 高）</text><line x1="8" y1="'+base+'" x2="'+(W-8)+'" y2="'+base+'" stroke="#e2d6c3"/>'+svg+'</svg>'
      +'<svg class="dz2-svg" viewBox="0 0 '+W+' '+(22+maxD*sc2+26)+'" style="margin-top:10px" role="img" aria-label="從上面看的大小比較"><text x="14" y="15" font-size="11.5" font-weight="700" fill="#8b7f70">從上面看（寬 × 深）</text>'+top+'</svg>'
      +'<table class="dz2-table"><thead><tr><th>公分</th>'+items.map(function(it,i){return '<th style="color:'+COLORS[i]+'">'+esc(short(it.p.name,6))+'</th>'}).join("")+'</tr></thead><tbody>'+row("寬","w")+row("深","d")+row("高","h")+'</tbody></table>');
  }

  /* ── 3 情境大圖：上方圓形分類、大小卡交錯、捲動淡入 ─────────────── */
  var io3=null;
  function buildNav3(){
    var nav=$(".dz3-nav");if(!nav||!CAT.length)return;
    var activeMain=($("#catSidebar .cat-side-btn.active")||{dataset:{}}).dataset.main||"全部";
    var activeSub=($("#catSidebar .cat-sub-btn.active")||{dataset:{}}).dataset.sub||"";
    var listed=Object.keys(BY).map(function(id){return BY[id]}).filter(function(p){return p.status==="active"});
    var firstOf=function(fn){return listed.filter(fn).sort(function(a,b){return (a.sortOrder||0)-(b.sortOrder||0)})[0]};
    var mains=[{id:"全部",name:"全部",p:firstOf(function(){return true})}].concat(CAT.filter(function(c){return !c.hidden&&listed.some(function(p){return p.mainCat===c.id})}).map(function(c){return {id:c.id,name:c.name,p:firstOf(function(p){return p.mainCat===c.id})}}));
    nav.querySelector(".dz3-mains").innerHTML=mains.map(function(m){return '<button type="button" class="dz3-main" data-main="'+esc(m.id)+'" aria-pressed="'+(m.id===activeMain)+'"><span style="background-image:url(\''+esc(photo(m.p,200))+'\')"></span>'+esc(m.name)+'</button>'}).join("");
    var cat=CAT.find(function(c){return c.id===activeMain});
    var subs=cat?(cat.subs||[]).filter(function(s){return !s.hidden&&listed.some(function(p){return p.subCat===s.id})}):[];
    nav.querySelector(".dz3-subs").innerHTML=subs.length?['<button type="button" class="dz-chip" data-main="'+esc(activeMain)+'" aria-pressed="'+(!activeSub)+'">全部'+esc(cat.name)+'</button>'].concat(subs.map(function(s){return '<button type="button" class="dz-chip" data-sub="'+esc(s.id)+'" aria-pressed="'+(s.id===activeSub)+'">'+esc(s.name)+'</button>'})).join(""):"";
  }
  function post3(){
    buildNav3();
    var i=0;
    $$("#productsGrid .product-card").forEach(function(c){
      if(i%5===0)c.classList.add("dz3-big");i++;
      if(io3&&!c.classList.contains("dz3-in")){c.classList.add("dz3-pre");io3.observe(c)}
    });
  }

  /* ── 4 量好空間再挑 ─────────────────────────────────────────── */
  var only4=false;
  function apply4(){
    var cards=$$("#productsGrid .product-card"),ok=0,all=0;
    cards.forEach(function(c){var p=BY[c.dataset.pid];if(!p)return;all++;var f=fitOf(p);if(f.state==="ok")ok++;c.classList.toggle("dz-hide",only4&&f.state!=="ok"&&f.state!=="none")});
    hideEmptyHeads();
    var s=spaceNums(),set=s.w||s.d||s.h;
    var txt=set?"放得下 "+ok+" 件／共 "+all+" 件":"填任何一格就會開始比";
    var cnt=$(".dz4-count");if(cnt)cnt.textContent=txt;
    var pill=$(".dz4-pill");if(pill)pill.innerHTML="我的空間 "+[["寬",s.w],["深",s.d],["高",s.h]].filter(function(x){return x[1]}).map(function(x){return x[0]+x[1]}).join("・")+(set?" ・ 放得下 "+ok+" 件":"")+" ✎";
    lbCompare4();
  }
  function lbCompare4(){
    var info=$("#lbInfo");if(!info)return;
    $$(".dz4-cmp",info).forEach(function(n){n.remove()});
    if(V!=="4")return;
    var m=location.pathname.match(/\/p\/([^\/?#.]+)/),p=m&&BY[m[1]];if(!p)return;
    var d=dimsOf(p),s=spaceNums(),box=document.createElement("div");box.className="dz4-cmp";
    var anchor=info.querySelector(".lb-dim,.lb-dim-ask");
    if(!d){return}
    if(!s.w&&!s.h){box.innerHTML='<div class="dz4-cmp-t">跟你的空間比一比</div><p>在商品列表上方填家裡空間的寬或高，這裡就會畫出比例圖。</p>'}
    else{
      var pw=num(d.w)||0,ph=num(d.h)||0,W=340,base=196,personW=170*0.13*1.1;
      var spaceW=s.w||pw*1.3,spaceH=s.h||0;
      var maxH=Math.max(170,ph,spaceH),total=personW+30+Math.max(spaceW,pw)+10;
      var sc=Math.min((W-24)/total,160/maxH),x=Math.max(12,(W-total*sc)/2); // 整張圖置中
      var svg=personSvg(x,base,sc,true);x+=(personW+30)*sc;
      var gx=x,gw=Math.max(spaceW,pw)*sc,left=gx+(gw-spaceW*sc)/2,prodX=gx+(gw-pw*sc)/2;
      var f=fitOf(p),bad=f.state==="no",c=bad?"#c0601f":"#3f6b3a";
      if(s.w)svg+='<line x1="'+left+'" y1="'+(base-(spaceH||maxH)*sc)+'" x2="'+left+'" y2="'+base+'" stroke="#8b7f70" stroke-width="2" stroke-dasharray="4 3"/><line x1="'+(left+spaceW*sc)+'" y1="'+(base-(spaceH||maxH)*sc)+'" x2="'+(left+spaceW*sc)+'" y2="'+base+'" stroke="#8b7f70" stroke-width="2" stroke-dasharray="4 3"/><text x="'+(left+spaceW*sc/2)+'" y="'+(base+15)+'" font-size="10.5" fill="#8b7f70" text-anchor="middle">你的空間 寬'+s.w+'</text>';
      if(s.h)svg+='<line x1="'+(left-6)+'" y1="'+(base-spaceH*sc)+'" x2="'+(left+spaceW*sc+6)+'" y2="'+(base-spaceH*sc)+'" stroke="#8b7f70" stroke-width="2" stroke-dasharray="4 3"/>';
      svg+='<rect x="'+prodX+'" y="'+(base-ph*sc)+'" width="'+(pw*sc)+'" height="'+(ph*sc)+'" fill="'+c+'" fill-opacity=".16" stroke="'+c+'" stroke-width="1.8" rx="2"/><text x="'+(prodX+pw*sc/2)+'" y="'+(base-ph*sc-6)+'" paint-order="stroke" stroke="#fff" stroke-width="3" font-size="11" font-weight="700" fill="'+c+'" text-anchor="middle">這件 寬'+esc(d.w)+'・高'+esc(d.h)+'</text>';
      var msg=f.state==="ok"?"放得下"+(s.w&&pw?"，左右還有 "+Math.round((s.w-pw)*10)/10+" 公分":"")+"。":bad?esc(f.text)+" 公分，放不下。":"";
      box.innerHTML='<div class="dz4-cmp-t">跟你的空間比一比</div><svg viewBox="0 0 '+W+' 216" role="img" aria-label="這件商品和你的空間的比例圖"><line x1="6" y1="'+base+'" x2="'+(W-6)+'" y2="'+base+'" stroke="#e2d6c3"/>'+svg+'</svg><p>'+msg+'旁邊的人形是 170 公分，用來對照大小。</p>';
    }
    if(anchor)anchor.insertAdjacentElement("afterend",box);else info.appendChild(box);
  }

  /* ── 切換方案 ──────────────────────────────────────────────── */
  function pick(k){
    V=k;document.body.dataset.v=k;sheet.close();
    $$(".demo-sw button").forEach(function(b){b.setAttribute("aria-pressed",String(b.dataset.k===k))});
    var p=$(".demo-sw p");if(p)p.textContent=DESC[k];
    refresh();lbCompare4();
    setTimeout(function(){dispatchEvent(new Event("resize"))},30);
  }
  window.__demoPick=pick;

  // 第一次打開直接進「椅子」分類（網址換成 /c/cat-chair 是網站自己做的）
  if(!location.hash&&!/^\/(c|p)\//.test(location.pathname))history.replaceState(null,"",location.pathname+"#cat-cat-chair");
  document.addEventListener("DOMContentLoaded",function(){
    var bar=document.createElement("div");bar.className="demo-sw";
    bar.innerHTML='<div class="row">'+["O","1","2","3","4"].map(function(k){return '<button type="button" data-k="'+k+'">'+LABEL[k]+'</button>'}).join("")+'</div><p></p>';
    document.body.appendChild(bar);bar.addEventListener("click",function(e){var b=e.target.closest("button");if(b)pick(b.dataset.k)});
    // 1：篩選按鈕
    var fab=document.createElement("button");fab.type="button";fab.className="dz1-fab";fab.innerHTML='篩選・排序 <b>0</b>';fab.addEventListener("click",openFilter1);document.body.appendChild(fab);
    // 2：比較列
    var tray=document.createElement("div");tray.className="dz2-tray";tray.innerHTML='<div class="dz2-thumbs"></div><button type="button">比較 →</button>';tray.querySelector("button").addEventListener("click",openCompare);document.body.appendChild(tray);
    // 3：上方分類（放在商品區前面，整個商品區捲動時都黏在上面；往下捲變成小膠囊）
    var layout=$(".cat-layout");
    if(layout){
      var sentinel=document.createElement("div");sentinel.style.height="1px";
      var nav=document.createElement("div");nav.className="dz3-nav";nav.innerHTML='<div class="dz3-mains"></div><div class="dz3-subs"></div>';
      layout.parentNode.insertBefore(sentinel,layout);layout.parentNode.insertBefore(nav,layout);
      nav.addEventListener("click",function(e){
        var b=e.target.closest("button");if(!b)return;
        var link=b.dataset.sub?$('#catSidebar .cat-sub-btn[data-sub="'+b.dataset.sub+'"]'):$('#catSidebar .cat-side-btn[data-main="'+b.dataset.main+'"]');
        if(link)link.click();
      });
      if("IntersectionObserver" in window){
        new IntersectionObserver(function(es){es.forEach(function(en){nav.classList.toggle("stuck",!en.isIntersecting&&en.boundingClientRect.top<60)})},{rootMargin:"-53px 0px 0px 0px"}).observe(sentinel);
        io3=new IntersectionObserver(function(es){es.forEach(function(en){if(en.isIntersecting){en.target.classList.add("dz3-in");en.target.classList.remove("dz3-pre");io3.unobserve(en.target)}})},{rootMargin:"0px 0px -6% 0px"});
      }
    }
    // 4：我的空間
    var tb=$(".cat-toolbar");
    if(tb){
      var sp=document.createElement("div");sp.className="dz4-space";
      sp.innerHTML='<div class="dz4-q">家裡要放的空間有多大？</div><div class="dz4-sub">量好填進來（公分），每件商品都會標出放不放得下。只填寬也可以。</div>'
        +'<div class="dz4-inputs">'+[["w","寬"],["d","深"],["h","高"]].map(function(x){return '<label>'+x[1]+'<input id="dz4-'+x[0]+'" type="number" inputmode="decimal" min="1" placeholder="不限" value="'+esc(SPACE[x[0]]||"")+'"></label>'}).join("")+'</div>'
        +'<div class="dz4-row"><label class="dz4-only"><input type="checkbox" id="dz4-only">只看放得下的</label><span class="dz4-count"></span></div>';
      tb.appendChild(sp);
      sp.addEventListener("input",function(e){
        if(e.target.id==="dz4-only"){only4=e.target.checked}
        else{var k=e.target.id.slice(4);SPACE[k]=e.target.value;try{localStorage.setItem("dz_space",JSON.stringify(SPACE))}catch(_){}}
        refresh();
      });
      var pill=document.createElement("button");pill.type="button";pill.className="dz4-pill";document.body.appendChild(pill);
      pill.addEventListener("click",function(){window.scrollTo({top:sp.getBoundingClientRect().top+scrollY-70,behavior:"smooth"});setTimeout(function(){var i=$("#dz4-w");if(i)i.focus()},400)});
      if("IntersectionObserver" in window)new IntersectionObserver(function(es){es.forEach(function(en){pill.classList.toggle("show",!en.isIntersecting&&en.boundingClientRect.top<0)})},{rootMargin:"-52px 0px 0px 0px"}).observe(sp);
    }
    var grid=$("#productsGrid");
    if(grid){mo=new MutationObserver(function(){requestAnimationFrame(refresh)});mo.observe(grid,{childList:true})}
    var info=$("#lbInfo");
    if(info)new MutationObserver(function(){if(V==="4"&&!info.querySelector(".dz4-cmp"))lbCompare4()}).observe(info,{childList:true});
    fetch("/data/site.json").then(function(r){return r.json()}).then(function(d){
      (d.products||[]).forEach(function(p){BY[p.id]=p});
      CAT=(d.meta&&d.meta.catalog)||[];((d.meta&&d.meta.tagDefs)||[]).forEach(function(t){TAGS[t.key]=t.label});
      ready=true;pick(V);
    }).catch(function(){ready=true;pick(V)});
    pick("1");
    window.addEventListener("load",function(){setTimeout(function(){var g=$("#categories");if(g)window.scrollTo({top:g.getBoundingClientRect().top+scrollY-60,behavior:"instant"})},900)});
  });
})();
