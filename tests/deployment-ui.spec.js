'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {runtime}=require('./helpers/game-runtime.cjs');
const {Game,Tactics,context}=runtime();
function flatten(node){return Array.isArray(node)?node.flatMap(flatten):node&&typeof node==='object'?[node,...flatten(node.props?.children||[])]:[];}
function content(node){return Array.isArray(node)?node.map(content).join(''):node&&typeof node==='object'?content(node.props?.children||[]):node==null?'':String(node);}
function control(tree,type,label){const node=flatten(tree).find(n=>n.type===type&&(n.props['aria-label']===label||content(n)===label));assert.ok(node,`${type} ${label} exists`);return node;}
function renderer(props){
 const values=[];let cursor=0;
 const React={Fragment:'fragment',createElement:(type,attributes,...children)=>({type,props:{...attributes,children}}),useState:initial=>{const key=cursor++;if(!(key in values))values[key]=initial;return[values[key],value=>{values[key]=typeof value==='function'?value(values[key]):value;}];}};
 const Component=context.TenkaUI.create(React).Tactics;
 props.onBattle=battle=>{props.battle=battle;};
 props.onDeploymentToolChange=tool=>{props.deploymentTool=tool;props.selectedStructureId=null;};
 props.onSelectedStructureChange=id=>{props.selectedStructureId=id;};
 props.onSelectedUnitChange=id=>{props.selectedUnitId=id;};
 props.onPlacementRotationChange=angle=>{props.placementRotation=angle;};
 return {render(){cursor=0;return Component(props);}};
}
function field(mode='field'){
 const state=Game.newGame();return Game.createBattle({state,sourceId:'kiyosu',targetId:'inabayama',mode});
}
function defense(){
 const state=Game.newGame();state.pendingDefense={sourceId:'inabayama',targetId:'kiyosu',mode:'siege',clan:state.castles.find(c=>c.id==='inabayama').clan};return Tactics.createDefense(state);
}
function freeSpot(battle,kind='camp',rotation=0,avoid){
 const zone=Tactics.deploymentZone(battle);
 for(let z=Math.ceil(zone.zMin+4);z<zone.zMax-4;z+=4)for(let x=Math.ceil(zone.xMin+5);x<zone.xMax-5;x+=4){
  if(avoid&&Math.hypot(x-avoid.x,z-avoid.z)<12)continue;
  const response=Tactics.placeFortification(battle,{kind,x,z,rotation});if(response.ok)return {x,z};
 }
 throw new Error('No valid fieldwork placement');
}
function coordinates(screen,x,z){
 let tree=screen.render();control(tree,'input','陣・柵の東西座標').props.onChange({target:{value:String(x)}});
 tree=screen.render();control(tree,'input','陣・柵の南北座標').props.onChange({target:{value:String(z)}});
 tree=screen.render();flatten(tree).find(n=>n.type==='form').props.onSubmit({preventDefault(){}});
}

test('all three battle modes expose placement tools before any troop is selected',()=>{
 for(const battle of [field(),field('siege'),defense()]){
  const props={battle,selectedUnitId:null,deploymentTool:'unit'},screen=renderer(props);let tree=screen.render();
  assert.match(content(tree),/配置を終えたら「戦闘開始」/);
  for(const label of ['部隊','本陣','木柵'])assert.equal(control(tree,'button',label).props.disabled,undefined);
  control(tree,'button','木柵').props.onClick();tree=screen.render();
  assert.equal(control(tree,'button','木柵').props['aria-pressed'],true);
  assert.match(content(tree),/配置範囲.*東西/);
  assert.ok(control(tree,'input','陣・柵の東西座標'));
  assert.ok(control(tree,'select','陣・柵の向き'));
  assert.match(content(tree),/敵の進路を阻み/);
 }
});

test('coordinate controls place, rotate, move and remove actual fieldworks in all battle modes',()=>{
 for(const battle of [field(),field('siege'),defense()]){
  const props={battle,deploymentTool:'camp',placementRotation:45},screen=renderer(props),spot=freeSpot(battle,'camp',45);
  coordinates(screen,spot.x,spot.z);
  assert.equal(props.battle.fortifications.length,1);
  let work=props.battle.fortifications[0];assert.equal(work.rotation,45);assert.equal(props.selectedStructureId,work.id);
  let tree=screen.render();assert.match(content(tree),/本陣 1 \/ 2/);assert.ok(control(tree,'button','この座標へ移設'));
  // A failed rotation keeps the original work; a successful one immediately applies the angle.
  const angle=[0,90,180,270].find(rotation=>Tactics.moveFortification(props.battle,{id:work.id,x:work.x,z:work.z,rotation}).ok);
  control(tree,'select','陣・柵の向き').props.onChange({target:{value:String(angle)}});assert.equal(props.battle.fortifications[0].rotation,angle);
  const moved=freeSpot(props.battle,'camp',angle,work);coordinates(screen,moved.x,moved.z);
  work=props.battle.fortifications[0];assert.equal(work.x,moved.x);assert.equal(work.z,moved.z);assert.equal(work.side,props.battle.playerSide||'attacker');
  tree=screen.render();control(tree,'button','撤去する').props.onClick();assert.equal(props.battle.fortifications.length,0);assert.equal(props.selectedStructureId,null);
  assert.match(content(screen.render()),/本陣 0 \/ 2/);
 }
});

test('invalid and missing coordinates explain the failure without changing the battle',()=>{
 const props={battle:field(),deploymentTool:'palisade'},screen=renderer(props),snapshot=JSON.stringify(props.battle);
 coordinates(screen,'',20);assert.match(content(screen.render()),/座標を両方入力/);assert.equal(JSON.stringify(props.battle),snapshot);
 coordinates(screen,999,20);assert.match(content(screen.render()),/配置範囲/);assert.equal(JSON.stringify(props.battle),snapshot);
});

test('selecting an existing work survives the parent tool change and exposes its edit controls',()=>{
 let battle=field();
 for(const kind of ['camp','palisade']){
  const spot=freeSpot(battle,kind);battle=Tactics.placeFortification(battle,{kind,...spot}).battle;
 }
 const props={battle,deploymentTool:'camp'},screen=renderer(props);
 for(const work of battle.fortifications){
  control(screen.render(),'select','編集する陣・柵').props.onChange({target:{value:work.id}});
  assert.equal(props.selectedStructureId,work.id);
  assert.equal(props.deploymentTool,work.kind);
  const tree=screen.render();assert.equal(control(tree,'select','編集する陣・柵').props.value,work.id);
  assert.equal(control(tree,'input','陣・柵の東西座標').props.value,String(work.x));
  assert.ok(control(tree,'button','この座標へ移設'));assert.ok(control(tree,'button','撤去する'));
 }
});

test('a selected existing castle gate never exposes fieldwork removal and exhausted budgets disable construction',()=>{
 let battle=field('siege');const ownGate=battle.structures.find(s=>(s.kind||s.type)==='gate');
 const props={battle,deploymentTool:'camp',selectedStructureId:ownGate.id},screen=renderer(props);
 let tree=screen.render();assert.equal(flatten(tree).some(n=>n.type==='button'&&content(n)==='撤去する'),false);
 for(let i=0;i<2;i++){const spot=freeSpot(props.battle);props.battle=Tactics.placeFortification(props.battle,{kind:'camp',...spot}).battle;}
 tree=screen.render();assert.equal(control(tree,'button','この座標に設置').props.disabled,true);assert.match(content(tree),/本陣 2 \/ 2/);
});

test('switching placement tools clears structure editing and combat leaves only the unit doctrine',()=>{
 const battle=field(),unit=battle.units.find(u=>u.side==='attacker');
 const props={battle,selectedUnitId:unit.id,deploymentTool:'camp',selectedStructureId:'old'},screen=renderer(props);
 let tree=screen.render();control(tree,'button','部隊').props.onClick();assert.equal(props.selectedStructureId,null);assert.equal(props.deploymentTool,'unit');
 tree=screen.render();control(tree,'select','部隊の陣形').props.onChange({target:{value:'wedge'}});assert.equal(props.battle.units.find(u=>u.id===unit.id).formation,'wedge');
 props.battle=Game.startBattle(props.battle);tree=screen.render();
 assert.equal(flatten(tree).some(n=>n.type==='button'&&content(n)==='本陣'),false);assert.ok(control(tree,'select','部隊の陣形'));assert.equal(control(tree,'button','伏兵を配置').props.disabled,true);
});

function unitCoordinates(screen,x,z){
 let tree=screen.render();control(tree,'input','部隊の東西座標').props.onChange({target:{value:String(x)}});
 tree=screen.render();control(tree,'input','部隊の南北座標').props.onChange({target:{value:String(z)}});
 tree=screen.render();flatten(tree).find(n=>n.type==='form'&&n.props.className==='tenka-unit-coordinates').props.onSubmit({preventDefault(){}});
}
function unitSpot(battle,id){
 const zone=Tactics.deploymentZone(battle),current=battle.units.find(u=>u.id===id);
 for(let z=Math.ceil(zone.zMin+3);z<zone.zMax-3;z+=3)for(let x=Math.ceil(zone.xMin+3);x<zone.xMax-3;x+=3){
  if(Math.hypot(x-current.x,z-current.z)<15)continue;
  if(Tactics.deploy(battle,{unitId:id,x,z}).ok)return {x,z};
 }
 throw new Error('No available unit position');
}

test('the player selects and confirms troop positions from the toolbar in all three modes',()=>{
 for(const battle of [field(),field('siege'),defense()]){
  const side=battle.playerSide||'attacker',own=battle.units.filter(u=>u.side===side&&u.troops>0),chosen=own[1]||own[0];
  const props={battle,selectedUnitId:own[0].id,deploymentTool:'unit'},screen=renderer(props);
  let tree=screen.render();assert.match(content(tree),/プレイヤーの布陣/);assert.match(content(tree),/現在の配置は初期案/);
  const picker=control(tree,'select','配置する部隊'),options=flatten(picker).filter(n=>n.type==='option'&&n.props.value);
  assert.equal(options.length,own.length);assert.ok(options.every(n=>content(n).includes('仮配置・未確認')));
  assert.ok(options.every(n=>own.some(u=>u.id===n.props.value)),'enemy units never appear in the own-force picker');
  picker.props.onChange({target:{value:chosen.id}});assert.equal(props.selectedUnitId,chosen.id);
  tree=screen.render();assert.equal(control(tree,'input','部隊の東西座標').props.value,String(Math.round(chosen.x*10)/10));
  const destination=unitSpot(props.battle,chosen.id);unitCoordinates(screen,destination.x,destination.z);
  const deployed=props.battle.units.find(u=>u.id===chosen.id);assert.equal(deployed.x,destination.x);assert.equal(deployed.z,destination.z);assert.equal(deployed.commanderId,chosen.commanderId);assert.equal(deployed.troops,chosen.troops);
  tree=screen.render();assert.match(content(tree),new RegExp('配置確認 1 / '+own.length+' 部隊'));
  assert.match(content(flatten(tree).find(n=>n.type==='option'&&n.props.value===chosen.id)),/配置確認済/);
  const restored=renderer({...props,battle:JSON.parse(JSON.stringify(props.battle))});assert.match(content(restored.render()),/配置確認 1 \/ /,'confirmation follows the existing deployment ledger');
 }
});

test('troop coordinate UI rejects enemy ground, out-of-bounds and waterways without marking a unit confirmed',()=>{
 for(const battle of [field(),field('siege'),defense()]){
  const side=battle.playerSide||'attacker',unit=battle.units.find(u=>u.side===side&&u.troops>0),zone=Tactics.deploymentZone(battle);
  // A representative river within the home deployment area also checks the form
  // against production water rules when the selected castle has no natural river.
  const water={x:zone.xMin+5,z:zone.zMax-5};
  battle.layout.water.push({type:'river',polygon:[[water.x-1,water.z-1],[water.x+1,water.z-1],[water.x+1,water.z+1],[water.x-1,water.z+1]]});
  const props={battle,selectedUnitId:unit.id,deploymentTool:'unit'},screen=renderer(props),snapshot=JSON.stringify(battle);
  for(const invalid of [{x:zone.xMax+4,z:unit.z},{x:unit.x,z:side==='attacker'?zone.zMin-8:zone.zMax+8},water]){
   unitCoordinates(screen,invalid.x,invalid.z);assert.equal(JSON.stringify(props.battle),snapshot,'a rejected coordinate cannot change the battle');
   assert.match(content(screen.render()),/配置|避け/);assert.match(content(screen.render()),/配置確認 0 \/ /);
  }
  unitCoordinates(screen,'',unit.z);assert.match(content(screen.render()),/部隊を置く東西・南北の座標を両方入力/);assert.equal(JSON.stringify(props.battle),snapshot);
 }
});

test('terrain guide exposes real feature names and coordinates, and a map move refreshes the selected troop form',()=>{
 const battle=field(),unit=battle.units.find(u=>u.side==='attacker'),props={battle,selectedUnitId:unit.id,deploymentTool:'unit'},screen=renderer(props);
 let tree=screen.render();assert.match(content(tree),/戦場の地形と陣取り/);
 for(const feature of battle.terrainFeatures){assert.ok(content(tree).includes(feature.name));assert.ok(content(tree).includes('東西 '+Math.round(feature.x)+'・南北 '+Math.round(feature.z)));}
 control(tree,'input','部隊の東西座標').props.onChange({target:{value:'22'}});
 const destination=unitSpot(battle,unit.id);props.battle=Tactics.deploy(battle,{unitId:unit.id,...destination}).battle;
 tree=screen.render();assert.equal(control(tree,'input','部隊の東西座標').props.value,String(destination.x));assert.equal(control(tree,'input','部隊の南北座標').props.value,String(destination.z));
 props.battle=Game.startBattle(props.battle);tree=screen.render();assert.equal(flatten(tree).some(n=>n.type==='input'&&n.props['aria-label']==='部隊の東西座標'),false);assert.equal(flatten(tree).some(n=>n.type==='select'&&n.props['aria-label']==='配置する部隊'),false);
});
