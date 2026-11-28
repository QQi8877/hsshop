// 統一照片大小：預覽不存檔、套用會換照片並可復原、不是去背照的不動、再跑一次全部「本來就一致」；
// 純白、淺灰、透明底（ChatGPT 修好的圖）換成網站米白、縮到 72%，商品顏色不變
import {launch,setup,ORIGIN,checker,SHOTS} from "./lib.mjs";
const ok=checker();
const b=await launch();const ctx=await b.newContext({viewport:{width:1400,height:900}});
const store=await setup(ctx);
const svg=(bg,x,y,w,h,c)=>`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><rect width="800" height="800" fill="${bg}"/><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${c}"/></svg>`;
const SHAPES=[
  ["#fffaf3",300,20,200,760,"#c9a36a"],   // 高的書櫃，頂到上下邊
  ["#fffaf3",330,340,140,120,"#8a6a4a"],  // 很小
  ["#fffaf3",80,420,360,300,"#5b6746"],   // 偏左下
  ["#ffffff",250,200,300,400,"#4d5d6b"],  // 白底、要放大（不用補邊）
  ["#9aa0a6",200,250,400,300,"#905229"],  // 灰背景：不是去背照
  ["#fffaf3",112,200,576,400,"#696255"],  // 本來就一致（72%、置中）
];
await ctx.route("https://res.cloudinary.com/**",route=>{
  const p=new URL(route.request().url()).pathname;
  const file=p.split("/").pop();
  const s=file.startsWith("test_")?SHAPES[5]:SHAPES[[...file].reduce((a,ch)=>a+ch.charCodeAt(0),0)%SHAPES.length];
  route.fulfill({contentType:"image/svg+xml",body:svg(...s),headers:{"access-control-allow-origin":"*"}});
});
const pg=await ctx.newPage();const errs=[];
pg.on("pageerror",e=>errs.push(e.message));pg.on("console",m=>{if(m.type()==="error")errs.push(m.text())});
pg.on("dialog",d=>d.accept());
await pg.goto(ORIGIN+"/manage.html");await pg.waitForSelector("#tbody tr[data-id]");
const snapshot=()=>JSON.stringify([...store].filter(([k])=>k.includes("/products/")).sort());
const before=snapshot();
await pg.click("#toolsDropdown > button");await pg.click('#toolsDropdown .dropdown-menu button:has-text("統一照片大小")');
ok(await pg.locator("#uniformModal.open").count()===1,"modal opens");
ok(await pg.locator("#uniformUndoBox").isHidden(),"no undo before first run");
await pg.click('button:has-text("先看預覽")');
await pg.waitForFunction(()=>document.getElementById("uniformLog").textContent.startsWith("預覽完成"),null,{timeout:120000});
const ptxt=await pg.locator("#uniformLog").textContent();console.log(ptxt);
ok(/\d+ 件會調整/.test(ptxt)&&/本來就一致/.test(ptxt)&&/不會動/.test(ptxt),"preview summary has all three groups");
ok(await pg.locator(".uniform-cell").count()>0,"preview cells rendered");
ok(await pg.locator(".uniform-skip").first().textContent().then(t=>t.includes("不是去背照")),"gray background explained");
ok(snapshot()===before,"preview writes nothing");
// 統一後的圖：主體最長邊 72%、置中
const frac=await pg.evaluate(async()=>{
  const img=[...document.querySelectorAll(".uniform-pair img[alt='統一後']")][0];await img.decode();
  const N=img.naturalWidth,c=document.createElement("canvas");c.width=c.height=N;const x=c.getContext("2d");x.drawImage(img,0,0);
  const d=x.getImageData(0,0,N,N).data;let a=N,bb=-1,t=N,m=-1;
  for(let y=0;y<N;y++)for(let i=0;i<N;i++){const k=(y*N+i)*4;if(Math.hypot(d[k]-255,d[k+1]-250,d[k+2]-243)>28){a=Math.min(a,i);bb=Math.max(bb,i);t=Math.min(t,y);m=Math.max(m,y)}}
  return {N,longest:Math.max(bb-a+1,m-t+1)/N,cx:(a+bb+1)/2/N,cy:(t+m+1)/2/N};
});
console.log(JSON.stringify(frac));
ok(Math.abs(frac.longest-.72)<.02&&Math.abs(frac.cx-.5)<.02&&Math.abs(frac.cy-.5)<.02,"output subject is 72% and centred");
await pg.locator("#uniformModal .modal").screenshot({path:`${SHOTS}/uniform-preview.png`});
// 套用
await pg.click('button:has-text("開始統一全部商品")');
await pg.waitForFunction(()=>document.getElementById("uniformLog").textContent.startsWith("完成"),null,{timeout:180000});
const rtxt=await pg.locator("#uniformLog").textContent();console.log(rtxt.slice(0,160));
const changed=Number(rtxt.match(/調整了 (\d+) 件/)[1]);
ok(changed>0,"some products changed");
const prods=[...store].filter(([k])=>/\/products\/[^/]+$/.test(k)).map(([,v])=>v);
const nowTest=prods.filter(p=>(p.photos||[])[0]?.includes("/test_")).length;
ok(nowTest===changed,`cover replaced on exactly the changed products (${nowTest})`);
const one=prods.find(p=>p.photos[0].includes("/test_"));
const g=store.get(`sitedata/hsshop-10bd9/products/${one.id}/gallery/full`);
ok(g.photos[0].includes("/test_")&&g.photos.length===one.photoCount,"gallery saved with new photo, count kept");
ok(one.name&&one.mainCat!==undefined&&one.updatedAt>0,"other fields kept, updatedAt stamped");
const untouched=prods.filter(p=>!(p.photos||[])[0]?.includes("/test_"));
ok(untouched.every(p=>JSON.stringify(p)===JSON.stringify(JSON.parse(before).find(([k])=>k.endsWith("/products/"+p.id))[1])),"skipped products not written at all");
ok(await pg.locator("#uniformUndoBox").isVisible(),"undo offered");
await pg.locator("#uniformModal .modal").screenshot({path:`${SHOTS}/uniform-done.png`});
// 再預覽一次：改過的都一致了
await pg.click('button:has-text("先看預覽")');
await pg.waitForFunction(()=>document.getElementById("uniformLog").textContent.startsWith("預覽完成"),null,{timeout:120000});
ok(/^預覽完成（只看封面照，還沒存檔）：0 件會調整/.test(await pg.locator("#uniformLog").textContent()),"second pass changes nothing");
// 重新整理後還能復原
await pg.reload();await pg.waitForSelector("#tbody tr[data-id]");
await pg.evaluate(()=>openUniformModal());
ok(await pg.locator("#uniformUndoBox").isVisible(),"undo survives reload");
await pg.click('button:has-text("復原")');
await pg.waitForFunction(()=>document.getElementById("uniformLog").textContent.startsWith("已換回"),null,{timeout:120000});
const after=[...store].filter(([k])=>/\/products\/[^/]+$/.test(k)).map(([,v])=>v);
const orig=new Map(JSON.parse(before).filter(([k])=>/\/products\/[^/]+$/.test(k)).map(([,v])=>[v.id,v]));
ok(after.every(p=>p.photos[0]===orig.get(p.id).photos[0]),"all covers restored");
ok(JSON.stringify(store.get(`sitedata/hsshop-10bd9/products/${one.id}/gallery/full`).photos)===JSON.stringify(JSON.parse(before).find(([k])=>k.endsWith(`/products/${one.id}/gallery/full`))[1].photos),"gallery restored");
ok(await pg.locator("#uniformUndoBox").isHidden(),"undo cleared");
// ChatGPT 修好的去背照：純白、淺灰（帶淡淡影子）、透明底都要統一成網站的米白、72%；深灰底、一般照片不動；商品顏色不變
const cases=await pg.evaluate(async()=>{
  const {uniformSubject}=await import("/admin/image-tools.js?v=3");
  const make=(bg,{shadow=false,noise=false}={})=>{const c=document.createElement("canvas");c.width=c.height=1000;const x=c.getContext("2d");
    if(bg){x.fillStyle=bg;x.fillRect(0,0,1000,1000)}
    if(noise){const g=x.createLinearGradient(0,0,1000,1000);g.addColorStop(0,"#d9c6a5");g.addColorStop(1,"#6b5a45");x.fillStyle=g;x.fillRect(0,0,1000,1000)}
    if(shadow){x.fillStyle="rgba(0,0,0,.06)";x.beginPath();x.ellipse(500,905,330,30,0,0,7);x.fill()}
    x.fillStyle="#c9a36a";x.fillRect(250,60,500,840); // 商品：高、幾乎頂到上下邊
    return c.toDataURL("image/png")};
  const look=async url=>{const img=new Image();img.src=url;await img.decode();const N=img.naturalWidth,c=document.createElement("canvas");c.width=c.height=N;const x=c.getContext("2d");x.drawImage(img,0,0);
    const d=x.getImageData(0,0,N,N).data,px=(i,j)=>{const k=(j*N+i)*4;return [d[k],d[k+1],d[k+2]]};
    let a=N,bb=-1,t=N,m=-1;for(let y=0;y<N;y+=2)for(let i=0;i<N;i+=2){const k=(y*N+i)*4;if(Math.hypot(d[k]-201,d[k+1]-163,d[k+2]-106)<40){a=Math.min(a,i);bb=Math.max(bb,i);t=Math.min(t,y);m=Math.max(m,y)}}
    return {corner:px(5,5),center:px(N/2,N/2),frac:(m-t+2)/N}};
  const out={};
  for(const [name,url] of [["white",make("#ffffff")],["gray",make("#ecebe6",{shadow:true})],["clear",make(null)],["dark",make("#9aa0a6")],["photo",make(null,{noise:true})]]){
    const r=await uniformSubject(url);out[name]={status:r.status};
    if(r.status==="ok"){Object.assign(out[name],await look(r.dataUrl));out[name].again=(await uniformSubject(r.dataUrl)).status}
  }
  return out;
});
console.log(JSON.stringify(cases));
for(const k of ["white","gray","clear"]){
  const c=cases[k];
  ok(c.status==="ok"&&Math.hypot(c.corner[0]-255,c.corner[1]-250,c.corner[2]-243)<4&&Math.abs(c.frac-.72)<.03,`${k} background: becomes the site's cream with the product at 72% (corner ${c.corner}, ${c.frac?.toFixed(3)})`);
  ok(c.status==="ok"&&Math.hypot(c.center[0]-201,c.center[1]-163,c.center[2]-106)<4,`${k} background: the product's own colour is unchanged (${c.center})`);
  ok(c.again==="same",`${k} background: running it again leaves it alone (${c.again})`);
}
ok(cases.dark.status==="nobg"&&cases.photo.status==="nobg","dark-grey backgrounds and ordinary photos are left alone");
ok(errs.length===0,"no JS errors"+(errs.length?": "+errs.slice(0,3).join(" | "):""));
ok.done();await b.close();
