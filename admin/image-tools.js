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
function detectSubjectBBox(img){
  const iw=img.naturalWidth||img.width,ih=img.naturalHeight||img.height;
  const MAX_DIM=300; // 用縮圖分析就夠了，不用掃整張原圖的像素，速度快很多
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
      const dr=data[i]-SUBJECT_BG_COLOR.r,dg=data[i+1]-SUBJECT_BG_COLOR.g,db=data[i+2]-SUBJECT_BG_COLOR.b;
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

export{uploadToCloudinary,loadImage,PHOTO_TARGET_W,PHOTO_TARGET_H,SUBJECT_TARGET_FRACTION,detectSubjectBBox,resizeImageToUniform,resizeToThumb,isUrl,thumbFor,capOriginalDataUrl,resizeSquareImage,convertGdriveUrl,normalizePhotoUrl};
