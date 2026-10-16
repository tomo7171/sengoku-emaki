'use strict';
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'../..');
function runtime(options={}){
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
 let script=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]).sort((a,b)=>b.length-a.length)[0];
 const marker=[...script.matchAll(/\(0,\s*zv\.createRoot\)/g)].at(-1);
 if(!marker)throw new Error('Application render marker missing');
 const exposeThree=options.three?'K_();window.__ThreeForTests={Group:zl,Mesh:Od,BoxGeometry:cf,BufferGeometry:Bu,Float32BufferAttribute:Ou,CylinderGeometry:df,Vector3:J,InstancedMesh:Rd,Object3D:Rl,SphereGeometry:zf,MeshStandardMaterial:qf,Color:Y,Raycaster:qp};':'';
 script=script.slice(0,marker.index)+exposeThree+'})();';
 const values=new Map();
 const localStorage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key),clear:()=>values.clear()};
 const context=vm.createContext({console,setTimeout,clearTimeout,performance,URL,localStorage});context.window=context;
 for(const name of ['tenka-portraits.js','tenka-castles.js','tenka-fortress-materials.js','tenka-castle-models.js','tenka-castle-precincts.js','tenka-battlefield.js','tenka-battle-environment.js','tenka-systems.js','tenka-dynasty.js','tenka-tactics.js','tenka-orders.js','tenka-ui.js'])vm.runInContext(fs.readFileSync(path.join(root,name),'utf8'),context,{filename:name});
 vm.runInContext(script,context,{filename:'index.inline.js'});
 return {Game:context.TenkaGame,Dynasty:context.TenkaDynasty,Systems:context.TenkaSystems,Tactics:context.TenkaTactics,Three:context.__ThreeForTests,context,values};
}
module.exports={runtime,clone:value=>JSON.parse(JSON.stringify(value))};
