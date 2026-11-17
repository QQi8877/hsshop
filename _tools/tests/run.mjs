// 依序跑全部測試，最後列出結果。用法：
//   node _tools/tests/run.mjs                 測專案資料夾現在的樣子
//   ROOT=$(node _tools/tests/stage.mjs | tail -1) node _tools/tests/run.mjs   先重新產生頁面再測（改了版型、build-pages 時用這個）
//   node _tools/tests/run.mjs front-smoke mobile-rail   只跑指定的
import {spawnSync} from "node:child_process";
import {readdirSync} from "node:fs";
import path from "node:path";
const DIR=path.dirname(new URL(import.meta.url).pathname);
const SKIP=new Set(["lib.mjs","run.mjs","stage.mjs","fake-firestore.mjs","ui-snapshot.mjs","ui-diff.mjs"]);
const want=process.argv.slice(2);
const files=readdirSync(DIR).filter(f=>f.endsWith(".mjs")&&!SKIP.has(f)&&(!want.length||want.includes(f.replace(".mjs",""))));
let bad=0;
for(const f of files){
  const r=spawnSync("node",[path.join(DIR,f)],{encoding:"utf8",timeout:240000});
  const out=(r.stdout||"")+(r.stderr||"");
  const line=(out.match(/\d+ passed, \d+ failed/g)||["沒有跑完"]).pop();
  const ok=r.status===0&&/ 0 failed/.test(line);
  if(!ok)bad++;
  console.log(`${ok?"✓":"✗"} ${f.padEnd(22)} ${line}`);
  if(!ok)console.log(out.split("\n").filter(l=>/FAIL|Error|錯誤/.test(l)).slice(0,6).map(l=>"    "+l).join("\n"));
}
console.log(bad?`${bad} 個測試檔沒過`:"全部通過");
process.exitCode=bad?1:0;
