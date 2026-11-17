export function getAuth(){return {}}
export async function signInWithEmailAndPassword(){return {}}
export async function signOut(){}
export function onAuthStateChanged(a,cb){setTimeout(()=>cb(window.__noAuth?null:{uid:"u1",email:"t@t"}),0);return()=>{}}
