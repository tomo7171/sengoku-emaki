/* 天下布武: explicit orders for each combat turn. */
(function(root){
  'use strict';
  const names={ashigaru:'足軽',archer:'弓',cavalry:'騎馬',firearm:'鉄砲',navy:'水軍'};
  const actions={wait:'待機',move:'移動',attack:'攻撃',defend:'防御',retreat:'退却'};
  function create(React){
    const h=React.createElement;
    function TurnOrders({battle,selectedUnitId,onSelectedUnitChange,onResult}){
      const [draft,setDraft]=React.useState(null),[message,setMessage]=React.useState(''),[busy,setBusy]=React.useState(false);
      const busyRef=React.useRef(false),tactics=root.TenkaTactics;
      if(battle.controlMode!=='turns'||battle.phase!=='fighting')return null;
      const view=tactics.turnView(battle,selectedUnitId),selected=view.selected||view.units[0],unit=battle.units.find(u=>u.id===selected?.id);
      const key=view.number+':'+selected?.id;
      const x=draft?.key===key?draft.x:String(Math.round((unit?.x??0)*10)/10),z=draft?.key===key?draft.z:String(Math.round((unit?.z??0)*10)/10);
      const targets=[...battle.units.filter(u=>u.side!==(battle.playerSide||'attacker')&&u.troops>0&&!['routed','destroyed'].includes(u.status)),
        ...(battle.playerSide!=='defender'?(battle.structures||[]).filter(s=>s.hp>0):[]),
        ...(battle.fortifications||[]).filter(s=>s.side!==(battle.playerSide||'attacker')&&s.hp>0)];
      const targetId=draft?.key===key?draft.targetId||'':'';
      const coordinate=(axis,value)=>setDraft({key,x,z,targetId,[axis]:value});
      const result=value=>{setMessage(value?.message||'');if(value?.ok)onResult?.(value);};
      const order=(action,extra={})=>{if(selected&&!busyRef.current)result(tactics.order(battle,{unitId:selected.id,order:action,...extra}));};
      const execute=async()=>{
        if(busyRef.current)return;busyRef.current=true;setBusy(true);setMessage('両軍の命令を実行しています…');
        try{await new Promise(resolve=>setTimeout(resolve,0));result(tactics.endTurn(battle));setDraft(null);}
        catch(error){setMessage(error.message||'命令を実行できませんでした。');}
        finally{busyRef.current=false;setBusy(false);}
      };
      return h('section',{className:'tenka-turn-orders','aria-label':'ターンごとの戦闘命令','data-testid':'turn-orders'},
        h('header',null,h('h3',null,'第'+view.number+'ターンの采配'),h('span',null,'両軍とも兵科別の移動・射程・攻防を適用')),
        h('p',null,'各部隊の移動先と攻撃・防御・待機を決め、「このターンを実行」を押します。指示のない部隊は待機し、画面を眺めている間に戦闘は進みません。'),
        h('div',{className:'tenka-turn-roster'},view.units.map(entry=>h('button',{key:entry.id,type:'button','aria-pressed':entry.id===selected?.id,disabled:busy,onClick:()=>onSelectedUnitChange?.(entry.id)},
          h('strong',null,entry.commanderName+' ／ '+names[entry.type]),h('small',null,'移動 '+entry.movement+' · 射程 '+entry.range+' · 攻 '+entry.attack+' · 防 '+entry.defense),
          h('span',null,(entry.plannedMove?'移動 → '+entry.plannedMove.x.toFixed(1)+','+entry.plannedMove.z.toFixed(1)+' ／ ':'')+actions[entry.action]+(entry.targetId?'：'+(targets.find(t=>t.id===entry.targetId)?.name||targets.find(t=>t.id===entry.targetId)?.commanderName||'目標'):''))))),
        selected&&h('div',{className:'tenka-turn-selected'},
          h('h4',null,selected.commanderName+'の命令'),
          h('p',null,'移動可能 '+selected.movement+' ／ 射程 '+selected.range+'。移動は地形・陣形・疲労により変化。攻防値は兵科の基準倍率です。'),
          h('div',{className:'tenka-turn-move'},h('label',null,'移動先 東西 X',h('input',{type:'number',step:'.1','aria-label':'ターン移動先の東西',value:x,disabled:busy,onChange:e=>coordinate('x',e.target.value)})),h('label',null,'南北 Z',h('input',{type:'number',step:'.1','aria-label':'ターン移動先の南北',value:z,disabled:busy,onChange:e=>coordinate('z',e.target.value)})),
            h('button',{type:'button',disabled:busy||x.trim()===''||z.trim()==='',onClick:()=>order('move',{x:Number(x),z:Number(z)})},'移動を計画')),
          h('div',{className:'tenka-turn-target'},h('label',null,'攻撃目標',h('select',{'aria-label':'このターンの攻撃目標',value:targetId,disabled:busy,onChange:e=>setDraft({key,x,z,targetId:e.target.value})},h('option',{value:''},'敵部隊・城門・施設を選択'),targets.map(t=>h('option',{key:t.id,value:t.id},(t.commanderName?names[t.type]+' ／ '+t.commanderName:t.name||'城の施設')+'（東西'+Math.round(t.x)+'・南北'+Math.round(t.z)+'）')))),h('button',{type:'button',disabled:busy||!targetId,onClick:()=>order('attack',{targetId})},'攻撃を計画')),
          h('div',{className:'tenka-turn-actions'},h('button',{type:'button',disabled:busy,onClick:()=>order('hold')},'防御を計画'),h('button',{type:'button',disabled:busy,onClick:()=>order('wait')},'待機に戻す'))),
        message&&h('p',{className:'tenka-turn-message',role:'status'},message),
        h('div',{className:'tenka-turn-execute'},h('small',null,'移動後に射程内なら攻撃を計画できます。攻撃は各隊一回。防御は被害を抑え、待機は休息します。実行したターンのみ兵糧を消費します。'),h('button',{type:'button',className:'primary-button',disabled:busy,onClick:execute},busy?'命令を実行中…':'このターンを実行')));
    }
    return {TurnOrders};
  }
  root.TenkaTurnUI={create};
})(typeof window!=='undefined'?window:globalThis);
