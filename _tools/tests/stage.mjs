// 做一份「重新產生過頁面」的網站，放在暫存資料夾，給測試用（不碰正式資料、不改專案裡的檔案）。
// 用法：node _tools/tests/stage.mjs [輸出資料夾]   → 印出資料夾路徑；之後 ROOT=那個資料夾 node _tools/tests/run.mjs
// 做法：複製專案（git 追蹤的檔案＋還沒 commit 的新檔），用 data/site.json 當假資料庫跑一次 build-pages.mjs，蓋上去。
import {execSync,spawn} from "node:child_process";
import {mkdirSync,rmSync} from "node:fs";
import path from "node:path";
import os from "node:os";
const REPO=path.resolve(path.dirname(new URL(import.meta.url).pathname),"../..");
const OUT=path.resolve(process.argv[2]||path.join(os.tmpdir(),"hsshop-stage"));
rmSync(OUT,{recursive:true,force:true});mkdirSync(OUT,{recursive:true});
execSync(`git ls-files -co --exclude-standard -z | xargs -0 tar -cf - | tar -x -C "${OUT}"`,{cwd:REPO,shell:"/bin/bash"});
const port=String(8900+Math.floor(Math.random()*90));
const db=spawn("node",[path.join(REPO,"_tools/tests/fake-firestore.mjs"),path.join(REPO,"data/site.json"),port],{stdio:"ignore"});
await new Promise(r=>setTimeout(r,800));
try{
  execSync(`node _tools/build-pages.mjs --out "${OUT}"`,{cwd:REPO,stdio:["ignore","inherit","inherit"],env:{...process.env,FIRESTORE_BASE:`http://127.0.0.1:${port}`}});
}finally{db.kill()}
console.log(OUT);
