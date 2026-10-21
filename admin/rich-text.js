// 商品說明的簡易富文本編輯器（貼上整理、文字樣式、清單）
import{escapeHTML}from"./util.js?v=1";
import{sanitizeRichHtml,richTextIsEmpty}from"../shop-render.js?v=6";

/* ── 商品說明簡易富文本編輯器（底線／文字大小／文字顏色／網底）─── */
// AI 聊天複製出來的文字常帶 Markdown 符號（**粗體**、# 標題、- 清單、--- 分隔線），貼進說明時整理成網站用的格式
function cleanPastedText(text){
  return String(text??"").replace(/\r\n|\r/g,"\n").split("\n").map(line=>{
    if(/^\s*([-*_])(\s*\1){2,}\s*$/.test(line))return "";
    return line.replace(/^\s{0,3}#{1,6}\s+/,"").replace(/^\s*[-*+]\s+/,"• ").replace(/\*\*(.+?)\*\*|__(.+?)__/g,"$1$2");
  }).join("\n").replace(/\n{3,}/g,"\n\n").trim();
}
const rteSavedRange={};
function rteInit(id){
  const editor=document.getElementById(id);
  if(!editor||editor.dataset.rteReady)return;
  editor.dataset.rteReady="1";
  const saveSel=()=>{
    const sel=window.getSelection();
    if(sel.rangeCount&&editor.contains(sel.anchorNode))rteSavedRange[id]=sel.getRangeAt(0).cloneRange();
  };
  editor.addEventListener("mouseup",saveSel);
  editor.addEventListener("keyup",saveSel);
  // 讓瀏覽器原生 Enter 換行也統一存成 <br>（不用自訂攔截 Enter 那種寫法，
  // 避免影響上下清單的 Enter 行為），這樣跟貼上文字、自動產文案的格式一致。
  editor.addEventListener("focus",()=>{
    try{document.execCommand("defaultParagraphSeparator",false,"br")}catch(e){}
  });
  editor.addEventListener("paste",e=>{
    e.preventDefault();
    const text=cleanPastedText((e.clipboardData||window.clipboardData).getData("text/plain"));
    const html=escapeHTML(text).replace(/\n/g,"<br>");
    document.execCommand("insertHTML",false,html);
  });
}
window.rteApply=function(id,styleProp,value){
  const editor=document.getElementById(id);
  const range=rteSavedRange[id];
  if(!editor||!range)return;
  const sel=window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  if(sel.isCollapsed)return;
  const span=document.createElement("span");
  span.style[styleProp]=value;
  try{
    range.surroundContents(span);
  }catch(e){
    const contents=range.extractContents();
    span.appendChild(contents);
    range.insertNode(span);
  }
  sel.removeAllRanges();
  editor.focus();
};
window.rteList=function(id,command){
  const editor=document.getElementById(id);
  if(!editor)return;
  const range=rteSavedRange[id];
  const rangeStillValid=range&&editor.contains(range.startContainer)&&editor.contains(range.endContainer);
  const sel=window.getSelection();
  sel.removeAllRanges();
  editor.focus();
  if(rangeStillValid){
    sel.addRange(range);
  }else{
    const r=document.createRange();
    r.selectNodeContents(editor);
    r.collapse(false);
    sel.addRange(r);
  }
  document.execCommand(command,false,null);
};
window.rteClear=function(id){
  const editor=document.getElementById(id);
  const range=rteSavedRange[id];
  if(!editor||!range)return;
  const sel=window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  if(sel.isCollapsed)return;
  const text=range.toString();
  range.deleteContents();
  range.insertNode(document.createTextNode(text));
  sel.removeAllRanges();
  editor.focus();
};
// 「看得到的字都沒有就當成沒寫」跟前台用同一份判斷（shop-render.js）
// 商品說明只留編輯器做得出來的格式（粗體、底線、文字大小、顏色、網底、清單、換行），其他一律拿掉；
// 跟前台顯示時用的是同一個白名單（shop-render.js），後台看到的就是顧客看到的。
function sanitizeRichText(html){return sanitizeRichHtml(html)}

export{rteInit,richTextIsEmpty,sanitizeRichText};
