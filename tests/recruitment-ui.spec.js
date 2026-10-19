'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {runtime}=require('./helpers/game-runtime.cjs');
const {Game,Dynasty,context}=runtime();
function flatten(node){return Array.isArray(node)?node.flatMap(flatten):node&&typeof node==='object'?[node,...flatten(node.props?.children||[])]:[];}
function content(node){return Array.isArray(node)?node.map(content).join(''):node&&typeof node==='object'?content(node.props?.children||[]):node==null||typeof node==='boolean'?'':String(node);}
function control(tree,type,label){const found=flatten(tree).find(n=>n.type===type&&(n.props['aria-label']===label||content(n)===label));assert.ok(found,`${type} ${label} exists`);return found;}
function renderer(props){
 const values=[];let cursor=0;
 const React={Fragment:'fragment',createElement:(type,attributes,...children)=>({type,props:{...attributes,children}}),useState:initial=>{const key=cursor++;if(!(key in values))values[key]=initial;return[values[key],value=>{values[key]=typeof value==='function'?value(values[key]):value;}];}};
 const Component=context.TenkaUI.create(React).Council;
 props.onState=state=>{props.state=state;};
 return {render(){cursor=0;return Component(props);}};
}
function candidates(tree){return flatten(tree).filter(n=>n.type==='tr'&&n.props['data-candidate-id']);}

test('the recruitment comparison shows the complete pool with independent hire actions and abilities',()=>{
 const state=Game.newGame(),expected=Dynasty.getView(state).recruits,props={state},screen=renderer(props);
 control(screen.render(),'button','家臣').props.onClick();
 let tree=screen.render();const table=control(tree,'table','登用候補の一覧');
 assert.equal(candidates(table).length,expected.length);assert.ok(expected.length>=8);
 for(const person of expected){
  const row=candidates(table).find(n=>n.props['data-candidate-id']===person.id);
  assert.ok(row);assert.match(content(row),new RegExp(person.name));
  for(const stat of ['leadership','valor','intelligence','politics'])assert.ok(flatten(row).some(n=>n.type==='td'&&content(n)===String(person[stat])));
  assert.equal(control(row,'button',person.name+'を登用').props.disabled,false);
 }
 const picked=expected[5];control(table,'button',picked.name+'を登用').props.onClick();
 tree=screen.render();assert.equal(candidates(tree).length,expected.length-1);
 assert.equal(candidates(tree).some(n=>n.props['data-candidate-id']===picked.id),false);
 assert.equal(props.state.officers.find(o=>o.id===picked.id).status,'active');
 const remaining=candidates(tree).map(n=>n.props['data-candidate-id']);
 assert.deepEqual(remaining,Array.from(expected.filter(o=>o.id!==picked.id),o=>o.id));
});

test('recruitment buttons explain the monthly limit while leaving remaining candidates visible',()=>{
 const props={state:Game.newGame()},screen=renderer(props);
 control(screen.render(),'button','家臣').props.onClick();
 for(let i=0;i<2;i++){
  const tree=screen.render(),first=candidates(tree)[0];
  control(first,'button',Dynasty.getView(props.state).recruits[0].name+'を登用').props.onClick();
 }
 const tree=screen.render(),rows=candidates(tree);assert.ok(rows.length>=6);
 for(const row of rows){const button=flatten(row).find(n=>n.type==='button');assert.equal(button.props.disabled,true);assert.equal(content(button),'今月の登用は終了');}
 assert.match(content(tree),/今月あと 0 人/);
});

test('a selected castle controls recruitment and diplomacy budgets even if another castle is exhausted',()=>{
 const original=context.TenkaOrders;
 try{
  const state=Game.newGame(),home=state.castles.find(c=>c.clan===state.playerClan);
  state.castles.push({...home,id:'ui-second-castle',name:'第二城'});
  state.actionPoints=0;
  context.TenkaOrders={remaining:(_,id)=>id==='ui-second-castle'?3:0,total:()=>3};
  const props={state,selectedCastleId:home.id},screen=renderer(props);
  control(screen.render(),'button','家臣').props.onClick();
  let tree=screen.render();assert.equal(flatten(candidates(tree)[0]).find(n=>n.type==='button').props.disabled,true);
  control(tree,'select','命令を出す城').props.onChange({target:{value:'ui-second-castle'}});
  tree=screen.render();assert.match(content(tree),/第二城の今月の命令/);assert.equal(flatten(candidates(tree)[0]).find(n=>n.type==='button').props.disabled,false);
  control(tree,'button','外交').props.onClick();tree=screen.render();assert.ok(control(tree,'select','命令を出す城'));
  const action=flatten(tree).find(n=>n.type==='button'&&n.props.className==='tenka-action');assert.equal(action.props.disabled,false);
 }finally{context.TenkaOrders=original;}
});
