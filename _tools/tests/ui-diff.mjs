import fs from "fs";
const a=JSON.parse(fs.readFileSync(process.argv[2])),b=JSON.parse(fs.readFileSync(process.argv[3]));let n=0;
for(const k of Object.keys(a))for(const s of Object.keys(a[k])){const x=a[k][s],y=b[k]?.[s];if(!x||!y){if(x!==y){n++;console.log(k,s,"presence differs")}continue}
  for(const p of new Set([...Object.keys(x),...Object.keys(y)]))if(x[p]!==y[p]){n++;if(n<40)console.log(k,s,p,":",String(x[p]).slice(0,60),"→",String(y[p]).slice(0,60))}}
console.log(n?`${n} differences`:"identical");
