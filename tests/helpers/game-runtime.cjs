'use strict';
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'../..');
function runtime(){
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
 let script=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]).sort((a,b)=>b.length-a.length)[0];
 const marker=[...script.matchAll(/\(0,\s*zv\.createRoot\)/g)].at(-1);
 if(!marker)throw new Error('Application render marker missing');
 script=script.slice(0,marker.index)+'})();';
 const values=new Map();
 const localStorage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key),clear:()=>values.clear()};
 const context=vm.createContext({console,setTimeout,clearTimeout,performance,URL,localStorage});context.window=context;
 for(const name of ['tenka-portraits.js','tenka-systems.js','tenka-dynasty.js','tenka-tactics.js','tenka-ui.js'])vm.runInContext(fs.readFileSync(path.join(root,name),'utf8'),context,{filename:name});
 vm.runInContext(script,context,{filename:'index.inline.js'});
 return {Game:context.TenkaGame,Dynasty:context.TenkaDynasty,Systems:context.TenkaSystems,Tactics:context.TenkaTactics,context,values};
}
module.exports={runtime,clone:value=>JSON.parse(JSON.stringify(value))};
