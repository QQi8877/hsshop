// 照片處理：Cloudinary 上傳、縮圖、白底置中、商品主體偵測、Google Drive／Cloudinary 網址轉換

/* ── Cloudinary 圖床 ───────────────────────────────────────────
   file 可以是本機選的檔案（File 物件），也可以是一個網址字串
   （Cloudinary 的上傳 API 兩種都吃，貼網址時會由 Cloudinary 自己
   去抓那個網址的圖片，不用我們自己先下載一次再轉傳）。
   失敗時丟出例外，呼叫端要自己接住、決定要不要退回本機暫存方式。 */
const CLOUDINARY_CLOUD_NAME="oqcmekau";
const CLOUDINARY_UPLOAD_PRESET="hsintong_products";
async function uploadToCloudinary(fileOrUrl){
  const formData=new FormData();
  formData.append("file",fileOrUrl);
  formData.append("upload_preset",CLOUDINARY_UPLOAD_PRESET);
  const res=await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`,{
    method:"POST",
    body:formData
  });
  if(!res.ok){
    const errText=await res.text().catch(()=>"");
    throw new Error(`Cloudinary 上傳失敗（狀態碼 ${res.status}）${errText.slice(0,120)}`);
  }
  const data=await res.json();
  if(!data.secure_url)throw new Error("Cloudinary 回應裡沒有圖片網址");
  return data.secure_url;
}

function loadImage(src){
  return new Promise((resolve,reject)=>{
    const img=new Image();
    img.crossOrigin="anonymous";
    img.onload=()=>resolve(img);
    img.onerror=reject;
    img.src=src;
  });
}
const PHOTO_TARGET_W=1200,PHOTO_TARGET_H=1200;

/* ── 自動偵測商品主體範圍，統一各張照片的縮放比例 ───────────────────
   商品照片背景色是固定的（跟 resizeImageToUniform 烤進照片裡的底色 #fffaf3
   一致），不用去猜背景色在哪、也不需要真的去背透明圖——直接算每個像素
   跟這個已知底色的色差，色差夠大的範圍就是商品主體，再統一縮放成主體
   最長邊佔畫面固定比例，商品有大有小拍出來的照片看起來就會一致大小。 */
const SUBJECT_BG_COLOR={r:255,g:250,b:243}; // #fffaf3
const SUBJECT_TARGET_FRACTION=0.72; // 主體最長邊要佔畫面的比例，愈小代表四周留白愈多
function detectSubjectBBox(img,MAX_DIM=300,bg=SUBJECT_BG_COLOR){ // MAX_DIM：分析用的縮圖大小；愈大愈準、愈慢；bg：照片的底色（預設網站底色）
  const iw=img.naturalWidth||img.width,ih=img.naturalHeight||img.height;
  // 用縮圖分析就夠了，不用掃整張原圖的像素，速度快很多
  const scale=Math.min(1,MAX_DIM/Math.max(iw,ih));
  const w=Math.max(1,Math.round(iw*scale)),h=Math.max(1,Math.round(ih*scale));
  const canvas=document.createElement("canvas");
  canvas.width=w;canvas.height=h;
  const ctx=canvas.getContext("2d",{willReadFrequently:true});
  ctx.drawImage(img,0,0,w,h);
  let data;
  try{data=ctx.getImageData(0,0,w,h).data}catch(e){return null} // 跨網域圖片會擋讀取像素，直接放棄自動偵測
  const TOLERANCE=28;
  let minX=w,minY=h,maxX=-1,maxY=-1;
  for(let y=0;y<h;y++){
    for(let x=0;x<w;x++){
      const i=(y*w+x)*4;
      if(data[i+3]<10)continue; // 透明像素當背景看待
      const dr=data[i]-bg.r,dg=data[i+1]-bg.g,db=data[i+2]-bg.b;
      if(Math.sqrt(dr*dr+dg*dg+db*db)>TOLERANCE){
        if(x<minX)minX=x;
        if(x>maxX)maxX=x;
        if(y<minY)minY=y;
        if(y>maxY)maxY=y;
      }
    }
  }
  if(maxX<minX||maxY<minY)return null; // 整張都接近背景色，偵測不到主體
  const inv=1/scale;
  return {x:minX*inv,y:minY*inv,w:(maxX-minX+1)*inv,h:(maxY-minY+1)*inv};
}

/* ── 統一照片大小（「一鍵統一全部照片」跟上傳時自動置中共用）──────────────
   把商品主體縮放成最長邊佔畫面 SUBJECT_TARGET_FRACTION、放在正中間，四周補上網站的照片底色。
   跟裁切視窗的「自動置中」不同的是可以縮小：商品頂到照片邊緣的（例如高的書櫃）也能留出一樣的白邊。
   只處理「去背照」：四個角落是同一個淺色（米白、純白、淺灰，例如 ChatGPT 修好的白底圖）或透明才動手；
   一般的生活照、店內實拍整張都是主體，縮小只會多出一圈邊框，所以原樣留著。
   底色跟網站的米白不一樣（純白、淺灰）時，順便把底色換成網站的米白，前台每張照片的底色才會一樣。
   回傳 {status, dataUrl?}：
     ok＝處理好了（dataUrl 是新照片）　same＝本來就一致，不用動
     nobg＝不是去背照　nosubject＝找不到商品　error＝照片讀不到 */
const BG_SEAM_LIMIT=8; // 照片底色跟網站底色差多少以內，直接補邊就看不出接縫（再多就要先把底色換掉）
const colorDist=(a,b)=>Math.hypot(a.r-b.r,a.g-b.g,a.b-b.b);
// 四個角落：各自的平均顏色、是不是透明。回傳 {bg:四角平均色, transparent, spread:四角彼此最大差距, dist:最偏的角跟網站底色差多少}
function cornerBackground(img){
  const size=48,canvas=document.createElement("canvas");
  canvas.width=size;canvas.height=size;
  const ctx=canvas.getContext("2d",{willReadFrequently:true});
  ctx.drawImage(img,0,0,size,size);
  let data;
  try{data=ctx.getImageData(0,0,size,size).data}catch(e){return null}
  const corners=[];
  for(const [cx,cy] of [[0,0],[size-4,0],[0,size-4],[size-4,size-4]]){
    let r=0,g=0,b=0,a=0;
    for(let y=cy;y<cy+4;y++)for(let x=cx;x<cx+4;x++){const i=(y*size+x)*4;r+=data[i];g+=data[i+1];b+=data[i+2];a+=data[i+3]}
    corners.push({r:r/16,g:g/16,b:b/16,a:a/16});
  }
  if(corners.every(c=>c.a<20))return{transparent:true,bg:SUBJECT_BG_COLOR,spread:0,dist:0};
  const bg={r:0,g:0,b:0};corners.forEach(c=>{bg.r+=c.r/4;bg.g+=c.g/4;bg.b+=c.b/4});
  let spread=0;for(const c of corners)for(const d of corners)spread=Math.max(spread,colorDist(c,d));
  return{transparent:false,bg,spread,dist:Math.max(...corners.map(c=>colorDist(c,SUBJECT_BG_COLOR)))};
}
// 是不是去背照的底：跟網站底色很接近，或是四個角落同一個很淺、幾乎沒有顏色的底（純白、淺灰）
function isCutoutBackground(info){
  if(info.transparent||info.dist<=28)return true;
  const {r,g,b}=info.bg;
  return info.spread<=14&&Math.min(r,g,b)>=200&&Math.max(r,g,b)-Math.min(r,g,b)<=18;
}
// 把照片的底色調成網站的米白：接近底色的像素（底、淡淡的影子）整個照比例調亮調暖，影子深淺跟原本一樣；
// 跟底色差很多的（商品本身）完全不動，中間慢慢過渡，不會有一圈接縫
function recolorBackground(ctx,x,y,w,h,bg){
  if(w<1||h<1)return;
  const image=ctx.getImageData(x,y,w,h),d=image.data;
  const gr=SUBJECT_BG_COLOR.r/bg.r-1,gg=SUBJECT_BG_COLOR.g/bg.g-1,gb=SUBJECT_BG_COLOR.b/bg.b-1;
  for(let i=0;i<d.length;i+=4){
    if(!d[i+3])continue; // 透明（照片外面）跳過
    const dist=Math.hypot(d[i]-bg.r,d[i+1]-bg.g,d[i+2]-bg.b);
    if(dist>=70)continue;
    const k=dist<=30?1:(70-dist)/40;
    d[i]*=1+gr*k;d[i+1]*=1+gg*k;d[i+2]*=1+gb*k;
  }
  ctx.putImageData(image,x,y);
}
async function uniformSubject(src){
  let img;
  try{img=await loadImage(src)}catch(e){return{status:"error"}}
  const info=cornerBackground(img);
  if(!info)return{status:"error"};
  if(!isCutoutBackground(info))return{status:"nobg"};
  const recolor=!info.transparent&&info.dist>BG_SEAM_LIMIT; // 純白、淺灰底：要換成網站的米白
  const bbox=detectSubjectBBox(img,600,info.bg); // 比裁切視窗的自動置中準一點：小件商品差一個像素，大小就差好幾 %
  if(!bbox)return{status:"nosubject"};
  const iw=img.naturalWidth,ih=img.naturalHeight,longest=Math.max(bbox.w,bbox.h);
  const cx=bbox.x+bbox.w/2,cy=bbox.y+bbox.h/2;
  const square=Math.abs(iw-ih)/Math.max(iw,ih)<.01;
  if(!recolor&&!info.transparent&&square&&Math.abs(longest/iw-SUBJECT_TARGET_FRACTION)<.015&&Math.abs(cx/iw-.5)<.012&&Math.abs(cy/ih-.5)<.012)return{status:"same"};
  const W=PHOTO_TARGET_W,H=PHOTO_TARGET_H,scale=SUBJECT_TARGET_FRACTION*W/longest;
  const x0=W/2-cx*scale,y0=H/2-cy*scale;
  try{
    const canvas=document.createElement("canvas");
    canvas.width=W;canvas.height=H;
    const ctx=canvas.getContext("2d");
    ctx.fillStyle="#fffaf3";
    ctx.fillRect(0,0,W,H);
    ctx.imageSmoothingQuality="high";
    if(recolor){
      // 先放在一張透明的畫布上換好底色，再疊到米白底上：照片邊緣（半透明的那一圈）也換過，
      // 跟補的邊接起來都是米白，不會出現一條細線
      const tmp=document.createElement("canvas");tmp.width=W;tmp.height=H;
      const tctx=tmp.getContext("2d",{willReadFrequently:true});
      tctx.imageSmoothingQuality="high";
      tctx.drawImage(img,x0,y0,iw*scale,ih*scale);
      recolorBackground(tctx,0,0,W,H,info.bg);
      ctx.drawImage(tmp,0,0);
    }else ctx.drawImage(img,x0,y0,iw*scale,ih*scale);
    return{status:"ok",dataUrl:canvas.toDataURL("image/jpeg",0.9)};
  }catch(e){return{status:"error"}}
}

function resizeImageToUniform(src){
  return loadImage(src).then(img=>{
    try{
      const canvas=document.createElement("canvas");
      canvas.width=PHOTO_TARGET_W;
      canvas.height=PHOTO_TARGET_H;
      const ctx=canvas.getContext("2d");
      ctx.fillStyle="#fffaf3";
      ctx.fillRect(0,0,PHOTO_TARGET_W,PHOTO_TARGET_H);
      const scale=Math.min(PHOTO_TARGET_W/img.width,PHOTO_TARGET_H/img.height);
      const w=img.width*scale,h=img.height*scale;
      ctx.drawImage(img,(PHOTO_TARGET_W-w)/2,(PHOTO_TARGET_H-h)/2,w,h);
      return canvas.toDataURL("image/jpeg",0.86);
    }catch(e){
      return src;
    }
  }).catch(()=>src);
}
const THUMB_W=480,THUMB_H=480;
function resizeToThumb(src){
  // 只給商品列表封面用的小尺寸版本，畫質跟原圖無關——原圖仍完整存在圖庫子文件裡，
  // 編輯商品/前台燈箱看到的還是未經過這層縮圖的原始照片。
  return loadImage(src).then(img=>{
    try{
      const canvas=document.createElement("canvas");
      canvas.width=THUMB_W;
      canvas.height=THUMB_H;
      const ctx=canvas.getContext("2d");
      ctx.fillStyle="#fffaf3";
      ctx.fillRect(0,0,THUMB_W,THUMB_H);
      const scale=Math.min(THUMB_W/img.width,THUMB_H/img.height);
      const w=img.width*scale,h=img.height*scale;
      ctx.drawImage(img,(THUMB_W-w)/2,(THUMB_H-h)/2,w,h);
      return canvas.toDataURL("image/jpeg",0.82);
    }catch(e){
      return src;
    }
  }).catch(()=>src);
}
const isUrl=src=>/^https?:\/\//i.test(src||"");
// 商品封面縮圖：如果這張照片已經是網址（Cloudinary 上傳成功，或本來就是外部連結），
// 直接原樣使用就好，不用再跑一次 canvas 轉成 base64——不然每次存檔都會把好不容易
// 搬去 Cloudinary 的照片，重新烤回一份 base64 縮圖存進商品文件，白費搬遷的意義。
// 顯示大小交給 normalizePhotoUrl 用 Cloudinary 的 w_ 參數處理即可。
function thumbFor(photo){
  return isUrl(photo)?Promise.resolve(photo):resizeToThumb(photo);
}
// workingPhotosOriginal 存的是使用者上傳當下「未經任何縮放」的原始檔案，
// 手機相機隨便一張都可能是 3000x4000px、好幾 MB，5 張疊在同一份 gallery/full
// 文件裡很容易超過 Firestore 單一文件 1MB 的上限而存檔失敗。這裡把原圖限制在
// 「重新裁切／縮放時還夠用」的最大邊長內，非 data: 的網址（Google Drive／外部連結）
// 本來就只是短字串直接放行，不需要也不能重新編碼。
function capOriginalDataUrl(src,maxDim,quality){
  if(!src||!src.startsWith("data:"))return Promise.resolve(src);
  return loadImage(src).then(img=>{
    try{
      const scale=Math.min(1,maxDim/Math.max(img.width,img.height));
      const w=Math.max(1,Math.round(img.width*scale)),h=Math.max(1,Math.round(img.height*scale));
      const canvas=document.createElement("canvas");
      canvas.width=w;
      canvas.height=h;
      canvas.getContext("2d").drawImage(img,0,0,w,h);
      return canvas.toDataURL("image/jpeg",quality);
    }catch(e){
      return src;
    }
  }).catch(()=>src);
}
// 首頁大圖／分類磚縮圖用：跟商品照片同一套「白底裁切置中」邏輯，
// 但畫面上只會顯示縮圖大小，用比商品原圖小很多的尺寸存，避免版面設定塞爆單一份 Firestore 文件
function resizeSquareImage(src,size,quality){
  return loadImage(src).then(img=>{
    try{
      const canvas=document.createElement("canvas");
      canvas.width=size;
      canvas.height=size;
      const ctx=canvas.getContext("2d");
      ctx.fillStyle="#fffaf3";
      ctx.fillRect(0,0,size,size);
      const scale=Math.min(size/img.width,size/img.height);
      const w=img.width*scale,h=img.height*scale;
      ctx.drawImage(img,(size-w)/2,(size-h)/2,w,h);
      return canvas.toDataURL("image/jpeg",quality);
    }catch(e){
      return src;
    }
  }).catch(()=>src);
}
function extractGdriveId(url){
  const patterns=[/\/file\/d\/([a-zA-Z0-9_-]+)/,/[?&]id=([a-zA-Z0-9_-]+)/,/\/d\/([a-zA-Z0-9_-]+)/];
  for(const pattern of patterns){
    const match=String(url).match(pattern);
    if(match)return match[1];
  }
  return null;
}
function convertGdriveUrl(url){
  const id=extractGdriveId(url);
  return id?`https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w2000`:url;
}
function convertCloudinaryUrl(url){
  return url.replace(/\/image\/upload\//,"/image/upload/f_auto,q_auto/");
}
function normalizePhotoUrl(url){
  if(/drive\.google\.com/i.test(url))return convertGdriveUrl(url);
  if(/res\.cloudinary\.com/i.test(url))return convertCloudinaryUrl(url);
  return url;
}

export{uniformSubject,uploadToCloudinary,loadImage,PHOTO_TARGET_W,PHOTO_TARGET_H,SUBJECT_TARGET_FRACTION,detectSubjectBBox,resizeImageToUniform,resizeToThumb,isUrl,thumbFor,capOriginalDataUrl,resizeSquareImage,convertGdriveUrl,normalizePhotoUrl};
