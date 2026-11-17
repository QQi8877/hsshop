// In-memory Firestore stand-in; state lives in the Node test harness (shared across tabs).
const call=async(op,body)=>{
  const r=await fetch("/__db/"+op,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
  const j=await r.json();
  if(j.error)throw new Error(j.error);
  return j.result;
};
const join=(base,segs)=>[base,...segs].filter(Boolean).join("/");
export function getFirestore(){return {type:"db"}}
export function collection(parent,...segs){return {type:"coll",path:join(parent.path||"",segs)}}
export function doc(parent,...segs){const path=join(parent.path||"",segs);return {type:"doc",path,id:path.split("/").pop()}}
export function query(coll,...cons){return {type:"query",path:coll.path,cons}}
export function where(f,op,v){return {f,op,v}}
const snap=(path,data)=>({id:path.split("/").pop(),ref:{path},exists:()=>data!=null,data:()=>data==null?undefined:JSON.parse(JSON.stringify(data))});
export async function getDoc(ref){const d=await call("get",{path:ref.path});return snap(ref.path,d)}
export async function setDoc(ref,data,opts){return call("set",{writes:[{path:ref.path,data,merge:!!opts?.merge}]})}
export async function deleteDoc(ref){return call("set",{writes:[{path:ref.path,data:null}]})}
export async function getDocs(q){
  const rows=await call("list",{path:q.path,cons:q.cons||[]});
  const docs=rows.map(([p,d])=>snap(p,d));
  return {docs,size:docs.length,empty:!docs.length,forEach:f=>docs.forEach(f)};
}
export function writeBatch(){
  const writes=[];
  return {set(ref,data,opts){writes.push({path:ref.path,data,merge:!!opts?.merge})},delete(ref){writes.push({path:ref.path,data:null})},
    update(ref,data){writes.push({path:ref.path,data,merge:true})},commit:()=>call("set",{writes})};
}
