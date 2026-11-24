// 暫時的示意頁產生器（2026-11 手機版第二輪：視覺和體驗優先，以「1 快速瀏覽」的版面為底的三種樣子）。老闆選好之後連同示意頁一起刪掉；_tools 不會被發佈。
// 用法：node _tools/demos/ui-ideas.mjs 來源index.html 輸出.html
// 做法：拿網站首頁（真的資料、真的程式），插入 ui/demo.css 和 ui/demo.js（三種樣子的樣式和互動），加 noindex。
import {readFileSync,writeFileSync} from "node:fs";
import path from "node:path";
const here=path.dirname(new URL(import.meta.url).pathname);
const [src,out]=process.argv.slice(2);
let h=readFileSync(src,"utf8");
const css=readFileSync(path.join(here,"ui/demo.css"),"utf8"),js=readFileSync(path.join(here,"ui/demo.js"),"utf8");
const one=(a,b)=>{if(!h.includes(a))throw new Error("找不到 "+a);h=h.replace(a,()=>b)};
one('<link rel="canonical" href="https://hsintong.cc/">','<meta name="robots" content="noindex,nofollow">');
one("</head>",`<style>\n${css}\n</style>\n<script>\n${js}\n</script>\n</head>`);
h=h.replace(/<title>[^<]*<\/title>/,"<title>視覺優先三種樣子（示意，不公開）</title>");
writeFileSync(out,h);
