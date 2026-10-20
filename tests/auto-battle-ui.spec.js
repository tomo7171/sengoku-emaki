'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../tenka-turn-ui.js'),'utf8');
const clone=value=>JSON.parse(JSON.stringify(value));
function flatten(node){return Array.isArray(node)?node.flatMap(flatten):node&&typeof node==='object'?[node,...flatten(node.props?.children||[])]:[];}
function content(node){return Array.isArray(node)?node.map(content).join(''):node&&typeof node==='object'?content(node.props?.children||[]):node==null||typeof node==='boolean'?'':String(node);}
function battle(mode='field',defending=false){
  const own=defending?'defender':'attacker',enemy=defending?'attacker':'defender';
  return {id:'ui-'+mode+'-'+own,controlMode:'turns',phase:'deployment',mode,playerSide:own,turnNumber:1,time:0,ledger:[],food:700,layout:{bounds:{minX:-120,maxX:120,minZ:-160,maxZ:160}},captureZone:{x:0,z:-40},structures:mode==='siege'?[{id:'castle-gate',name:'大手門',x:0,z:-10,hp:500}]:[],units:[
    {id:'own-a',side:own,type:'ashigaru',commanderName:'織田信長',x:0,z:80,troops:1000,status:'ready'},
    {id:'own-b',side:own,type:'archer',commanderName:'丹羽長秀',x:20,z:80,troops:500,status:'ready'},
    {id:'enemy-a',side:enemy,type:'cavalry',commanderName:'武田信玄',x:0,z:-80,troops:1800,status:'ready'}]};
}
function harness(input=battle(),options={}){
  const hooks=[],effects=[],timers=new Map(),calls=[],results=[];let cursor=0,dirty=false,tree,serial=0,controller=null,unmounted=false;
  const props={battle:input,selectedUnitId:'own-a',pauseToken:0,suspended:false,onSelectedUnitChange:id=>{props.selectedUnitId=id;},onController:value=>{controller=value;},onResult:value=>{results.push(value);if(options.ack!==false)props.battle=value.battle;}};
  const React={createElement:(type,attrs,...children)=>({type,props:{...attrs,children}}),useState(initial){const index=cursor++;if(!(index in hooks))hooks[index]=typeof initial==='function'?initial():initial;return[hooks[index],value=>{const next=typeof value==='function'?value(hooks[index]):value;if(!Object.is(next,hooks[index])){hooks[index]=next;dirty=true;}}];},useRef(initial){const index=cursor++;if(!(index in hooks))hooks[index]={current:initial};return hooks[index];},useEffect(callback,deps){const index=cursor++,old=hooks[index];if(!old||!deps||deps.some((value,i)=>!Object.is(value,old.deps?.[i]))){hooks[index]={deps,cleanup:old?.cleanup};effects.push(()=>{old?.cleanup?.();hooks[index].cleanup=callback();});}}};
  const tactics={turnView(value,id){const units=value.units.filter(u=>u.side===value.playerSide&&u.troops>0).map(u=>({...u,movement:12,range:8,attack:1,defense:1,action:u.turnPlan?.action||'wait'}));return {number:value.turnNumber,units,selected:units.find(u=>u.id===id)};},order(value,command){calls.push({kind:'manual-order',value,command});return {ok:true,battle:{...clone(value),ledger:[...value.ledger,{kind:'turn-order',command}]},message:'手動命令'};},endTurn(value){calls.push({kind:'manual-end',value});return {ok:true,battle:{...clone(value),turnNumber:value.turnNumber+1},message:'手動ターン完了'};}};
  const scope={TenkaTactics:tactics,setTimeout:(callback,delay)=>{timers.set(++serial,{callback,delay});return serial;},clearTimeout:id=>timers.delete(id)};scope.window=scope;
  scope.TenkaAutoBattle={advance(value,orders){calls.push({kind:'auto',value,orders:clone(orders)});if(options.advance)return options.advance(value,orders);const next=clone(value);next.time+=3;next.food-=5;next.turnNumber++;next.ledger.push({kind:'turn-end'});return {ok:true,battle:next,orders:clone(orders),message:'自動ターン完了',notices:[]};}};
  vm.runInNewContext(source,scope);const Component=scope.TenkaTurnUI.create(React).TurnOrders;
  function render(){assert.equal(unmounted,false);let attempts=0;do{dirty=false;cursor=0;tree=Component(props);while(effects.length)effects.shift()();assert.ok(++attempts<30,'hooks settle');}while(dirty);return tree;}
  function control(type,label){const node=flatten(render()).find(n=>n.type===type&&(n.props['aria-label']===label||content(n)===label));assert.ok(node,`${type}: ${label}`);return node;}
  return {props,calls,results,timers,render,control,get controller(){return controller;},text:()=>content(render()),click:label=>control('button',label).props.onClick(),change:(type,label,value)=>control(type,label).props.onChange({target:{value,checked:value}}),flush(){const pending=[...timers.values()];timers.clear();for(const item of pending)item.callback();render();},unmount(){for(const hook of hooks)hook?.cleanup?.();unmounted=true;},pending:()=>[...timers.values()]};
}
function fighting(options={}){const value=battle();value.phase='fighting';return harness(value,options);}
function start(screen){screen.click('自動命令');screen.click('自動進行を開始');screen.render();}
function threeTargetBattle(mode='field',defending=false){const value=battle(mode,defending),side=value.units[2].side;value.units.push({id:'enemy-b',side,type:'archer',commanderName:'山県昌景',x:20,z:-70,troops:900,status:'ready'},{id:'enemy-c',side,type:'firearm',commanderName:'馬場信春',x:-20,z:-60,troops:700,status:'ready'});return value;}
function setSequence(screen,after=['next','next','wait']){for(let i=0;i<3;i++){screen.change('select',['第一目標','第二目標','第三目標'][i],['enemy-a','enemy-b','enemy-c'][i]);screen.change('select',['第一目標の撃破後','第二目標の撃破後','第三目標の撃破後'][i],after[i]);}screen.click('目標の順序を設定');screen.render();}
function progress(screen){return flatten(screen.render()).find(node=>node.props?.['data-testid']==='target-sequence-progress');}

test('deployment presets cover field, siege and defense without changing troops or starting combat',()=>{
  for(const [mode,defense]of[['field',false],['siege',false],['siege',true]]){
    const input=battle(mode,defense),before=JSON.stringify(input),screen=harness(input);screen.render();
    assert.equal(screen.control('input','開戦後に自動進行').props.checked,false);assert.equal(screen.timers.size,0);
    const roster=flatten(screen.render()).filter(n=>n.type==='button'&&n.props['data-unit-id']);assert.equal(roster.length,2);assert.ok(roster.every(row=>row.props['data-unit-id'].startsWith('own-')));
    const goals=flatten(screen.control('select','自動進行の攻撃目標')).filter(n=>n.type==='option');assert.ok(goals.some(n=>n.props.value==='enemy-a'));assert.equal(goals.some(n=>n.props.value==='capture'),mode==='siege'&&!defense);
    screen.change('select','自動進行の攻撃目標','enemy-a');screen.click('この目標へ攻撃を継続');
    assert.match(screen.text(),/自動：攻撃：武田信玄/);screen.props.selectedUnitId='own-b';screen.click('この部隊を防御');assert.match(screen.text(),/自動：防御/);
    assert.equal(JSON.stringify(input),before);assert.equal(screen.calls.length,0);assert.equal(screen.timers.size,0);
  }
});

test('the opt-in checkbox starts only after the parent actually accepts the guarded opening',()=>{
  const screen=harness();screen.change('input','開戦後に自動進行',true);screen.render();assert.equal(screen.timers.size,0);
  screen.props.battle={...screen.props.battle,deploymentError:'武将と配置の確認が必要です。'};screen.render();assert.equal(screen.timers.size,0);assert.equal(screen.calls.length,0);
  screen.props.battle={...screen.props.battle,phase:'fighting'};screen.render();assert.equal(screen.timers.size,1);assert.match(screen.text(),/自動進行中/);screen.flush();assert.equal(screen.calls.filter(c=>c.kind==='auto').length,1);
  const manual=fighting();manual.render();assert.equal(manual.timers.size,0);assert.ok(manual.control('button','このターンを実行'));
});

test('switching from manual plans inherits their targets and movement while preserving explicit standing waits',()=>{
  const value=battle();value.phase='fighting';value.units[0].turnPlan={action:'attack',targetId:'enemy-a',move:{x:0,z:20}};value.units[1].turnPlan={action:'wait',targetId:null,move:{x:30,z:40}};
  const screen=harness(value);screen.click('自動命令');assert.match(screen.text(),/自動：攻撃：武田信玄/);assert.match(screen.text(),/自動：移動 → 30.0,40.0/);
  screen.click('この部隊を待機');screen.click('手動ターン');screen.click('自動命令');screen.click('自動進行を開始');screen.render();screen.flush();assert.deepEqual(screen.calls[0].orders,{'own-a':{action:'wait'},'own-b':{action:'move',x:30,z:40}});
  const optout=harness();optout.change('input','開戦後に自動進行',true);optout.change('input','開戦後に自動進行',false);optout.props.battle={...optout.props.battle,phase:'fighting'};optout.render();assert.equal(optout.timers.size,0);assert.ok(optout.control('button','このターンを実行'));assert.equal(optout.controller.enabled,false);
});

test('a selected wait order leaves other standing orders intact and edits apply to the next scheduled turn',()=>{
  const screen=fighting();start(screen);
  screen.change('select','自動進行の攻撃目標','enemy-a');screen.click('この目標へ攻撃を継続');
  screen.props.selectedUnitId='own-b';screen.click('この部隊を防御');screen.props.selectedUnitId='own-a';screen.click('この部隊を待機');screen.render();screen.flush();
  const call=screen.calls.find(c=>c.kind==='auto');assert.deepEqual(call.orders,{'own-a':{action:'wait'},'own-b':{action:'defend'}});assert.equal(screen.props.battle.turnNumber,2);assert.equal(screen.props.battle.food,695);assert.equal(screen.timers.size,1);
  screen.props.selectedUnitId='own-a';screen.change('input','自動進行の移動先の東西','40');screen.change('input','自動進行の移動先の南北','20');screen.click('この地点へ移動を継続');screen.flush();assert.deepEqual(screen.calls.at(-1).orders['own-a'],{action:'move',x:40,z:20});
});

test('pause, speed changes, close requests and dialogs cancel timers without resuming on their own',()=>{
  const screen=fighting();start(screen);assert.equal(screen.pending()[0].delay,1200);
  screen.change('select','自動進行の速度','4');screen.render();assert.equal(screen.timers.size,1);assert.equal(screen.pending()[0].delay,300);
  const expired=screen.pending()[0].callback;screen.click('自動進行を一時停止');screen.render();assert.equal(screen.timers.size,0);expired();assert.equal(screen.calls.length,0);
  screen.click('自動進行を開始');screen.render();screen.props.pauseToken++;screen.render();assert.equal(screen.timers.size,0);assert.match(screen.text(),/自動進行は停止中/);
  screen.click('自動進行を開始');screen.render();screen.props.suspended=true;screen.render();assert.equal(screen.timers.size,0);screen.props.suspended=false;screen.render();assert.equal(screen.timers.size,0);
  screen.click('自動進行を開始');screen.render();screen.click('手動ターン');screen.render();assert.equal(screen.timers.size,0);assert.equal(screen.controller.enabled,false);assert.ok(screen.control('button','このターンを実行'));
});

test('auto turns wait for parent acknowledgement and stale callbacks never duplicate an advance',()=>{
  const screen=fighting({ack:false});start(screen);const old=screen.pending()[0].callback;screen.flush();assert.equal(screen.calls.length,1);assert.equal(screen.timers.size,0);
  old();assert.equal(screen.calls.length,1);
  screen.change('select','自動進行の速度','2');screen.render();screen.flush();assert.equal(screen.calls.length,1,'local status or speed changes cannot replay an unacknowledged turn');
  screen.props.battle=screen.results[0].battle;screen.render();screen.flush();assert.equal(screen.calls.length,2);
});

test('canvas and doctrine controllers update continuous orders and are disabled in manual mode',()=>{
  const screen=fighting();screen.render();assert.equal(screen.controller.enabled,false);start(screen);assert.equal(screen.controller.enabled,true);
  assert.equal(screen.controller.order('attack',{targetId:'enemy-a'},'own-a'),true);assert.equal(screen.controller.order('move',{x:40,z:-20},'own-b'),true);screen.render();
  screen.controller.doctrine('own-a','rest');screen.controller.doctrine('own-b','brace');screen.render();screen.flush();assert.deepEqual(screen.calls[0].orders,{'own-a':{action:'wait'},'own-b':{action:'defend'}});
  screen.controller.pause();screen.render();assert.equal(screen.timers.size,0);assert.equal(screen.controller.enabled,true);assert.match(screen.text(),/継続命令として設定/);
});

test('destroyed targets and completed movement display the engine notice and the new waiting order',()=>{
  const screen=fighting({advance:(value,orders)=>({ok:true,battle:{...clone(value),turnNumber:2},orders:{...orders,'own-a':{action:'wait'}},message:'第2ターン',notices:[{unitId:'own-a',message:'目標を撃破したため待機します。'}]})});
  start(screen);screen.change('select','自動進行の攻撃目標','enemy-a');screen.click('この目標へ攻撃を継続');screen.render();screen.flush();assert.match(screen.text(),/目標を撃破したため待機/);assert.equal(flatten(screen.render()).find(n=>n.props['data-unit-id']==='own-a').props['data-auto-action'],'wait');
});

test('rejection or thrown execution errors stop automatic progress and preserve the battle',()=>{
  for(const advance of [()=>({ok:false,message:'進路を確認してください。'}),()=>{throw new Error('試験用の実行エラー');}]){
    const screen=fighting({advance}),before=JSON.stringify(screen.props.battle);start(screen);screen.flush();assert.equal(screen.timers.size,0);assert.equal(screen.results.length,0);assert.equal(JSON.stringify(screen.props.battle),before);assert.match(screen.text(),/確認|試験用の実行エラー/);assert.match(screen.text(),/自動進行は停止中/);
  }
});

test('a finished turn reports its actual result exactly once and unmount cancels pending work',()=>{
  const screen=fighting({advance:(value,orders)=>({ok:true,battle:{...clone(value),phase:'finished',winner:'attacker'},orders,message:'決着'})});start(screen);screen.flush();assert.equal(screen.results.length,1);assert.equal(screen.results[0].battle.winner,'attacker');assert.equal(screen.timers.size,0);assert.equal(screen.render(),null);
  const abandoned=fighting();start(abandoned);const callback=abandoned.pending()[0].callback;abandoned.unmount();assert.equal(abandoned.timers.size,0);callback();assert.equal(abandoned.calls.length,0);assert.equal(abandoned.controller,null);
});

test('manual execution keeps the original explicit one-turn flow and rejects simultaneous presses',async()=>{
  const screen=fighting();screen.click('防御を計画');assert.equal(screen.calls[0].kind,'manual-order');screen.render();const button=screen.control('button','このターンを実行'),first=button.props.onClick();button.props.onClick();assert.equal(screen.timers.size,1);screen.flush();await first;screen.render();assert.equal(screen.calls.filter(c=>c.kind==='manual-end').length,1);assert.equal(screen.timers.size,0);assert.ok(screen.control('button','このターンを実行'));
});

test('three optional goals are prepared per unit in field, siege and defense without starting or altering a battle',()=>{
  for(const [mode,defense]of[['field',false],['siege',false],['siege',true]]){
    const input=threeTargetBattle(mode,defense),before=JSON.stringify(input),screen=harness(input);setSequence(screen,['next','wait','defend']);
    const state=progress(screen);assert.equal(state.props['data-sequence-index'],0);assert.equal(state.props['data-sequence-paused'],'false');
    const rows=flatten(state).filter(node=>node.props?.['data-sequence-goal']!==undefined);assert.equal(rows.length,3);assert.deepEqual(rows.map(node=>node.props['data-goal-status']),['current','remaining','remaining']);
    assert.match(content(state),/第一目標：武田信玄/);assert.match(content(state),/第二目標：山県昌景/);assert.match(content(state),/第三目標：馬場信春/);assert.match(content(state),/撃破後：防御/);
    assert.equal(screen.timers.size,0);assert.equal(screen.calls.length,0);assert.equal(JSON.stringify(input),before);
    screen.change('input','開戦後に自動進行',true);screen.props.battle={...screen.props.battle,phase:'fighting'};screen.render();screen.flush();
    assert.deepEqual(screen.calls[0].orders['own-a'],{action:'attack',targetId:'enemy-a',sequence:[{targetId:'enemy-a',after:'next'},{targetId:'enemy-b',after:'wait'},{targetId:'enemy-c',after:'defend'}],sequenceIndex:0,sequencePaused:false});
    assert.equal(screen.calls[0].orders['own-b'],undefined,'another unit receives no implicit targets');
  }
});

test('a missing first, gapped third, duplicate or unknown goal never installs a partial sequence',()=>{
  const input=threeTargetBattle();input.phase='fighting';const screen=harness(input);screen.click('自動命令');
  screen.change('select','自動進行の攻撃目標','enemy-a');screen.click('この目標へ攻撃を継続');
  screen.click('目標の順序を設定');assert.match(screen.text(),/第一目標を選んで/);assert.equal(progress(screen),undefined);
  screen.change('select','第一目標','enemy-a');screen.change('select','第三目標','enemy-c');screen.click('目標の順序を設定');assert.match(screen.text(),/第二目標を選んで/);assert.equal(progress(screen),undefined);
  screen.change('select','第二目標','enemy-a');screen.click('目標の順序を設定');assert.match(screen.text(),/同じ攻撃目標は重ねず/);assert.equal(progress(screen),undefined);
  screen.change('select','第二目標','enemy-b');screen.change('select','第三目標','not-a-target');screen.click('目標の順序を設定');assert.match(screen.text(),/選び直して/);assert.equal(progress(screen),undefined);
  assert.equal(screen.timers.size,0);screen.click('自動進行を開始');screen.render();screen.flush();assert.deepEqual(screen.calls[0].orders['own-a'],{action:'attack',targetId:'enemy-a'});
});

test('a completed first target retains its name and next target advances only after an explicit unit resume',()=>{
  const input=threeTargetBattle();input.phase='fighting';let passes=0;
  const screen=harness(input,{advance(value,orders){const next=clone(value);next.turnNumber++;next.time+=8;passes++;const command=clone(orders['own-a']);if(passes===1){next.units.find(unit=>unit.id==='enemy-a').troops=0;next.units.find(unit=>unit.id==='enemy-a').status='destroyed';command.action='defend';delete command.targetId;command.sequenceIndex=1;command.sequencePaused=true;}return {ok:true,battle:next,orders:{...clone(orders),'own-a':command},message:'命令実行',notices:[]};}});
  screen.click('自動命令');setSequence(screen,['defend','next','wait']);screen.props.selectedUnitId='own-b';screen.click('この部隊を待機');screen.props.selectedUnitId='own-a';screen.click('自動進行を開始');screen.render();screen.flush();
  let state=progress(screen);assert.equal(state.props['data-sequence-index'],1);assert.equal(state.props['data-sequence-paused'],'true');assert.match(content(state),/第一目標：武田信玄達成済み/);assert.match(content(state),/第二目標：山県昌景次の目標（防御中）/);
  assert.equal(screen.control('select','第一目標').props.value,'enemy-a');assert.match(content(screen.control('select','第一目標')),/武田信玄.*撃破・敗走済み/);
  screen.click('自動進行を一時停止');screen.render();assert.equal(screen.timers.size,0);const before=JSON.stringify(screen.props.battle);
  screen.click('次の目標へ進む');screen.render();state=progress(screen);assert.equal(state.props['data-sequence-paused'],'false');assert.equal(state.props['data-sequence-index'],1);assert.match(content(state),/第二目標：山県昌景現在の目標/);assert.equal(screen.timers.size,0);assert.equal(JSON.stringify(screen.props.battle),before);assert.match(screen.text(),/全体の自動進行は停止したまま/);
  screen.click('自動進行を開始');screen.render();screen.flush();const command=screen.calls.at(-1).orders['own-a'];assert.equal(command.targetId,'enemy-b');assert.equal(command.sequenceIndex,1);assert.equal(command.sequencePaused,false);assert.equal(command.sequence.length,3);assert.deepEqual(screen.calls.at(-1).orders['own-b'],{action:'wait'});
});

test('global pause and resume keep a per-unit target break paused until its own resume button is used',()=>{
  const input=threeTargetBattle();input.phase='fighting';const screen=harness(input,{advance(value,orders){const command=clone(orders['own-a']);if(command.sequenceIndex===0){command.sequenceIndex=1;command.sequencePaused=true;command.action='wait';delete command.targetId;}return {ok:true,battle:{...clone(value),turnNumber:value.turnNumber+1},orders:{...clone(orders),'own-a':command},notices:[]};}});
  screen.click('自動命令');setSequence(screen,['wait','next','wait']);screen.click('自動進行を開始');screen.render();screen.flush();assert.equal(progress(screen).props['data-sequence-paused'],'true');
  screen.click('自動進行を一時停止');screen.render();screen.click('自動進行を開始');screen.render();screen.flush();assert.equal(screen.calls.at(-1).orders['own-a'].action,'wait');assert.equal(screen.calls.at(-1).orders['own-a'].sequencePaused,true);assert.equal(progress(screen).props['data-sequence-index'],1);
});

test('editing a progressing plan restarts that unit at the revised first goal and leaves other units untouched',()=>{
  const input=threeTargetBattle();input.phase='fighting';const screen=harness(input);screen.click('自動命令');setSequence(screen);
  screen.props.selectedUnitId='own-b';screen.change('select','自動進行の攻撃目標','enemy-b');screen.click('この目標へ攻撃を継続');screen.props.selectedUnitId='own-a';screen.render();
  screen.change('select','第一目標','enemy-c');screen.change('select','第二目標','enemy-a');screen.change('select','第三目標','');screen.change('select','第二目標の撃破後','retreat');screen.click('目標の順序を設定');
  screen.click('自動進行を開始');screen.render();screen.flush();assert.deepEqual(screen.calls[0].orders,{'own-a':{action:'attack',targetId:'enemy-c',sequence:[{targetId:'enemy-c',after:'next'},{targetId:'enemy-a',after:'retreat'}],sequenceIndex:0,sequencePaused:false},'own-b':{action:'attack',targetId:'enemy-b'}});
});

test('simple auto commands, canvas orders, doctrine and successful manual commands clear only that unit sequence',()=>{
  for(const action of ['wait','defend','retreat','attack','move','canvas','doctrine','manual','external-manual']){
    const input=threeTargetBattle();input.phase='fighting';const screen=harness(input);screen.click('自動命令');setSequence(screen);screen.props.selectedUnitId='own-b';screen.click('この部隊を防御');screen.props.selectedUnitId='own-a';screen.render();
    if(action==='wait')screen.click('この部隊を待機');else if(action==='defend')screen.click('この部隊を防御');else if(action==='retreat')screen.click('この部隊を退却');else if(action==='attack'){screen.change('select','自動進行の攻撃目標','enemy-b');screen.click('この目標へ攻撃を継続');}else if(action==='move'){screen.change('input','自動進行の移動先の東西','30');screen.change('input','自動進行の移動先の南北','20');screen.click('この地点へ移動を継続');}else if(action==='canvas')screen.controller.order('attack',{targetId:'enemy-c'},'own-a');else if(action==='doctrine')screen.controller.doctrine('own-a','brace');else if(action==='manual'){screen.click('手動ターン');screen.click('待機に戻す');screen.click('自動命令');}else{screen.click('手動ターン');screen.controller.clearOrder('own-a');screen.click('自動命令');}
    screen.render();assert.equal(progress(screen),undefined,action);screen.click('自動進行を開始');screen.render();screen.flush();const call=screen.calls.find(entry=>entry.kind==='auto');assert.equal(call.orders['own-a']?.sequence,undefined,action);assert.deepEqual(call.orders['own-b'],{action:'defend'},action);
  }
});

test('all completed goals show the final command and retreat with remaining goals offers no accidental resume',()=>{
  for(const [index,action]of[[3,'wait'],[3,'defend'],[1,'retreat']]){
    const input=threeTargetBattle();input.phase='fighting';const screen=harness(input,{advance(value,orders){const command={...clone(orders['own-a']),action,sequenceIndex:index,sequencePaused:false};delete command.targetId;return {ok:true,battle:{...clone(value),turnNumber:2},orders:{'own-a':command},notices:[]};}});screen.click('自動命令');setSequence(screen,['retreat','next',action==='defend'?'defend':'next']);screen.click('自動進行を開始');screen.render();screen.flush();
    const state=progress(screen);assert.equal(state.props['data-sequence-index'],index);assert.equal(state.props['data-sequence-paused'],'false');assert.equal(flatten(state).some(node=>node.type==='button'&&content(node)==='次の目標へ進む'),false);
    assert.match(content(state),action==='retreat'?/残りの目標へは自動で進みません/:new RegExp('全目標達成後：'+(action==='wait'?'待機':'防御')));
  }
});
