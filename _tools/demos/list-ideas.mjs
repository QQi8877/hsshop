// 暫時的示意頁產生器（2026-11 手機版商品列表四種提案）。用法：node _tools/demos/list-ideas.mjs index.html 輸出.html
// 老闆選好之後連同示意頁一起刪掉；不是網站的一部分（_tools 不會被發佈）。
// 用網站首頁做一份「四種商品列表」示意頁：底部切換 現在／A／B／C／D。只在手機寬度改樣子。
import {readFileSync,writeFileSync} from "node:fs";
const [src,out]=process.argv.slice(2);let h=readFileSync(src,"utf8");
const V={
  A:"A 精簡數字（IKEA 式）：兩欄不變，尺寸寫成 26×26×20，上面標一次「寬×深×高」",
  B:"B 清單（MUJI 式）：一列一件，左照片右文字，尺寸完整寫在一行",
  C:"C 大圖（HAY／Article 式）：一欄大照片，尺寸做成寬｜深｜高三格",
  D:"D 依尺寸找家具：兩欄＋「我家空間多寬」篩選，放得下的才顯示",
  O:"現在：目前正式網站的樣子"
};
const css=`<style>
.demo-sw{position:fixed;left:0;right:0;bottom:0;z-index:200;background:rgba(34,29,24,.94);color:#fff;padding:8px 10px calc(8px + env(safe-area-inset-bottom,0px));font:14px/1.4 system-ui,sans-serif}
.demo-sw .row{display:flex;gap:6px}
.demo-sw button{flex:1 1 0;min-width:0;min-height:40px;padding:0;border:1px solid rgba(255,255,255,.35);border-radius:8px;background:transparent;color:#fff;font:600 15px system-ui,sans-serif}
.demo-sw button[aria-pressed="true"]{background:#fff;color:#221d18}
.demo-sw p{margin:6px 2px 0;font-size:12.5px;opacity:.88}
body{padding-bottom:112px}
.fx-top,.fx-line{bottom:120px!important}
.dz-size{display:block;white-space:nowrap;overflow:hidden;font-variant-numeric:tabular-nums}
.demo-fit{display:none}
@media(max-width:760px){
  /* A：精簡數字 */
  body[data-v="A"] #productsGrid::before{content:"尺寸：寬 × 深 × 高（公分）";flex:0 0 100%;padding:2px 2px 0;font-size:12px;color:var(--text-tertiary)}
  body[data-v="A"] .product-size{letter-spacing:.01em;color:var(--text-secondary)}
  /* B：清單 */
  body[data-v="B"] .products-grid{flex-direction:column;gap:10px!important}
  body[data-v="B"] .product-card{width:100%!important;display:grid;grid-template-columns:88px minmax(0,1fr);align-items:center;background:#fff;border-radius:12px;overflow:hidden}
  body[data-v="B"] .product-img-wrap{border-radius:10px 0 0 10px}
  body[data-v="B"] .product-info{margin:0!important;padding:10px 10px 10px 12px!important}
  body[data-v="B"] .product-name{font-size:15px;line-height:1.4;margin-bottom:4px}
  body[data-v="B"] .product-size{font-size:12.5px;color:var(--text-secondary)}
  body[data-v="B"] .favorite-btn{top:4px!important;right:auto!important;left:56px!important;width:30px!important;height:30px!important}
  body[data-v="B"] .favorite-btn svg{width:15px;height:15px}
  body[data-v="B"] .img-count-badge{transform:scale(.85);transform-origin:left bottom}
  body[data-v="B"] .products-section-head{width:100%}
  /* C：大圖 */
  body[data-v="C"] .products-grid{flex-direction:column;gap:16px!important}
  body[data-v="C"] .product-card{width:100%!important;background:#fff;border-radius:14px;overflow:hidden}
  body[data-v="C"] .product-img-wrap{aspect-ratio:4/3.4}
  body[data-v="C"] .product-info{margin:0!important;padding:12px 14px 14px!important}
  body[data-v="C"] .product-name{font-size:16px;margin-bottom:8px}
  body[data-v="C"] .dz-cells{display:flex;border:1px solid var(--line);border-radius:8px;overflow:hidden}
  body[data-v="C"] .dz-cells span{flex:1;padding:5px 0 4px;text-align:center;font-size:14px;color:var(--text);line-height:1.2}
  body[data-v="C"] .dz-cells span+span{border-left:1px solid var(--line)}
  body[data-v="C"] .dz-cells i{display:block;font-style:normal;font-size:10.5px;color:var(--text-tertiary);margin-bottom:1px}
  body[data-v="C"] .dz-cells em{font-style:normal;font-size:10.5px;color:var(--text-tertiary);margin-left:1px}
  body[data-v="C"] .favorite-btn{width:38px!important;height:38px!important;top:10px!important;right:10px!important}
  /* D：依尺寸找 */
  body[data-v="D"] .demo-fit{display:block;margin:14px 0 2px;padding:12px 12px 10px;background:#fff;border:1px solid var(--line);border-radius:12px}
  .demo-fit-q{font-size:14px;font-weight:600;color:var(--text);margin-bottom:8px}
  .demo-fit-chips{display:flex;gap:6px;flex-wrap:wrap}
  .demo-fit-chips button{border:1px solid var(--border-strong);background:var(--bg);color:var(--text-secondary);border-radius:999px;padding:6px 12px;font-size:13.5px;font-weight:600}
  .demo-fit-chips button[aria-pressed="true"]{background:var(--brand);border-color:var(--brand);color:#fff}
  .demo-fit-own{display:flex;align-items:center;gap:6px;margin-top:8px;font-size:13px;color:var(--text-secondary)}
  .demo-fit-own input{width:72px;padding:6px 8px;border:1px solid var(--border-strong);border-radius:8px;font-size:15px;background:var(--bg)}
  .demo-fit-note{margin-top:8px;font-size:12.5px;color:var(--text-tertiary)}
  body[data-v="D"] .product-size b{color:var(--brand);font-weight:700}
  body[data-v="D"] .product-card.dz-hide,body[data-v="D"] .products-section-head.dz-hide{display:none!important}
}
@media(min-width:761px){.demo-sw p::after{content:"（請用手機看，或把視窗縮到很窄）"}}
</style>`;
const js=`<script>
if(!location.hash&&!/^\\/c\\//.test(location.pathname))history.replaceState(null,"",location.pathname+"#cat-cat-chair");
(function(){
  var D=${JSON.stringify(V)},cur="A",fitW=0;
  function parse(t){var g=function(k){var m=t.match(new RegExp(k+"\\\\s*([\\\\d.]+(?:~[\\\\d.]+)?)"));return m?m[1]:""};var r={w:g("寬"),d:g("深"),h:g("高")};return (r.w||r.d||r.h)?r:null}
  function fmt(el){
    if(!el.dataset.orig)el.dataset.orig=el.textContent;
    var t=el.dataset.orig,p=parse(t);el.style.fontSize="";el.classList.toggle("dz-size",cur==="A"||cur==="D"||cur==="B");
    if(!p||cur==="O"){el.textContent=t;return}
    var parts=[["寬",p.w],["深",p.d],["高",p.h]].filter(function(x){return x[1]});
    if(cur==="A")el.textContent=parts.map(function(x){return x[1]}).join("×");
    else if(cur==="B")el.textContent=parts.map(function(x){return x[0]+" "+x[1]}).join(" · ")+" cm";
    else if(cur==="C")el.innerHTML='<span class="dz-cells">'+parts.map(function(x){return '<span><i>'+x[0]+'</i>'+x[1]+'<em>cm</em></span>'}).join("")+'</span>';
    else if(cur==="D")el.innerHTML=parts.map(function(x){return x[0]==="寬"?'寬<b>'+x[1]+'</b>':x[0]+x[1]}).join(" ");
    // 放不下時依序：字縮小一點（最小 10.5px）→ 拿掉空格 → 還是放不下才讓它換行（不會被切掉）
    if(cur!=="C"){
      el.style.whiteSpace="";
      var over=function(){return el.scrollWidth>el.clientWidth+0.5};
      var s=parseFloat(getComputedStyle(el).fontSize);
      while(over()&&s>10.5){s-=.5;el.style.fontSize=s+"px"}
      var before=el.innerHTML;
      if(over())el.innerHTML=el.innerHTML.replace(/ (·|×) /g,"$1").replace(/ cm$/,"cm").replace(/(<\\/b>|\\d) (?=[深高])/g,"$1");
      if(over()){el.innerHTML=before;el.style.whiteSpace="normal"} // 拿掉空格也放不下：換回有空格的寫法，讓它換行
    }
  }
  function widthOf(card){var el=card.querySelector(".product-size");var p=el&&parse(el.dataset.orig||el.textContent);if(!p||!p.w)return null;return parseFloat(p.w)}
  function filter(){
    var grid=document.getElementById("productsGrid");if(!grid)return;var shown=0,ask=0;
    [].forEach.call(grid.querySelectorAll(".product-card"),function(c){var w=widthOf(c);var hide=cur==="D"&&fitW>0&&(w==null||w>fitW);if(cur==="D"&&fitW>0&&w==null)ask++;c.classList.toggle("dz-hide",hide);if(!hide)shown++});
    [].forEach.call(grid.querySelectorAll(".products-section-head"),function(h){var n=h.nextElementSibling,any=false;while(n&&!n.classList.contains("products-section-head")){if(n.classList.contains("product-card")&&!n.classList.contains("dz-hide"))any=true;n=n.nextElementSibling}h.classList.toggle("dz-hide",!any)});
    var note=document.querySelector(".demo-fit-note");if(note)note.textContent=fitW>0?("寬度 "+fitW+" 公分以內的有 "+shown+" 件"+(ask?"；另有 "+ask+" 件尺寸洽詢的先不列":"")):"選一個寬度，只看放得下的家具";
  }
  function apply(){[].forEach.call(document.querySelectorAll("#productsGrid .product-size"),fmt);filter()}
  function pick(k){cur=k;document.body.dataset.v=k;[].forEach.call(document.querySelectorAll(".demo-sw button"),function(b){b.setAttribute("aria-pressed",b.dataset.k===k)});document.querySelector(".demo-sw p").textContent=D[k];apply();setTimeout(function(){dispatchEvent(new Event("resize"))},30)}
  window.__demoPick=pick;
  document.addEventListener("DOMContentLoaded",function(){
    var bar=document.createElement("div");bar.className="demo-sw";
    bar.innerHTML='<div class="row">'+["O","A","B","C","D"].map(function(k){return '<button type="button" data-k="'+k+'">'+(k==="O"?"現在":k)+'</button>'}).join("")+'</div><p></p>';
    document.body.appendChild(bar);bar.addEventListener("click",function(e){var b=e.target.closest("button");if(b)pick(b.dataset.k)});
    var fit=document.createElement("div");fit.className="demo-fit";
    fit.innerHTML='<div class="demo-fit-q">家裡的空間有多寬？<span style="font-weight:400;font-size:12px;color:var(--text-tertiary);margin-left:6px">（尺寸單位：公分）</span></div><div class="demo-fit-chips">'+[0,40,60,90].map(function(w){return '<button type="button" data-w="'+w+'" aria-pressed="'+(w===0)+'">'+(w?w+" 公分內":"全部")+'</button>'}).join("")+'</div><label class="demo-fit-own">或自己輸入：寬 <input type="number" inputmode="numeric" min="1" placeholder="例 75"> 公分以內</label><div class="demo-fit-note"></div>';
    var tb=document.querySelector(".cat-toolbar");if(tb)tb.appendChild(fit);
    fit.addEventListener("click",function(e){var b=e.target.closest("button[data-w]");if(!b)return;fitW=+b.dataset.w;fit.querySelector("input").value="";[].forEach.call(fit.querySelectorAll("button"),function(x){x.setAttribute("aria-pressed",x===b)});filter()});
    fit.querySelector("input").addEventListener("input",function(e){fitW=+e.target.value||0;[].forEach.call(fit.querySelectorAll("button"),function(x){x.setAttribute("aria-pressed",fitW===0&&x.dataset.w==="0")});filter()});
    new MutationObserver(function(){apply()}).observe(document.getElementById("productsGrid"),{childList:true});
    pick("A");
    window.addEventListener("load",function(){setTimeout(function(){var g=document.getElementById("categories");if(g)window.scrollTo({top:g.getBoundingClientRect().top+scrollY-60,behavior:"instant"})},900)});
  });
})();
</script>`;
const one=(a,b)=>{if(!h.includes(a))throw new Error("找不到 "+a);h=h.replace(a,b)};
one('<link rel="canonical" href="https://hsintong.cc/">','<meta name="robots" content="noindex,nofollow">');
one("</head>",css+js+"</head>");
h=h.replace(/<title>[^<]*<\/title>/,"<title>商品列表四種提案（示意，不公開）</title>");
writeFileSync(out,h);
