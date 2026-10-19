/* 天下布武: manual combat turns and optional standing orders. */
(function(root){
  'use strict';
  const names={ashigaru:'足軽',archer:'弓',cavalry:'騎馬',firearm:'鉄砲',navy:'水軍'};
  const actions={wait:'待機',move:'移動',attack:'攻撃',defend:'防御',retreat:'退却'};
  function create(React){
    const h=React.createElement;
    function TurnOrders({battle,selectedUnitId,onSelectedUnitChange,onResult,onController,pauseToken=0,suspended=false}){
      const [draft,setDraft]=React.useState(null),[message,setMessage]=React.useState(''),[busy,setBusy]=React.useState(false);
      const [orders,setOrders]=React.useState({}),[autoRunning,setAutoRunning]=React.useState(false),[autoOnStart,setAutoOnStart]=React.useState(false);
      const [speed,setSpeed]=React.useState(1),[mode,setMode]=React.useState('manual');
      const busyRef=React.useRef(false),battleRef=React.useRef(battle),ordersRef=React.useRef(orders),timerRef=React.useRef(null);
      const aliveRef=React.useRef(true),epochRef=React.useRef(0),runningRef=React.useRef(false),startRef=React.useRef(false),modeRef=React.useRef(mode);
      const previousRef=React.useRef({id:battle.id,phase:battle.phase}),propsRef=React.useRef(null),controllerRef=React.useRef(null),tactics=root.TenkaTactics;
      const lastBattleRef=React.useRef(battle);
      // Local status can render before the parent acknowledges the produced battle.
      if(lastBattleRef.current!==battle){lastBattleRef.current=battle;battleRef.current=battle;}
      propsRef.current={onResult,onSelectedUnitChange,onController,pauseToken,suspended};
      ordersRef.current=orders;runningRef.current=autoRunning;startRef.current=autoOnStart;modeRef.current=mode;
      const clearTimer=()=>{epochRef.current++;if(timerRef.current!==null){root.clearTimeout(timerRef.current);timerRef.current=null;}};
      const stopAuto=text=>{clearTimer();runningRef.current=false;setAutoRunning(false);if(text)setMessage(text);};
      const setStandingOrders=value=>{ordersRef.current=value;setOrders(value);};
      const accept=value=>{setMessage(value?.message||'');if(value?.ok){battleRef.current=value.battle;propsRef.current.onResult?.(value);}};
      const armAuto=()=>{
        const current=battleRef.current,inherited={...ordersRef.current};
        for(const unit of current.units.filter(item=>item.side===(current.playerSide||'attacker')&&item.troops>0)){
          if(Object.prototype.hasOwnProperty.call(inherited,unit.id))continue;
          const plan=unit.turnPlan;
          if(plan?.action==='attack'&&plan.targetId)inherited[unit.id]={action:'attack',targetId:plan.targetId};
          else if(['defend','retreat'].includes(plan?.action))inherited[unit.id]={action:plan.action};
          else if(plan?.move)inherited[unit.id]={action:'move',x:plan.move.x,z:plan.move.z};
        }
        setStandingOrders(inherited);setMode('auto');
      };
      const startAuto=()=>{
        if(busyRef.current||propsRef.current.suspended||battleRef.current.phase!=='fighting')return;
        if(!root.TenkaAutoBattle?.advance){setMessage('自動進行を読み込めませんでした。手動ターンで進めてください。');return;}
        armAuto();runningRef.current=true;setAutoRunning(true);setMessage('自動進行を開始しました。命令のない部隊は待機します。');
      };
      React.useEffect(()=>{aliveRef.current=true;return()=>{aliveRef.current=false;runningRef.current=false;clearTimer();};},[]);
      React.useEffect(()=>{
        const previous=previousRef.current;previousRef.current={id:battle.id,phase:battle.phase};
        if(previous.id!==battle.id){stopAuto();setStandingOrders({});setAutoOnStart(false);startRef.current=false;setMode('manual');setDraft(null);setMessage('');return;}
        if(battle.phase!=='fighting'){stopAuto();return;}
        if(previous.phase==='deployment'&&startRef.current&&!propsRef.current.suspended)startAuto();
      },[battle.id,battle.phase]);
      React.useEffect(()=>{if(suspended)stopAuto('進行を一時停止しました。再開する場合は自動進行の開始を押してください。');},[suspended]);
      const previousPauseRef=React.useRef(pauseToken);
      React.useEffect(()=>{if(previousPauseRef.current!==pauseToken){previousPauseRef.current=pauseToken;stopAuto('画面を閉じる操作により、自動進行を一時停止しました。');}},[pauseToken]);
      React.useEffect(()=>{
        const controller={get enabled(){return battleRef.current.phase==='fighting'&&modeRef.current==='auto';},order:(action,extra={},unitId)=>controllerRef.current?.order(action,extra,unitId)||false,pause:()=>stopAuto(),doctrine:(unitId,stance)=>controllerRef.current?.doctrine(unitId,stance)};
        onController?.(controller);return()=>onController?.(null);
      },[onController]);
      React.useEffect(()=>{
        clearTimer();
        if(!autoRunning||suspended||battle.controlMode!=='turns'||battle.phase!=='fighting')return;
        const epoch=epochRef.current,token=pauseToken;
        timerRef.current=root.setTimeout(()=>{
          timerRef.current=null;
          if(!aliveRef.current||!runningRef.current||epoch!==epochRef.current||busyRef.current||propsRef.current.suspended||propsRef.current.pauseToken!==token||battleRef.current.phase!=='fighting'||battleRef.current!==lastBattleRef.current)return;
          busyRef.current=true;setBusy(true);
          try{
            const value=root.TenkaAutoBattle.advance(battleRef.current,ordersRef.current);
            if(!value?.ok){stopAuto(value?.message||'自動命令を実行できませんでした。命令を確認してください。');return;}
            setStandingOrders(value.orders||ordersRef.current);
            const notices=(value.notices||[]).map(item=>item.message).filter(Boolean);
            accept({...value,message:[value.message,...notices].filter(Boolean).join(' ')});
            if(value.battle.phase!=='fighting')stopAuto();
          }catch(error){stopAuto(error?.message||'自動進行でエラーが発生しました。戦況を保持して一時停止しました。');}
          finally{busyRef.current=false;setBusy(false);}
        },1200/speed);
        return clearTimer;
      },[battle,autoRunning,speed,suspended,pauseToken]);
      if(battle.controlMode!=='turns'||!['deployment','fighting'].includes(battle.phase))return null;
      const deploying=battle.phase==='deployment',automatic=deploying||mode==='auto';
      const view=tactics.turnView(battle,selectedUnitId),selected=view.selected||view.units[0],unit=battle.units.find(u=>u.id===selected?.id);
      const standing=orders[selected?.id]||{action:'wait'},key=(automatic?'auto:':'manual:')+(automatic?'':view.number+':')+selected?.id;
      const x=draft?.key===key?draft.x:String(Math.round((automatic&&standing.action==='move'?standing.x:unit?.x??0)*10)/10);
      const z=draft?.key===key?draft.z:String(Math.round((automatic&&standing.action==='move'?standing.z:unit?.z??0)*10)/10);
      const side=battle.playerSide||'attacker';
      const targets=[...battle.units.filter(u=>u.side!==side&&u.troops>0&&!['routed','destroyed'].includes(u.status)),...(side==='attacker'?(battle.structures||[]).filter(s=>s.hp>0):[]),...(battle.fortifications||[]).filter(s=>s.side!==side&&s.hp>0)];
      if(automatic&&battle.mode==='siege'&&side==='attacker')targets.push({...battle.captureZone,id:'capture',name:'本丸制圧（城門突破から継続）'});
      const targetId=draft?.key===key?draft.targetId||'':automatic&&standing.action==='attack'?standing.targetId||'':'';
      const targetName=id=>{const target=targets.find(t=>t.id===id);return target?.commanderName||target?.name||'目標';};
      const coordinate=(axis,value)=>setDraft({key,x,z,targetId,[axis]:value});
      const order=(action,extra={})=>{if(selected&&!busyRef.current&&!runningRef.current)accept(tactics.order(battleRef.current,{unitId:selected.id,order:action,...extra}));};
      const standingOrder=(action,extra={},unitId=selected?.id)=>{
        if(busyRef.current)return false;
        const current=battleRef.current,chosen=current.units.find(item=>item.id===unitId&&item.side===(current.playerSide||'attacker')&&item.troops>0&&!['routed','destroyed','retreating'].includes(item.status));
        action=action==='hold'?'defend':action;
        if(!chosen||!Object.hasOwn(actions,action))return false;
        if(action==='move'){
          const box=current.layout?.bounds;
          if(![extra.x,extra.z].every(Number.isFinite)){setMessage('移動先の東西・南北の座標を両方入力してください。');return false;}
          if(box&&(extra.x<box.minX+1||extra.x>box.maxX-1||extra.z<box.minZ+1||extra.z>box.maxZ-1)){setMessage('戦場の範囲内に移動先を設定してください。');return false;}
        }
        if(action==='attack'&&!targets.some(target=>target.id===extra.targetId)){setMessage('攻撃する目標を選んでください。');return false;}
        const command={action,...(action==='move'?{x:extra.x,z:extra.z}:action==='attack'?{targetId:extra.targetId}:{})};
        setStandingOrders({...ordersRef.current,[chosen.id]:command});
        setMessage((chosen.commanderName||names[chosen.type]+'部隊')+'を'+actions[action]+'に設定しました。'+(runningRef.current?'次のターンから反映します。':'自動進行を開始するまで動きません。'));
        return true;
      };
      controllerRef.current={order:standingOrder,doctrine:(unitId,stance)=>{if(modeRef.current==='auto'&&['rest','brace'].includes(stance))standingOrder(stance==='rest'?'wait':'defend',{},unitId);}};
      const execute=async()=>{
        if(busyRef.current||runningRef.current||propsRef.current.suspended)return;
        busyRef.current=true;setBusy(true);setMessage('両軍の命令を実行しています…');
        try{await new Promise(resolve=>root.setTimeout(resolve,0));if(!aliveRef.current)return;accept(tactics.endTurn(battleRef.current));setDraft(null);}
        catch(error){setMessage(error.message||'命令を実行できませんでした。');}
        finally{busyRef.current=false;if(aliveRef.current)setBusy(false);}
      };
      return h('section',{className:'tenka-turn-orders','aria-label':'ターンごとの戦闘命令','data-testid':'turn-orders'},
        h('header',null,h('h3',null,deploying?'開戦後の部隊命令':'第'+view.number+'ターンの采配'),h('span',null,'両軍とも兵科別の移動・射程・攻防を適用')),
        deploying?h('label',{className:'tenka-auto-start'},h('input',{type:'checkbox','aria-label':'開戦後に自動進行',checked:autoOnStart,onChange:e=>{setAutoOnStart(e.target.checked);startRef.current=e.target.checked;if(e.target.checked)armAuto();else setMode('manual');}}),'開戦後に自動進行'):
          h('nav',{className:'tenka-turn-mode','aria-label':'合戦の進行方式','data-testid':'auto-battle-mode'},h('button',{type:'button','aria-pressed':mode==='manual',disabled:busy,onClick:()=>{stopAuto();setMode('manual');}},'手動ターン'),h('button',{type:'button','aria-pressed':mode==='auto',disabled:busy,onClick:armAuto},'自動命令')),
        automatic?h('p',null,'部隊ごとに継続する命令を設定します。攻撃は目標へ接近して射程内で攻撃し、待機・防御の部隊はその場に残ります。未指定の部隊は待機します。敵と他の味方は進行を続けます。'):
          h('p',null,'各部隊の移動先と攻撃・防御・待機を決め、「このターンを実行」を押します。指示のない部隊は待機し、画面を眺めている間に戦闘は進みません。'),
        automatic&&h('div',{className:'tenka-auto-controls'},h('span',{'data-testid':'auto-battle-running','data-running':autoRunning?'true':'false',role:'status'},deploying?'布陣中・進行停止':autoRunning?'自動進行中':'自動進行は停止中'),h('label',null,'進行速度',h('select',{'aria-label':'自動進行の速度',value:String(speed),onChange:e=>setSpeed(Number(e.target.value))},[1,2,4].map(value=>h('option',{key:value,value:String(value)},value+'倍')))),!deploying&&h('button',{type:'button',className:'primary-button','data-testid':autoRunning?'auto-battle-pause':'auto-battle-start',disabled:busy||suspended,onClick:()=>autoRunning?stopAuto('自動進行を一時停止しました。'):startAuto()},autoRunning?'自動進行を一時停止':'自動進行を開始')),
        h('div',{className:'tenka-turn-roster'},view.units.map(entry=>{const command=orders[entry.id]||{action:'wait'};return h('button',{key:entry.id,type:'button','data-unit-id':entry.id,'data-auto-action':command.action,'aria-pressed':entry.id===selected?.id,disabled:busy,onClick:()=>onSelectedUnitChange?.(entry.id)},h('strong',null,(entry.commanderName||'指揮武将未指定')+' ／ '+names[entry.type]),h('small',null,'移動 '+entry.movement+' · 射程 '+entry.range+' · 攻 '+entry.attack+' · 防 '+entry.defense),h('span',null,automatic?'自動：'+actions[command.action]+(command.targetId?'：'+targetName(command.targetId):command.action==='move'?' → '+command.x.toFixed(1)+','+command.z.toFixed(1):''):(entry.plannedMove?'移動 → '+entry.plannedMove.x.toFixed(1)+','+entry.plannedMove.z.toFixed(1)+' ／ ':'')+actions[entry.action]+(entry.targetId?'：'+targetName(entry.targetId):'')));})),
        selected&&h('div',{className:'tenka-turn-selected'+(automatic?' tenka-auto-selected':'')},h('h4',null,(selected.commanderName||names[selected.type]+'部隊')+'の'+(automatic?'継続命令':'命令')),h('p',null,'移動可能 '+selected.movement+' ／ 射程 '+selected.range+'。移動は地形・陣形・疲労により変化。攻防値は兵科の基準倍率です。'),
          h('div',{className:'tenka-turn-move'},h('label',null,'移動先 東西 X',h('input',{type:'number',step:'.1','aria-label':automatic?'自動進行の移動先の東西':'ターン移動先の東西',value:x,disabled:busy,onChange:e=>coordinate('x',e.target.value)})),h('label',null,'南北 Z',h('input',{type:'number',step:'.1','aria-label':automatic?'自動進行の移動先の南北':'ターン移動先の南北',value:z,disabled:busy,onChange:e=>coordinate('z',e.target.value)})),h('button',{type:'button',disabled:busy||x.trim()===''||z.trim()==='',onClick:()=>automatic?standingOrder('move',{x:Number(x),z:Number(z)}):order('move',{x:Number(x),z:Number(z)})},automatic?'この地点へ移動を継続':'移動を計画')),
          h('div',{className:'tenka-turn-target'},h('label',null,'攻撃目標',h('select',{'aria-label':automatic?'自動進行の攻撃目標':'このターンの攻撃目標',value:targetId,disabled:busy,onChange:e=>setDraft({key,x,z,targetId:e.target.value})},h('option',{value:''},'敵部隊・城門・施設を選択'),targets.map(t=>h('option',{key:t.id,value:t.id},(t.commanderName?names[t.type]+' ／ '+t.commanderName:t.name||'城の施設')+(Number.isFinite(t.x)?'（東西'+Math.round(t.x)+'・南北'+Math.round(t.z)+'）':''))))),h('button',{type:'button',disabled:busy||!targetId,onClick:()=>automatic?standingOrder('attack',{targetId}):order('attack',{targetId})},automatic?'この目標へ攻撃を継続':'攻撃を計画')),
          h('div',{className:'tenka-turn-actions'},h('button',{type:'button',disabled:busy,onClick:()=>automatic?standingOrder('defend'):order('hold')},automatic?'この部隊を防御':'防御を計画'),h('button',{type:'button',disabled:busy,onClick:()=>automatic?standingOrder('wait'):order('wait')},automatic?'この部隊を待機':'待機に戻す'),automatic&&h('button',{type:'button',disabled:busy,onClick:()=>standingOrder('retreat')},'この部隊を退却'))),
        message&&h('p',{className:'tenka-turn-message',role:'status'},message),
        automatic?h('p',{className:'tenka-auto-note'},(deploying?'': 'この欄と戦場上の移動・攻撃・待機は継続命令として設定されます。')+'自動命令は開始を押したときだけ進みます。目標撃破・移動完了後は待機します。速度は命令の実行間隔だけを変え、兵科の移動力や攻防を変えません。布陣と指揮武将は布陣欄で指定してください。'):
          h('div',{className:'tenka-turn-execute'},h('small',null,'移動後に射程内なら攻撃を計画できます。攻撃は各隊一回。防御は被害を抑え、待機は休息します。実行したターンのみ兵糧を消費します。'),h('button',{type:'button',className:'primary-button',disabled:busy||autoRunning||suspended,onClick:execute},busy?'命令を実行中…':'このターンを実行')));
    }
    return {TurnOrders};
  }
  root.TenkaTurnUI={create};
})(typeof window!=='undefined'?window:globalThis);
