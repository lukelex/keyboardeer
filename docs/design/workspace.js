// High-fidelity design prototype. All devices and runtime state are simulated.
// Per-keyboard drafts exist only in memory and never reach the manager.
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const devices = {
  q1: { name: 'Keychron Q1', connected: true },
  framework: { name: 'Framework keyboard', connected: true },
};
const names = { Esc: 'Escape', Caps: 'Caps Lock', Bksp: 'Backspace', Ctrl: 'Left Control', RCtrl: 'Right Control', Shift: 'Left Shift', RShift: 'Right Shift', Alt: 'Left Alt', RAlt: 'Right Alt', Super: 'Left Super', RSuper: 'Right Super', Del: 'Delete', PgUp: 'Page Up', PgDn: 'Page Down', Ins: 'Insert', '↑': 'Up arrow', '←': 'Left arrow', '↓': 'Down arrow', '→': 'Right arrow' };
const basicRows = [
  ['Esc','F1','F2','F3','F4','F5','F6','F7','F8','F9','F10','F11','F12'],
  ['`','1','2','3','4','5','6','7','8','9','0','-','=', ['Bksp',2]],
  [['Tab',1.5],'Q','W','E','R','T','Y','U','I','O','P','[',']',['\\',1.5]],
  [['Caps',1.8],'A','S','D','F','G','H','J','K','L',';',"'",['Enter',2.2]],
  [['Shift',2.2],'Z','X','C','V','B','N','M',',','.','/',['RShift',2.8]],
  [['Ctrl',1.3],['Super',1.3],['Alt',1.3],['Space',6],'RAlt','RSuper','Menu','RCtrl'],
];
const physicalRows = basicRows.map((row) => [...row]);
['Del','Home','PgUp','PgDn'].forEach((key,index) => physicalRows[index].push(key));
physicalRows[4] = [...basicRows[4].slice(0,-1), ['RShift',1.8], '↑', 'End'];
physicalRows[5] = [['Ctrl',1.3],['Super',1.3],['Alt',1.3],['Space',6],'RAlt','Fn','RCtrl','←','↓','→'];
const navigation = ['Ins','Home','PgUp','Del','End','PgDn','Print Screen','Scroll Lock','Pause'];
const arrows = ['↑','←','↓','→'];
const numpad = ['Num Lock','KP /','KP *','KP −','KP 7','KP 8','KP 9','KP +','KP 4','KP 5','KP 6','KP Enter','KP 1','KP 2','KP 3','KP .','KP 0'];
const modifiers = ['Ctrl','Shift','Alt','Super','RCtrl','RShift','RAlt','RSuper'];
const entry = (key) => Array.isArray(key) ? key : [key,1];
const physicalKeys = physicalRows.flatMap((row) => row.map((key) => entry(key)[0]));
const keyName = (key) => names[key] || key;
const drafts = new Map();
let device = 'q1';
let currentPage = '';
let selected = 'Caps';
let layer = 0;
let layerDetail = 1;
let category = 'Basic';
let managerOnline = true;
let identifyActive = false;
let identifyTimer;
let toastTimer;
let dialogSave;
let actions = new Map();
function state() {
  if (!drafts.has(device)) drafts.set(device, { assignments: {}, layers: [{id:0,name:'Base'},{id:1,name:'Navigation'}], history: [], ...newDraftValidation() });
  return drafts.get(device);
}
function runtimeKnown() { return managerOnline && $('#diagnostic-scenario').value!=='incomplete'; }
function remember() { const s=state(); s.history.push(structuredClone({ assignments:s.assignments, layers:s.layers, recovery:s.recovery })); }
function layerName(id) { return state().layers.find((item) => item.id === id)?.name || 'Unknown layer'; }
function address(key=selected, id=layer) { return `${id}|${key}`; }
function original(key, id=layer) {
  if (id === 0) return key === 'Fn' ? 'hold:1' : key;
  if (id === 1) return ({ H:'←', J:'↓', K:'↑', L:'→', Fn:'to-base' })[key] || 'transparent';
  return 'transparent';
}
function assignment(key=selected, id=layer) { return state().assignments[address(key,id)] || original(key,id); }
function editCount() {
  let count=Object.entries(state().assignments).filter(([id,value]) => { const [number,key]=id.split('|'); return value!==original(key,Number(number)); }).length;
  count += state().layers.filter((item) => item.id>1 || item.name!== (item.id===0?'Base':'Navigation')).length;
  return count;
}
function toast(message) { clearTimeout(toastTimer); $('#toast').textContent=message; $('#toast').hidden=false; toastTimer=setTimeout(()=>$('#toast').hidden=true,4200); }
function detail(title,copy,name=null,save=null,saveLabel='Save layer') {
  $('#detail-title').textContent=title; $('#detail-copy').textContent=copy;
  $('#detail-field').hidden=name===null; $('#detail-input').value=name||'';
  $('#detail-save').hidden=!save; $('#detail-save').textContent=saveLabel;
  dialogSave=save; $('#detail-dialog').returnValue=''; $('#detail-dialog').showModal();
}
$('#detail-dialog').addEventListener('close',()=>{ if($('#detail-dialog').returnValue==='save' && dialogSave) dialogSave($('#detail-input').value.trim()); dialogSave=null; });
function miniBoards() {
  $$('[data-mini]').forEach((board)=>{
    const rowCount=5;
    for(let r=0;r<rowCount;r++) {
      const line=document.createElement('div'); line.className='mini-row';
      for(let k=0;k<(r===4?8:13);k++){ const cap=document.createElement('span'); cap.className='mini-key'; line.append(cap); }
      board.append(line);
    }
  });
}
function register(id,label,group,description,short=label) { actions.set(id,{id,label,group,description,short}); }
function buildActions() {
  actions=new Map();
  const allBasic=[...basicRows.flatMap((row)=>row.map((key)=>entry(key)[0])),...navigation,...arrows,...numpad];
  for(const key of new Set(allBasic)) register(key,keyName(key),'Basic',`Send ${keyName(key)} when pressed.`,key);
  state().layers.filter((item)=>item.id!==0).forEach((item)=>{
    register(`hold:${item.id}`,`Hold for ${item.name}`,'Layers',`Use ${item.name} while held. Release to return.`,`Hold L${item.id}`);
    register(`toggle:${item.id}`,`Toggle ${item.name}`,'Layers',`Toggle ${item.name} on or off.`,`Toggle L${item.id}`);
  });
  register('to-base','Go to Base','Layers','Return to the base layer.','Base');
  register('transparent','Pass through','Layers','Use the action on the lower layer. Unavailable on Base.','▽');
  register('disabled','Do nothing','Layers','Disable this key on the selected layer.','None');
  for(const label of ['Play / pause','Next track','Previous track','Stop playback','Volume up','Volume down','Mute','Brightness up','Brightness down']) register(label,label,'Media',`${label}. Availability depends on runtime support.`);
  register('esc-ctrl','Escape / Control','Tap & hold','Tap for Escape. Hold for Left Control.','Esc / Ctrl');
  register('space-nav',`Space / ${layerName(1)}`,'Tap & hold',`Tap for Space. Hold for ${layerName(1)}.`,'Space / L1');
  register('enter-shift','Enter / Shift','Tap & hold','Tap for Enter. Hold for Left Shift.','Enter / Shift');
  register('tab-alt','Tab / Alt','Tap & hold','Tap for Tab. Hold for Left Alt.','Tab / Alt');
  register('invalid:layer','Hold missing layer 99','Fixture','Prototype-only missing-layer assignment.','Layer 99');
  register('invalid:alias','Undefined @quick_escape','Fixture','Prototype-only undefined behavior reference.','@alias?');
}
function actionName(id) { return actions.get(id)?.label || keyName(id); }
function renderKeyboard() {
  $('#keyboard').replaceChildren();
  physicalRows.forEach((row,index)=>{
    const line=document.createElement('div'); line.className='key-row';
    row.forEach((item)=>{
      const [key,width]=entry(item); const value=assignment(key); const edited=value!==original(key);
      const button=document.createElement('button'); button.dataset.key=key;
      button.className=`key ${index===0?'function':''} ${key.length>1?'modifier':''} ${key==='Esc'?'escape':''} ${selected===key?'selected':''} ${edited?'edited':''}`;
      button.style.setProperty('--width',width); button.textContent=actions.get(value)?.short||key;
      button.setAttribute('aria-pressed',String(selected===key)); button.setAttribute('aria-label',`${keyName(key)}: ${actionName(value)}${edited?', changed in draft':''}`);
      if(edited){ const small=document.createElement('small'); small.textContent=keyName(key); button.append(small); }
      button.addEventListener('click',()=>{ selected=key; renderEditor(); $$('.key').find((cap)=>cap.dataset.key===selected)?.focus({preventScroll:true}); });
      line.append(button);
    }); $('#keyboard').append(line);
  });
}
function renderLayerTabs() {
  $('#layer-tabs').replaceChildren();
  state().layers.forEach((item)=>{
    const button=document.createElement('button'); button.textContent=`${item.id} · ${item.name}`;
    button.setAttribute('role','tab'); button.setAttribute('aria-selected',String(item.id===layer)); button.tabIndex=item.id===layer?0:-1;
    button.dataset.layer=item.id; button.addEventListener('click',()=>setLayer(item.id));
    button.addEventListener('keydown',(event)=>{
      if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
      event.preventDefault(); const list=state().layers; const index=list.findIndex((item)=>item.id===layer);
      const next=event.key==='Home'?0:event.key==='End'?list.length-1:(index+(event.key==='ArrowRight'?1:-1)+list.length)%list.length;
      setLayer(list[next].id); $(`#layer-tabs [data-layer="${layer}"]`).focus();
    }); $('#layer-tabs').append(button);
  });
}
function setLayer(id) { layer=id; renderEditor(); }
function assign(id) {
  if(id===assignment() || (id==='transparent'&&layer===0)) return;
  remember(); rememberKeyRecovery(address()); state().assignments[address()]=id; draftChanged(); renderKeyboard(); renderDraft(); renderValidation();
  $$('[data-action]').forEach((button)=>button.setAttribute('aria-pressed',String(button.dataset.action===id)));
  $('#draft-message').textContent=`${keyName(selected)} → ${actionName(id)}. Draft only; not applied.`;
}
function actionButton(id,tile=false) {
  const action=actions.get(id); const button=document.createElement('button');
  button.className=tile?'action-tile':'action-key'; button.dataset.action=id;
  button.setAttribute('aria-label',`Assign ${action.label} to selected key`); button.setAttribute('aria-pressed',String(assignment()===id));
  button.disabled=id==='transparent'&&layer===0; button.title=action.description;
  if(tile){ const strong=document.createElement('strong'); strong.textContent=action.label; const small=document.createElement('small'); small.textContent=action.group==='Tap & hold'?'Tap / hold':action.group; button.append(strong,small); }
  else button.textContent=action.short;
  button.addEventListener('click',()=>assign(id));
  const describe=()=>$('#action-hint').textContent=`${action.label} — ${action.description}`;
  button.addEventListener('focus',describe); button.addEventListener('mouseenter',describe);
  return button;
}
function group(label) { const node=document.createElement('div'); node.className='action-group'; const title=document.createElement('h3'); title.textContent=label; node.append(title); return node; }
function renderBasic() {
  const layout=document.createElement('div'); layout.className='basic-palette';
  const main=group('LETTERS, NUMBERS & EVERYDAY KEYS');
  basicRows.forEach((row)=>{ const line=document.createElement('div'); line.className='action-row'; row.forEach((item)=>{ const [id,width]=entry(item); const button=actionButton(id); button.style.setProperty('--width',width); line.append(button); }); main.append(line); });
  const nav=group('NAVIGATION'); const navGrid=document.createElement('div'); navGrid.className='nav-keys'; navigation.forEach((id)=>navGrid.append(actionButton(id))); nav.append(navGrid);
  const arrowGrid=document.createElement('div'); arrowGrid.className='arrow-keys'; arrows.forEach((id,index)=>{ const button=actionButton(id); if(!index){button.style.gridRow='1';button.style.gridColumn='2';}else button.style.gridRow='2';arrowGrid.append(button); }); nav.append(arrowGrid);
  const pad=group('NUMPAD'); const padGrid=document.createElement('div'); padGrid.className='numpad-keys'; numpad.forEach((id)=>{ const button=actionButton(id); button.textContent=id.replace('KP ','');padGrid.append(button); });pad.append(padGrid);
  layout.append(main,nav,pad); $('#action-palette').append(layout);
}
function renderPalette() {
  $('#action-palette').replaceChildren(); const query=$('#action-search').value.trim().toLowerCase();
  const available=[...actions.values()].filter((action)=>action.group!=='Fixture').filter((action)=>query?`${action.label} ${action.short} ${action.group} ${action.description}`.toLowerCase().includes(query):category==='Modifiers'?modifiers.includes(action.id):action.group===category);
  $('#action-count').textContent=`${available.length} ${query?'matches · all categories':'options'}`;
  if(!query&&category==='Basic') { renderBasic(); return; }
  const description=document.createElement('p'); description.className='palette-description';
  description.textContent=!available.length?'No actions found. Try “escape”, “volume”, or “layer”.':query?'Matching actions across every category.':category==='Tap & hold'?'Quick-start combinations. Custom timing and behavior builders are future work.':category==='Layers'?'Reach another layer, return to Base, or inherit from the layer below.':'Choose an action to assign it directly to your draft.';
  $('#action-palette').append(description);
  const grid=document.createElement('div'); grid.className='action-grid'; available.forEach((action)=>grid.append(actionButton(action.id,true))); $('#action-palette').append(grid);
}
function renderDraft() {
  $('#selected-key').textContent=keyName(selected); $('#selected-action').textContent=actionName(assignment()); $('#selected-layer').textContent=`${layerName(layer)} layer`;
  $('#restore-key').disabled=assignment()===original(selected);
  const count=editCount(); $('#draft-summary').textContent=count?`${count} ${count===1?'edit':'edits'} in your keyboard draft`:'No draft changes yet'; $('#draft-dot').classList.toggle('pending',count>0);
  $('#draft-message').textContent=managerOnline?'Draft only. Changes are not applied to your keyboard.':'Manager unavailable. Draft editing is available; live mapping status is unknown.';
  $('#undo').disabled=!state().history.length; $('#layer-count').textContent=state().layers.length;
}
function renderEditor() {
  buildActions();
  if(state().validation.phase==='unchecked'||state().validationEnvironment!==validationEnvironment(device))scheduleValidation();
  renderLayerTabs(); renderKeyboard(); renderPalette(); renderDraft(); renderValidation();
}
$('#action-search').addEventListener('input',renderPalette);
$('#restore-key').addEventListener('click',()=>assign(original(selected)));
$('#undo').addEventListener('click',()=>{
  const previous=state().history.pop(); if(!previous)return;
  state().assignments=previous.assignments; state().layers=previous.layers; state().recovery=previous.recovery;
  if(!state().layers.some((item)=>item.id===layer))layer=0;
  if(!state().layers.some((item)=>item.id===layerDetail))layerDetail=0;
  draftChanged(); renderEditor(); toast('Last draft edit undone. Checking again; your keyboard is unchanged.');
});
$$('[data-category]').forEach((button,index,buttons)=>{
  function choose(){ category=button.dataset.category; $('#action-search').value=''; buttons.forEach((tab)=>{ tab.setAttribute('aria-selected',String(tab===button));tab.tabIndex=tab===button?0:-1; });renderPalette(); }
  button.addEventListener('click',choose);
  button.addEventListener('keydown',(event)=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowRight'?1:-1)+buttons.length)%buttons.length;buttons[next].click();buttons[next].focus();});
});
document.addEventListener('keydown',(event)=>{if(currentPage==='keymap'&&event.key==='/'&&!['INPUT','SELECT','TEXTAREA'].includes(event.target.tagName)&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&!$('#detail-dialog').open){event.preventDefault();$('#action-search').focus();}});

function entryKeys(id) {
  const results=[];
  for(const other of state().layers.filter((item)=>item.id!==id)) for(const key of physicalKeys){ const value=assignment(key,other.id); if(value===`hold:${id}`||value===`toggle:${id}`||(id===1&&value==='space-nav'))results.push(keyName(key)); }
  return [...new Set(results)];
}
function renderLayers() {
  buildActions(); $('#layer-list').replaceChildren();
  state().layers.forEach((item)=>{
    const card=document.createElement('button'); card.className='layer-card';card.dataset.layerId=item.id;card.setAttribute('aria-pressed',String(item.id===layerDetail));
    const number=document.createElement('span');number.className='layer-number';number.textContent=item.id;
    const copy=document.createElement('span');const title=document.createElement('strong');title.textContent=item.name;const caption=document.createElement('small');caption.textContent=item.id===0?'Your everyday key assignments':item.id===1?'H J K L → arrows · pass-through elsewhere':'New draft layer · pass-through by default';copy.append(title,caption);
    const badge=document.createElement('span');const reachable=item.id===0||entryKeys(item.id).length>0;badge.className=`badge ${reachable?'green':'amber'}`;badge.textContent=item.id===0?'Default':reachable?'Reachable':'Needs entry key';card.append(number,copy,badge);
    card.addEventListener('click',()=>{layerDetail=item.id;renderLayers(); $(`[data-layer-id="${item.id}"]`).focus({preventScroll:true});});$('#layer-list').append(card);
  });
  const item=state().layers.find((item)=>item.id===layerDetail)||state().layers[0];layerDetail=item.id;
  $('#layer-detail-name').textContent=item.name;$('#layer-detail-index').textContent=`Layer ${item.id}`;
  const entries=entryKeys(item.id);
  $('#layer-reachability').textContent=item.id===0?'The base layout is always available':entries.length?`Entry keys: ${entries.join(', ')}`:'No entry key assigned yet';
  $('#layer-fallback').textContent=item.id===0?'Every physical key has an explicit assignment.':'Unassigned keys pass through to the layer below.';
  $('#delete-layer').disabled=item.id<=1;
  $('#delete-layer').title=item.id<=1?'Starter layers are fixed in this prototype. Added layers can be deleted.':'';
}
$('#add-layer').addEventListener('click',()=>detail('A new set of possibilities.','Give your layer a purpose. You’ll assign a hold or toggle key to reach it from the keymap.','Symbols',(name)=>{
  if(!name)return toast('Enter a name for your layer.');
  remember();const id=Math.max(...state().layers.map((item)=>item.id))+1;state().layers.push({id,name});layerDetail=id;draftChanged();renderLayers();toast(`${name} added to the draft. Assign an entry key to reach it.`);
},'Add layer'));
$('#rename-layer').addEventListener('click',()=>detail('Name this layer.','Use something you can recognize at a glance: Navigation, Symbols, or Media.',layerName(layerDetail),(name)=>{if(!name)return;remember();state().layers.find((item)=>item.id===layerDetail).name=name;draftChanged();renderLayers();toast('Layer renamed in your draft.');}));
$('#delete-layer').addEventListener('click',()=>{
  if(layerDetail<=1)return;
  if(entryKeys(layerDetail).length){detail('This layer has entry keys.','Remove its hold, toggle, or tap/hold assignments in the keymap before deleting it. This keeps the draft free of broken layer references.');return;}
  detail('Delete this draft layer?',`“${layerName(layerDetail)}” and its assignments will be removed from the draft. You can undo this from the keymap.`,null,()=>{
    remember();state().layers=state().layers.filter((item)=>item.id!==layerDetail);
    Object.keys(state().assignments).filter((id)=>id.startsWith(`${layerDetail}|`)).forEach((id)=>delete state().assignments[id]);
    if(layer===layerDetail)layer=0;layerDetail=0;draftChanged();renderLayers();toast('Layer removed from the draft.');
  },'Delete layer');
});
$('#edit-layer').addEventListener('click',()=>{layer=layerDetail;location.hash='keymap';});

function changeDevice(id){
  device=id;layer=0;selected='Caps';layerDetail=1;$('#action-search').value='';state();
  $('#identify-message').textContent='Ready when you are.';$('#identify-description').textContent='Start the check, then press any key on this keyboard. Only this device can confirm the match.';
  $('#identify-status').textContent='Not started';$('#countdown').textContent='15 seconds';$('#start-identify').textContent='Start identification';
  syncDevice();
}
function syncDevice(){
  $('#keymap-title').textContent=devices[device].name;$('#identify-device').textContent=devices[device].name;
  $$('.device-context').forEach((label)=>label.textContent=`${devices[device].name.toUpperCase()} / ${label.closest('#setup')?'GETTING STARTED':'DRAFT WORKSPACE'}`);
  const connected=runtimeKnown()&&devices[device].connected;
  $$('.editor-availability, #identify-availability').forEach((badge)=>{badge.textContent=!runtimeKnown()?'Status unknown':connected?'Connected':'Disconnected';badge.className=`badge ${connected?'green':'neutral'}${badge.classList.contains('editor-availability')?' editor-availability':''}`;});
  $('#start-identify').disabled=!runtimeKnown()||identifyActive;
  if(!devices[device].connected)$('#start-identify').textContent='Simulate reconnect';
  syncValidationEnvironment();
}
$$('[data-open]').forEach((button)=>button.addEventListener('click',()=>{changeDevice(button.dataset.open);location.hash='keymap';}));
$$('[data-setup]').forEach((button)=>button.addEventListener('click',()=>{changeDevice(button.dataset.setup);location.hash='setup';}));
$$('[data-identify]').forEach((button)=>button.addEventListener('click',()=>{changeDevice(button.dataset.identify);location.hash='identify';}));
$('#setup-identify').addEventListener('click',()=>location.hash='identify');
$('#disconnected-details').addEventListener('click',()=>detail('Logitech MX Keys','This known keyboard is disconnected. Its enabled mapping can resume when the manager sees it again.\n\nThe full-size editor geometry is still a future design. The current prototype explores ANSI 75%.'));
$$('[name="layout"]').forEach((radio)=>radio.addEventListener('change',()=>{
  const label={ansi:'ANSI 75%',iso:'ISO 75%',full:'Full-size ANSI'}[radio.value];$('#setup-selection').textContent=`${label} selected`;
  $('#setup-feedback').textContent=radio.value==='ansi'?'Start with a local draft. No mapping is applied.':'This template is a preview. Choose ANSI 75% to explore the editor.';
  $('#create-draft').disabled=radio.value!=='ansi';
}));
$('#setup-form').addEventListener('submit',(event)=>{event.preventDefault();if($('[name="layout"]:checked').value!=='ansi')return;state();location.hash='keymap';toast('Keyboard draft opened. Nothing has been applied.');});

function finishIdentify(result){
  clearInterval(identifyTimer);identifyActive=false;
  const messages={success:['That’s the one.','This keyboard responded. The manager restores its previous mapping.','Keyboard confirmed'],timeout:['No keypress this time.','The session timed out. The previous mapping is restored; you can try again.','Timed out'],cancelled:['Check cancelled.','The manager restores the selected keyboard’s previous mapping.','Cancelled'],unplug:['Your keyboard disconnected.','Reconnect it to try again. Its enabled mapping can resume when the manager can access it.','Waiting for device']};
  const [title,copy,status]=messages[result];$('#identify-message').textContent=title;$('#identify-description').textContent=copy;$('#identify-status').textContent=status;$('#countdown').textContent='Session ended';
  $('#identify-simulation').hidden=true;$('#cancel-identify').disabled=true;$('#start-identify').textContent=result==='unplug'?'Simulate reconnect':'Try again';
  $('#start-identify').disabled=!runtimeKnown();
}
$('#start-identify').addEventListener('click',()=>{
  if(!runtimeKnown())return;
  if(!devices[device].connected){devices[device].connected=true;syncDevice();$('#start-identify').textContent='Start identification';toast('Keyboard reconnected in the prototype.');return;}
  clearInterval(identifyTimer);let remaining=15;identifyActive=true;
  $('#identify-message').textContent='Press any key now.';$('#identify-description').textContent=`Use ${devices[device].name}. A keypress on this device confirms the match.`;$('#identify-status').textContent='Waiting for a keypress';$('#countdown').textContent='15 seconds';
  $('#start-identify').disabled=true;$('#cancel-identify').disabled=false;$('#identify-simulation').hidden=false;
  identifyTimer=setInterval(()=>{remaining--;$('#countdown').textContent=`${remaining} seconds`;if(!remaining)finishIdentify('timeout');},1000);
});
$('#match-key').addEventListener('click',()=>finishIdentify('success'));
$('#unplug-key').addEventListener('click',()=>{devices[device].connected=false;syncDevice();finishIdentify('unplug');});
$('#cancel-identify').addEventListener('click',()=>finishIdentify('cancelled'));

function syncConnection(){
  const label=$('#connection-label');label.replaceChildren();const dot=document.createElement('i');dot.className='dot';label.append(dot,document.createTextNode(!managerOnline?'Manager unavailable':runtimeKnown()?'Manager connected':'API incomplete'));
  if(!runtimeKnown())dot.style.background='#c0a77b';
  syncDevice();
  $('#external-runtime').textContent=runtimeKnown()?'Running & healthy':'Live status unknown';$('#external-device-status').textContent=runtimeKnown()?'ThinkPad keyboard · Connected':'ThinkPad keyboard · Last known device';
}
function renderDevices(){
  const scenario=$('#device-scenario').value;
  $('#device-inventory').hidden=scenario==='empty';$('#empty-devices').hidden=scenario!=='empty';$('#devices-offline').hidden=managerOnline;
  $$('[data-device-status]').forEach((badge,index)=>{const disconnected=index===2||(index===0&&!devices.q1.connected)||(index===1&&!devices.framework.connected);badge.textContent=!runtimeKnown()?'Last known':disconnected?'Disconnected':'Connected';badge.className=`badge ${runtimeKnown()&&!disconnected?'green':'neutral'}`;});
  $$('[data-runtime]').forEach((item,index)=>{item.textContent=!runtimeKnown()?'Live mapping status unknown':index===0&&!devices.q1.connected?'Waiting to reconnect':index===1&&drafts.has('framework')?'Keyboard draft in this tab · Not applied':item.dataset.runtime;});
  $$('[data-identify]').forEach((button)=>button.disabled=!runtimeKnown()||!devices[button.dataset.identify].connected);
  const connected=1+Number(devices.q1.connected)+Number(devices.framework.connected);
  $('#device-count').textContent=runtimeKnown()?`${connected} connected · 4 known`:'4 last-known devices';
}
$('#device-scenario').addEventListener('change',()=>{managerOnline=$('#device-scenario').value!=='offline';$('#diagnostic-scenario').value=managerOnline?'permission':'offline';syncConnection();renderDevices();});
$$('[data-offline-details]').forEach((link)=>link.addEventListener('click',()=>$('#diagnostic-scenario').value='offline'));
function renderDiagnostics(){
  const choice=$('#diagnostic-scenario').value;
  const values={
    permission:['Manager connected','2 healthy','1 device','Action needed','Framework keyboard needs input access.','The manager can see this keyboard, but cannot open it.','Complete the manager’s input-access setup. If your group membership changed, sign out and back in, then refresh these checks.','device_inaccessible · Framework keyboard'],
    healthy:['Manager connected','2 healthy','All clear','Ready','Your connected keyboards are ready.','The manager reports healthy mappings with no blocking diagnostics.','Keep editing. Known-disconnected keyboards resume their enabled mappings when they become available.','No blocking diagnostics · illustrative snapshot'],
    offline:['Manager unavailable','Unknown','Connection required','Unavailable','We can’t reach your manager.','Device availability and mapping health cannot be confirmed right now. Last-known data is not live state.','Check that the manager is installed and running for this user, then reconnect. Keyboard drafts remain editable here.','Connection failed · client state'],
    incomplete:['Connected · API incomplete','Unknown','Manager update needed','Unsupported','This manager can’t report enough state yet.','A capability or snapshot request returned unsupported_capability. Dependent actions stay unavailable.','Use a compatible manager build. The application does not substitute logs, CLI output, or private files for API state.','unsupported_capability · API state'],
  };
  const selectors=['#health-connection','#health-mappings','#health-attention','#finding-badge','#finding-title','#finding-copy','#finding-remedy','#finding-code'];
  selectors.forEach((selector,index)=>$(selector).textContent=values[choice][index]);
  const unknown=['offline','incomplete'].includes(choice);
  $('#healthy-checks').hidden=unknown;$('#health-connection-note').textContent=choice==='offline'?'Local connection unavailable':choice==='incomplete'?'Required methods unavailable':'Same-user local connection';
  $('#health-mappings-note').textContent=unknown?'Live state cannot be confirmed':'Independent of this window';$('#health-attention-note').textContent=choice==='healthy'?'Nothing needs your attention':unknown?'Drafts remain available':'Input access needs a check';
  $('#finding').classList.toggle('healthy',choice==='healthy');$('#finding-icon').textContent=choice==='healthy'?'✓':'!';$('#finding-badge').className=`badge ${choice==='healthy'?'green':'amber'}`;
  $('#diagnostic-count').hidden=choice==='healthy';$('#diagnostic-count').textContent=unknown?'!':'1';
}
$('#diagnostic-scenario').addEventListener('change',()=>{managerOnline=$('#diagnostic-scenario').value!=='offline';$('#device-scenario').value=managerOnline?'normal':'offline';syncConnection();renderDiagnostics();});
$('#refresh-checks').addEventListener('click',()=>{renderDiagnostics();toast('Example checks refreshed. Select a preview state to explore another result.');});
$('#technical-details').addEventListener('click',()=>detail('The details, if you need them.',`Finding: ${$('#finding-code').textContent}\n\nProtocol: API v1\nSource: simulated manager state\n\nThe application will display structured resource IDs, reason codes, and remediation. This prototype does not read system information.`));
function route(){
  const requested=location.hash.slice(1)||'keyboards';
  const allowed=['keyboards','setup','identify','keymap','layers','diagnostics','external'];const next=allowed.includes(requested)?requested:'keyboards';
  if(currentPage==='identify'&&next!=='identify'&&identifyActive)finishIdentify('cancelled');
  currentPage=next;
  $$('.page').forEach((page)=>page.hidden=page.id!==next);$('#preview-page').value=next;
  $$('[data-nav]').forEach((link)=>{const active=link.dataset.nav===(next==='diagnostics'?'diagnostics':'keyboards');link.classList.toggle('active',active);if(active)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');});
  syncConnection();
  if(next==='keyboards')renderDevices();
  if(next==='keymap')renderEditor();
  if(next==='layers')renderLayers();
  if(next==='diagnostics')renderDiagnostics();
  const title=$(`#${next}-title`);title.focus({preventScroll:true});document.title=`KeyboarDeer · ${title.textContent}`;
  window.scrollTo({top:0,behavior:'instant'});
}
$('#preview-page').addEventListener('change',()=>location.hash=$('#preview-page').value);
window.addEventListener('hashchange',route);
miniBoards();buildActions();initializeValidation();route();
