'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const Systems=require('../tenka-systems.js');
function fixture(){
 const officer=(id,clan,castleId,extra={})=>({id,name:id,clan,castleId,status:'active',birth:1530,death:1600,leadership:80,valor:80,intelligence:80,politics:80,...extra});
 const castle=(id,clan)=>({id,name:id,clan,clanName:clan,province:'尾張',kokudaka:48000,population:52000,troops:1000,food:5000,gold:3000,defense:60,morale:80,terrain:'plain'});
 const state=Systems.initialize({year:1560,season:0,turn:1,playerClan:'oda',selectedCastleId:'a',actionPoints:3,gold:4000,food:10000,prestige:40,castles:[castle('a','oda'),castle('b','imagawa')],officers:[officer('delegate','oda','a'),officer('captive','imagawa',null,{status:'captive',capturedBy:'oda'}),officer('fallen','oda',null,{status:'dead'}),officer('enemy','imagawa','b')],armies:{a:{commanderId:'delegate',units:{ashigaru:1000,archer:0,cavalry:0,firearm:0,navy:0}},b:{commanderId:'enemy',units:{ashigaru:1000,archer:0,cavalry:0,firearm:0,navy:0}}},alliances:[],allianceExpires:{},relations:{imagawa:-30},npcPacts:[],logs:[],nextLogId:1,gameOver:false,lastBattle:{id:'siege-1',defender:'七尾城',year:1560,officerOutcomes:[{officerId:'delegate',name:'delegate',clan:'oda',side:'attacker',outcome:'survived'},{officerId:'fallen',name:'fallen',clan:'oda',side:'attacker',outcome:'killed'},{officerId:'captive',name:'captive',clan:'imagawa',side:'defender',outcome:'captured',capturedBy:'oda'},{officerId:'enemy',name:'enemy',clan:'imagawa',side:'defender',outcome:'retreated'}]}});
 return state;
}
function load(){const context={TenkaSystems:Systems};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../tenka-ui.js'),'utf8'),context);return context.TenkaUI;}
function renderer(UI,props){
 const values=[];let cursor=0;
 const React={Fragment:'fragment',createElement:(type,attributes,...children)=>({type,props:{...attributes,children}}),useState:initial=>{const key=cursor++;if(!(key in values))values[key]=initial;return[values[key],value=>{values[key]=typeof value==='function'?value(values[key]):value;}];}};
 const Component=UI.create(React).BattleAftermath;
 return {render(){cursor=0;return Component(props);}};
}
function flatten(node){return Array.isArray(node)?node.flatMap(flatten):node&&typeof node==='object'?[node,...flatten(node.props?.children||[])]:[];}
function content(node){return Array.isArray(node)?node.map(content).join(''):node&&typeof node==='object'?content(node.props?.children||[]):node==null?'':String(node);}
function button(tree,label){const found=flatten(tree).find(n=>n.type==='button'&&content(n)===label);assert.ok(found,'button '+label+' exists');return found;}

test('battle personnel report preserves original fates and shows decisions separately after reload',()=>{
 const UI=load(),state=fixture(),snapshot=JSON.stringify(state);
 let view=UI.battleAftermathView(state);
 assert.equal(view.counts.killed,1);assert.equal(view.counts.captured,1);assert.equal(view.counts.survived,2);
 assert.equal(view.rows.find(o=>o.officerId==='fallen').own,true);
 assert.equal(view.rows.find(o=>o.officerId==='captive').prisoner,true);
 assert.equal(JSON.stringify(state),snapshot,'view does not rewrite the historical report');
 state.officers[1].status='ronin';state.officers[1].capturedBy=null;
 state.tenka.prisonerDecisions=[{battleId:'siege-1',officerId:'captive',type:'release',outcome:'success',turn:1,message:'捕虜を解放しました。'}];
 view=UI.battleAftermathView(JSON.parse(JSON.stringify(state)));
 const prisoner=view.rows.find(o=>o.officerId==='captive');
 assert.equal(prisoner.outcome,'captured');assert.equal(prisoner.prisoner,false);assert.match(prisoner.current,/解放済み・浪人/);
 assert.equal(prisoner.decision.message,'捕虜を解放しました。');
});

test('postwar report directly allows release through collective magistrates when all officers are busy',()=>{
 const UI=load(),props={state:fixture()};props.state.tenka.assignments.delegate={turn:1,type:'reclaim'};
 props.onState=state=>{props.state=state;};
 const screen=renderer(UI,props);let tree=screen.render();
 assert.match(content(tree),/討死 1 人 ／ 捕虜 1 人/);
 assert.equal(button(tree,'召し抱える').props.disabled,true);
 assert.equal(button(tree,'処断する').props.disabled,true);
 const release=button(tree,'解放する');assert.equal(release.props.disabled,false);release.props.onClick();
 assert.equal(props.state.officers[1].status,'active');assert.equal(props.state.officers[1].castleId,'b');assert.equal(props.state.actionPoints,2);
 tree=screen.render();assert.match(content(tree),/現在：/);assert.equal(flatten(tree).filter(n=>n.type==='button'&&content(n)==='解放する').length,0);
 assert.equal(props.state.lastBattle.officerOutcomes[2].outcome,'captured','decision leaves battle fate intact');
});

test('execution requires a separate explicit confirmation and no orders explain the deferred treatment',()=>{
 const UI=load(),props={state:fixture()};props.onState=state=>{props.state=state;};
 const screen=renderer(UI,props);let tree=screen.render();
 button(tree,'処断する').props.onClick();assert.equal(props.state.officers[1].status,'captive');
 tree=screen.render();assert.match(content(tree),/友好・威信・家臣の忠誠が低下/);
 button(tree,'処断を確定する').props.onClick();assert.equal(props.state.officers[1].status,'dead');
 assert.equal(props.state.lastBattle.officerOutcomes[2].outcome,'captured');
 const exhausted={state:fixture(),onState:()=>{}};exhausted.state.actionPoints=0;
 const exhaustedTree=renderer(UI,exhausted).render();assert.equal(button(exhaustedTree,'解放する').props.disabled,true);assert.match(content(exhaustedTree),/次の月に処遇/);
});

test('legacy and unrecorded reports never claim a later natural death was a battle casualty',()=>{
 const UI=load(),state=fixture();delete state.lastBattle.officerOutcomes;
 const legacy=UI.battleAftermathView(state);assert.equal(legacy.legacy,true);assert.equal(legacy.rows.length,0);
 assert.match(content(renderer(UI,{state}).render()),/旧形式の記録/);
 state.lastBattle.officerOutcomes=[{officerId:'fallen',clan:'oda',outcome:'unrecorded'}];
 const current=UI.battleAftermathView(state);assert.equal(current.counts.killed,0);assert.equal(current.rows[0].label,'安否の記録なし');
});

test('victorious unification retains postwar treatment while a defeated campaign does not',()=>{
 const UI=load(),victory={state:fixture()};victory.state.gameOver=true;victory.state.winner='oda';victory.state.actionPoints=0;victory.state.tenka.assignments.delegate={turn:1,type:'reclaim'};victory.onState=state=>{victory.state=state;};
 const screen=renderer(UI,victory),tree=screen.render();
 assert.match(content(tree),/天下統一後の処遇は命令を消費しません/);
 const release=button(tree,'解放する');assert.equal(release.props.disabled,false);release.props.onClick();assert.equal(victory.state.officers[1].status,'active');assert.equal(victory.state.actionPoints,0);
 const noAdult={state:fixture()};noAdult.state.gameOver=true;noAdult.state.winner='oda';noAdult.state.actionPoints=0;noAdult.state.officers[0].status='dead';noAdult.onState=state=>{noAdult.state=state;};
 const fallbackTree=renderer(UI,noAdult).render();assert.equal(button(fallbackTree,'召し抱える').props.disabled,true);assert.equal(button(fallbackTree,'解放する').props.disabled,false);button(fallbackTree,'解放する').props.onClick();assert.equal(noAdult.state.officers[1].status,'active');assert.equal(noAdult.state.actionPoints,0);
 const defeat={state:fixture(),onState:()=>{}};defeat.state.gameOver=true;defeat.state.winner='imagawa';
 const defeatedTree=renderer(UI,defeat).render();assert.equal(button(defeatedTree,'解放する').props.disabled,true);assert.match(content(defeatedTree),/年代記は決着/);
});
