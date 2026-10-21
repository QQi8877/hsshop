// 後台共用的小工具

function escapeHTML(str=""){
  return String(str).replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[ch]));
}

export{escapeHTML};
