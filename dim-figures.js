/* ── 尺寸示意圖模組（前台商品詳情頁、後台商品編輯共用）──────────────
   兩邊都 import 這個檔案，畫出來的圖一模一樣。每張圖都用同一套斜投影畫成立體
   線稿，自動標出「寬／深／高」；椅子、扶手椅、板凳這類有座面的圖，商品有填座高
   時再多標一段「座高」。

   每張圖的家具都會自動縮放到剛好塞進同樣大小的正方形（寬的碰到左右、高的碰到上下），
   放在一樣大的圖框正中間，所以不管哪一張，大小跟位置都一致。

   新增一種示意圖：在下面 FIGURES 加一筆 {key,label,seat,draw}，draw 裡用 s.box()／
   s.line() 把家具畫出來（x＝寬、y＝高、z＝深，只要比例對就好，大小會自動縮放；
   先畫後面、後畫前面），最後回傳整體的 {W,D,H}（有座面再加 seatY）。標尺寸的線
   跟文字會自動加上，後台的選單也會自動多出這個選項。
   ⚠ 改了這個檔案，記得把 index.html、manage.html 裡 import 網址的 ?v= 數字加一，
   不然瀏覽器可能還在用快取裡的舊版。 */

const KX=.55,KY=.32;      // 深度方向往右上斜的比例
const FONT=13;
const G=8,T=3;            // 尺寸線離家具的距離、兩端短線的一半長度（圖上的長度，不跟著家具縮放）
const BOX=82;             // 家具縮放到剛好塞進 82×82 的正方形
const SIDE=29,EDGE=22;    // 左右各留 29 給「高」「座高」、上下各留 22 給「寬」；兩邊一樣寬，家具才會在正中間
const VIEW_W=BOX+SIDE*2,VIEW_H=BOX+EDGE*2; // 每張圖的圖框都是 140×126
const C={ink:"#201e1d",front:"#fffaf3",side:"#ece1ce",top:"#f5ecdd",dim:"#905229",label:"#8c491a"};
const FACE=`stroke="${C.ink}" stroke-width="1.2" stroke-linejoin="round"`;
const S={
  front:`fill="${C.front}" ${FACE}`,
  side:`fill="${C.side}" ${FACE}`,
  top:`fill="${C.top}" ${FACE}`,
  leg:`stroke="${C.ink}" stroke-width="1.8" stroke-linecap="round"`,
  thin:`stroke="${C.ink}" stroke-width="1" stroke-linecap="round"`,
  dim:`stroke="${C.dim}" stroke-width="1.1" stroke-linecap="round"`,
  seatDim:`stroke="${C.label}" stroke-width="1.5" stroke-linecap="round"`,
  label:`fill="${C.label}" font-size="${FONT}" font-weight="600"`
};
const r1=n=>Math.round(n*10)/10;

// k：家具的縮放比例（見 buildFigure）；只縮放座標，線的粗細、字的大小不變
function createScene(k=1){
  const parts=[];
  let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
  const grow=(x,y)=>{minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y)};
  const P=([x,y,z])=>{const p=[k*(x+KX*z),-k*(y+KY*z)];grow(...p);return p};
  const s={
    poly(points,style){parts.push(`<polygon points="${points.map(p=>P(p).map(r1).join(",")).join(" ")}" ${style}/>`)},
    line(a,b,style){const [x1,y1]=P(a),[x2,y2]=P(b);parts.push(`<line x1="${r1(x1)}" y1="${r1(y1)}" x2="${r1(x2)}" y2="${r1(y2)}" ${style}/>`)},
    // 實心方塊：只畫看得到的正面、右側、頂面
    box(x,y,z,w,h,d){
      s.poly([[x,y,z],[x+w,y,z],[x+w,y+h,z],[x,y+h,z]],S.front);
      s.poly([[x+w,y,z],[x+w,y,z+d],[x+w,y+h,z+d],[x+w,y+h,z]],S.side);
      s.poly([[x,y+h,z],[x+w,y+h,z],[x+w,y+h,z+d],[x,y+h,z+d]],S.top);
    },
    label(at,dx,dy,text,anchor){
      const [px,py]=P(at),x=px+dx,y=py+dy,w=FONT*text.length;
      const left=anchor==="end"?x-w:anchor==="middle"?x-w/2:x;
      grow(left,y-FONT*.9);grow(left+w,y+FONT*.2);
      parts.push(`<text x="${r1(x)}" y="${r1(y)}" text-anchor="${anchor}" ${S.label}>${text}</text>`);
    },
    // 直書（一字一行）：座高寫在直的尺寸線旁邊，比橫寫省下左右的寬度，左右留白才能跟另一邊一樣
    stackLabel(at,dx,text){
      const [px,py]=P(at),x=px+dx,chars=[...text],step=FONT*1.1;
      const top=py-(step*(chars.length-1)+FONT)/2;
      grow(x-FONT/2,top);grow(x+FONT/2,top+step*(chars.length-1)+FONT);
      parts.push(`<text text-anchor="middle" ${S.label}>${chars.map((c,i)=>`<tspan x="${r1(x)}" y="${r1(top+FONT*.88+step*i)}">${c}</tspan>`).join("")}</text>`);
    },
    bbox(){return {minX,maxX,minY,maxY}},
    // geo：家具本身（不含尺寸線）的範圍，家具的中心就是圖框的正中間；
    // 萬一哪天標示超出圖框，上下（或左右）一起放大，家具還是在正中間
    svg(key,geo){
      const cx=(geo.minX+geo.maxX)/2,cy=(geo.minY+geo.maxY)/2;
      const w=Math.max(VIEW_W,2*Math.max(cx-minX,maxX-cx)+4),h=Math.max(VIEW_H,2*Math.max(cy-minY,maxY-cy)+4);
      return `<svg data-figure="${key}" viewBox="${r1(cx-w/2)} ${r1(cy-h/2)} ${r1(w)} ${r1(h)}" width="${r1(w)}" height="${r1(h)}" aria-hidden="true" focusable="false">${parts.join("")}</svg>`;
    }
  };
  return s;
}

// 寬標在正面下緣、深標在右側下緣、高標在右後方（跟深接在同一個角），座高標在左前方（直書）
function addDims(s,{W,D,H,seatY},k){
  const g=G/k,t=T/k; // 換回家具的座標單位，縮放之後畫面上的距離才一樣
  s.line([0,0,-g],[W,0,-g],S.dim);s.line([0,0,-g-t],[0,0,-g+t],S.dim);s.line([W,0,-g-t],[W,0,-g+t],S.dim);
  s.label([W/2,0,-g],0,FONT+1,"寬","middle");
  s.line([W+g,0,0],[W+g,0,D],S.dim);s.line([W+g-t,0,0],[W+g+t,0,0],S.dim);s.line([W+g-t,0,D],[W+g+t,0,D],S.dim);
  s.label([W+g,0,D/2],6,FONT/2+3,"深","start");
  s.line([W+g,0,D],[W+g,H,D],S.dim);s.line([W+g-t,H,D],[W+g+t,H,D],S.dim);
  s.label([W+g,H/2,D],6,FONT/2-1,"高","start");
  if(seatY!=null){
    s.line([-g,0,0],[-g,seatY,0],S.seatDim);s.line([-g-t,0,0],[-g+t,0,0],S.seatDim);s.line([-g-t,seatY,0],[-g+t,seatY,0],S.seatDim);
    s.stackLabel([-g,seatY/2,0],-6-FONT/2,"座高");
  }
}

const FIGURES=[
  {key:"table",label:"桌子",draw(s){
    const W=64,D=36,H=42,t=4,i=3;
    for(const [x,z] of [[i,D-i],[W-i,D-i],[i,i],[W-i,i]])s.line([x,0,z],[x,H-t,z],S.leg);
    s.box(0,H-t,0,W,t,D);
    return {W,D,H};
  }},
  {key:"chair",label:"椅子",seat:true,draw(s){
    const W=44,D=38,SH=38,t=4,H=80;
    for(const x of [2,W-2])s.line([x,0,D-2],[x,H-2,D-2],S.leg); // 後腳往上延伸成椅背立柱
    for(const x of [2,W-2])s.line([x,0,2],[x,SH-t,2],S.leg);
    s.box(0,SH-t,0,W,t,D);
    s.box(0,SH+16,D-4,W,H-SH-16,3);
    return {W,D,H,seatY:SH};
  }},
  {key:"armchair",label:"扶手椅",seat:true,draw(s){
    const W=46,D=42,SH=34,t=5,H=74,A=SH+17;
    for(const x of [2,W-2])s.line([x,0,D-2],[x,H-2,D-2],S.leg);
    for(const x of [2,W-2])s.line([x,0,2],[x,SH-t,2],S.leg);
    s.box(0,SH-t,0,W,t,D);
    s.box(0,SH+4,D-5,W,H-SH-4,4);
    for(const x of [0,W-4]){
      s.line([x+2,SH,5],[x+2,A-3,5],S.leg);
      s.box(x,A-3,2,4,3,D-7);
    }
    return {W,D,H,seatY:SH};
  }},
  {key:"stool",label:"板凳",seat:true,draw(s){
    const W=40,D=30,H=44,t=5,i=3,y=14;
    for(const [x,z] of [[i,D-i],[W-i,D-i]])s.line([x,0,z],[x,H-t,z],S.leg);
    s.line([i,y,D-i],[W-i,y,D-i],S.thin);s.line([i,y,i],[i,y,D-i],S.thin);s.line([W-i,y,i],[W-i,y,D-i],S.thin);
    for(const [x,z] of [[i,i],[W-i,i]])s.line([x,0,z],[x,H-t,z],S.leg);
    s.line([i,y,i],[W-i,y,i],S.thin);
    s.box(0,H-t,0,W,t,D);
    return {W,D,H,seatY:H};
  }},
  {key:"rack",label:"層架",draw(s){
    const W=46,D=28,H=66,t=2;
    for(const x of [1,W-1])s.line([x,0,D-1],[x,H,D-1],S.leg);
    for(const y of [4,26,48,H-t])s.box(0,y,0,W,t,D);
    for(const x of [1,W-1])s.line([x,0,1],[x,H,1],S.leg);
    return {W,D,H};
  }},
  {key:"cabinet",label:"櫃子",draw(s){
    const W=46,D=30,H=58,top=12,m=W/2;
    s.box(0,0,0,W,H,D);
    s.line([0,H-top,0],[W,H-top,0],S.thin);
    s.line([m,0,0],[m,H-top,0],S.thin);
    s.line([m-6,H-top/2,0],[m+6,H-top/2,0],S.leg);
    for(const x of [m-4,m+4])s.line([x,H-top-10,0],[x,H-top-18,0],S.leg);
    return {W,D,H};
  }},
  {key:"bed",label:"床",draw(s){
    const W=50,D=72,H=34,base=12,m=8;
    s.box(0,0,D-4,W,H,4);
    s.box(0,0,0,W,base,D-4);
    s.box(2,base,2,W-4,m,D-8);
    s.box(8,base+m,D-18,W-16,4,10);
    return {W,D,H};
  }},
  {key:"box",label:"方塊",draw(s){
    const W=46,D=30,H=46;
    s.box(0,0,0,W,H,D);
    return {W,D,H};
  }}
];

// 後台選單用的清單（順序就是選單上的順序）
export const DIM_FIGURES=FIGURES.map(({key,label,seat})=>({key,label,seat:!!seat}));

function buildFigure(fig,seat){
  // 先照原本的大小畫一次量出家具的範圍，算出縮放比例，讓家具剛好塞進 BOX×BOX
  const probe=createScene();
  fig.draw(probe);
  const b=probe.bbox();
  const k=BOX/Math.max(b.maxX-b.minX,b.maxY-b.minY);
  const s=createScene(k);
  const size=fig.draw(s);
  const geo=s.bbox();
  addDims(s,{...size,seatY:seat&&fig.seat?size.seatY:null},k);
  return s.svg(fig.key,geo);
}

// seat：商品有座高時傳 true，有座面的圖（椅子、扶手椅、板凳）會多標一段座高
export function dimFigureSvg(key,{seat=false}={}){
  const fig=FIGURES.find(f=>f.key===key);
  return fig?buildFigure(fig,seat):"";
}

// 「自動」：依子分類（對不上再看主分類）的名稱決定。床邊桌要算桌子，所以「桌」排在「床」前面；
// 床架的「架」不能當成層架，所以「床」排在「架」前面；「鞋櫃/架」這種兩個字都有的算層架
export function autoDimFigureKey(subName,mainName){
  for(const name of [subName,mainName]){
    if(!name)continue;
    if(/藤椅|沙發/.test(name))return "armchair";
    if(/凳/.test(name))return "stool";
    if(/椅/.test(name))return "chair";
    if(/桌|几|台/.test(name))return "table";
    if(/床|寢具/.test(name))return "bed";
    if(/架/.test(name))return "rack";
    if(/櫃/.test(name))return "cabinet";
  }
  return "box";
}

// 商品的 dimFigure 欄位：空白＝自動、"none"＝不顯示、其他＝指定的示意圖；回傳要畫的 key（不畫就回傳 ""）
export function resolveDimFigureKey(choice,subName,mainName){
  if(choice==="none")return "";
  return FIGURES.some(f=>f.key===choice)?choice:autoDimFigureKey(subName,mainName);
}

// 後台的寬深高、規格列都是自由輸入的文字。讀得懂的格式：「60」「33.5」「81~93」「60cm」「60 公分」
// → {min,max}；讀不懂的（例如「依需求訂做」）→ {text}，原字顯示；空白或「洽詢」→ null
export function parseDim(value){
  const text=String(value??"").trim();
  if(!text||/洽詢/.test(text))return null;
  const m=/^(\d+(?:\.\d+)?)\s*(?:[~～\-–—]\s*(\d+(?:\.\d+)?))?\s*(?:cm|公分)?$/i.exec(text);
  if(!m)return {text};
  const nums=[m[1],m[2]].filter(n=>n!==undefined).map(Number).filter(n=>n>0);
  if(!nums.length)return null;
  return {min:Math.min(...nums),max:Math.max(...nums)};
}

// 規格列裡的「椅面／座面／座高」那一列（沒有回傳 -1）；它的高就是座高
export function findSeatSpecIndex(specs){
  return (specs||[]).findIndex(spec=>spec&&typeof spec==="object"&&"part" in spec&&/椅面|座面|座高|坐高/.test(spec.part||""));
}
export function hasSeatHeight(specs){
  const index=findSeatSpecIndex(specs);
  const dim=index>=0?parseDim(specs[index].h):null;
  return !!dim&&dim.text===undefined;
}
