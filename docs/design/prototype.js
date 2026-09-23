// Design-only simulation. No manager, filesystem, or input-device access.
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const rows = [
  ['Esc', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12', 'Del'],
  ['`', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '=', ['Backspace', 2], 'Home'],
  [['Tab', 1.5], 'Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P', '[', ']', ['\\', 1.5], 'PgUp'],
  [['Caps', 1.8], 'A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', ';', "'", ['Enter', 2.2], 'PgDn'],
  [['Shift', 2.2], 'Z', 'X', 'C', 'V', 'B', 'N', 'M', ',', '.', '/', ['RShift', 1.8], '↑', 'End'],
  [['Ctrl', 1.3], ['Super', 1.3], ['Alt', 1.3], ['Space', 6], 'RAlt', 'Fn', 'RCtrl', '←', '↓', '→'],
];
const names = { Caps: 'Caps Lock', Esc: 'Escape', Ctrl: 'Control', RCtrl: 'Right Control', RShift: 'Right Shift', RAlt: 'Right Alt', '↑': 'Up', '↓': 'Down', '←': 'Left', '→': 'Right' };
const profiles = new Map();
let device = 'Keychron Q1';
let layer = 'Base';
let selected = 'Caps';
let scenario = 'normal';
let toastTimer;
let identifyTimer;
let validationTimer;
let applying = false;
function profile() {
  if (!profiles.has(device)) profiles.set(device, { name: device === 'Logitech MX Keys' ? 'Work' : 'Everyday', draft: {}, active: {}, history: [], fresh: device === 'Framework keyboard' });
  return profiles.get(device);
}
function original(key, keyLayer = layer) {
  const navigation = { H: 'Left', J: 'Down', K: 'Up', L: 'Right' };
  return { behavior: 'single', tap: keyLayer === 'Navigation' ? navigation[key] || names[key] || key : names[key] || key, hold: 'Control' };
}
function identity(key = selected) { return `${layer}:${key}`; }
function assignment(id, source) { const [keyLayer, key] = id.split(':'); return source[id] || original(key, keyLayer); }
function equal(a, b) { return a.behavior === b.behavior && a.tap === b.tap && (a.behavior !== 'dual' || a.hold === b.hold); }
function changes() { const p = profile(); return [...new Set([...Object.keys(p.draft), ...Object.keys(p.active)])].filter((id) => !equal(assignment(id, p.draft), assignment(id, p.active))); }
function describe(value) { return value.behavior === 'dual' ? `Tap ${value.tap} / Hold ${value.hold}` : value.tap; }
function disconnected() { return scenario === 'blocked' || device === 'Logitech MX Keys'; }
function toast(message) { clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').hidden = false; toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 4500); }
function option(select, value) { if (![...select.options].some((item) => item.value === value)) select.add(new Option(value, value)); select.value = value; }

$$('[data-mini]').forEach((art) => {
  art.setAttribute('aria-hidden', 'true');
  for (let row = 0; row < 5; row++) {
    const line = document.createElement('div'); line.className = 'mini-row';
    for (let key = 0; key < (row === 4 ? 8 : 13); key++) { const cap = document.createElement('span'); cap.className = 'mini-key'; line.append(cap); }
    art.append(line);
  }
});
function renderKeyboard() {
  $('#keyboard').replaceChildren();
  rows.forEach((row, index) => {
    const line = document.createElement('div'); line.className = 'key-row';
    row.forEach((entry) => {
      const [key, width] = Array.isArray(entry) ? entry : [entry, 1];
      const button = document.createElement('button'); const id = identity(key);
      const value = assignment(id, profile().draft);
      const edited = changes().includes(id);
      button.className = `key ${key.length > 1 ? 'modifier' : ''} ${index === 0 ? 'function' : ''} ${key === 'Esc' ? 'escape' : ''} ${selected === key ? 'selected' : ''} ${edited ? 'edited' : ''}`;
      button.style.setProperty('--key-width', width);
      button.textContent = key === 'Space' ? '' : key === 'Backspace' ? '⌫' : key === 'RShift' ? 'Shift' : key === 'RCtrl' ? 'Ctrl' : key === 'RAlt' ? 'Alt' : key;
      button.setAttribute('aria-label', `${names[key] || key}: ${describe(value)}${edited ? ', changed in draft' : ''}`);
      button.setAttribute('aria-pressed', String(selected === key));
      if (layer === 'Navigation' && ['H', 'J', 'K', 'L'].includes(key)) button.textContent = value.tap;
      button.addEventListener('click', () => { selected = key; renderKeyboard(); loadInspector(); });
      line.append(button);
    }); $('#keyboard').append(line);
  });
}
function loadInspector() {
  const value = assignment(identity(), profile().draft);
  $('#selected-key-name').textContent = names[selected] || selected;
  $('#key-preview').textContent = selected;
  $('#key-position').textContent = `${layer} layer`;
  $('#behavior').value = value.behavior; option($('#tap-key'), value.tap); option($('#hold-key'), value.hold);
  describeInspector();
}
function describeInspector() {
  const dual = $('#behavior').value === 'dual';
  $('#hold-field').hidden = !dual;
  $('#tap-label').textContent = dual ? 'On tap · A quick press' : 'Send this key';
  $('#behavior-description').textContent = dual ? `Tap for ${$('#tap-key').value}. Hold for ${$('#hold-key').value}.` : `Press to send ${$('#tap-key').value}.`;
}
function renderDraft() {
  const count = changes().length;
  $('#draft-title').textContent = count ? `${count} ${count === 1 ? 'change' : 'changes'} in your draft` : profile().fresh ? 'Your new profile is a draft' : 'Your draft is up to date';
  $('#draft-subtitle').textContent = scenario === 'offline' ? 'Manager unavailable. Live mapping status is unknown.' : disconnected() ? 'Reconnect this keyboard to apply your changes.' : scenario === 'limited' ? 'This manager does not support applying profiles yet.' : profile().fresh ? 'Nothing is active until you apply this profile.' : 'The current mapping is still running.';
  $('#draft-indicator').classList.toggle('pending', count > 0 || profile().fresh);
  $('#undo-button').disabled = !profile().history.length;
  $('#review-button').disabled = (!count && !profile().fresh) || scenario === 'offline' || scenario === 'limited';
  $('#identify-button').disabled = disconnected() || scenario === 'offline' || scenario === 'limited';
  const status = $('#active-status');
  status.textContent = scenario === 'offline' ? 'Live status unknown' : disconnected() ? 'Waiting for keyboard' : profile().fresh ? 'Draft · not active yet' : '● Active on this keyboard';
  $('#editor-connection').textContent = scenario === 'offline' ? 'Status unknown' : disconnected() ? 'Disconnected' : 'Connected';
  $('#editor-connection').className = `badge ${disconnected() || scenario === 'offline' ? 'neutral' : 'green'}`;
}
function renderEditor() {
  $('#device-name').textContent = device; $('#profile-name').textContent = profile().name;
  $('#device-nav span:last-child').textContent = device;
  $('#layout-label').textContent = device === 'Keychron Q1' ? 'ANSI · 75%' : 'Illustrative 75% canvas';
  renderKeyboard(); renderDraft(); loadInspector();
}
function route() {
  const editing = location.hash === '#editor';
  $('#devices-screen').hidden = editing; $('#editor-screen').hidden = !editing; $('#device-nav').hidden = !editing;
  $('#breadcrumb').textContent = editing ? `Keyboards / ${device} / ${profile().name}` : 'Workspace / Keyboards';
  if (editing) renderEditor();
}
function openDevice(name) {
  device = name; layer = 'Base'; selected = 'Caps'; setLayer('Base');
  // Render once: a second hashchange render could overwrite inspector edits.
  if (location.hash === '#editor') route();
  else location.hash = 'editor';
}
$$('[data-open-device]').forEach((button) => button.addEventListener('click', () => {
  if (button.dataset.openDevice === 'Framework keyboard' && !profiles.has('Framework keyboard')) { $('#setup-dialog').showModal(); return; }
  openDevice(button.dataset.openDevice);
}));
$('#create-profile').addEventListener('click', () => {
  if ($('#setup-layout').value !== 'ANSI · 75%') { toast('The prototype includes ANSI only. Choose ANSI to explore the editor.'); return; }
  device = 'Framework keyboard'; profile().name = $('#setup-name').value.trim() || 'Everyday'; $('#setup-dialog').close(); openDevice(device); toast('Draft created in this prototype tab.');
});
function setLayer(next) {
  layer = next;
  $$('[data-layer]').forEach((tab) => tab.setAttribute('aria-selected', String(tab.dataset.layer === layer)));
  $('#layer-description').textContent = layer === 'Base' ? 'Base layer is your everyday layout. Start here, make it yours.' : 'Navigation maps H J K L to arrows. Assign “Navigation layer” to a hold action to reach it.';
  renderKeyboard(); loadInspector();
}
$$('[data-layer]').forEach((tab) => tab.addEventListener('click', () => setLayer(tab.dataset.layer)));
$('.layer-tabs').addEventListener('keydown', (event) => { if (['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); setLayer(layer === 'Base' ? 'Navigation' : 'Base'); $(`[data-layer="${layer}"]`).focus(); } });
['#behavior', '#tap-key', '#hold-key'].forEach((selector) => $(selector).addEventListener('change', describeInspector));
function saveAssignment(value) { const p = profile(); p.history.push(structuredClone(p.draft)); p.draft[identity()] = value; renderKeyboard(); renderDraft(); }
$('#save-key').addEventListener('click', () => { saveAssignment({ behavior: $('#behavior').value, tap: $('#tap-key').value, hold: $('#hold-key').value }); toast(`${names[selected] || selected} saved to your draft. Not live yet.`); });
$('#reset-key').addEventListener('click', () => { saveAssignment(original(selected)); loadInspector(); toast('Original key restored in the draft.'); });
$('#undo-button').addEventListener('click', () => { const previous = profile().history.pop(); if (previous) profile().draft = previous; renderEditor(); toast('Last draft edit undone.'); });
function validation(title, message, warning = false) { const result = $('#validation-result'); result.replaceChildren(); const strong = document.createElement('strong'); strong.textContent = title; result.append(strong, document.createTextNode(message)); result.classList.toggle('warning', warning); }
$('#review-button').addEventListener('click', () => {
  const ids = changes(); $('#review-device').textContent = `${device} / ${profile().name}`.toUpperCase();
  $('#review-summary').textContent = ids.length ? `${ids.length} ${ids.length === 1 ? 'change' : 'changes'} before your next keystroke.` : 'Create this profile with its original key assignments.';
  $('#review-changes').replaceChildren();
  ids.forEach((id) => {
    const [keyLayer, key] = id.split(':'); const row = document.createElement('div'); row.className = 'change-row';
    const cap = document.createElement('div'); cap.className = 'key-preview'; cap.textContent = key;
    const copy = document.createElement('div'); const title = document.createElement('strong'); title.textContent = names[key] || key;
    const description = document.createElement('p'); description.textContent = `${describe(assignment(id, profile().active))} → ${describe(assignment(id, profile().draft))}`;
    copy.append(title, description); const layerLabel = document.createElement('span'); layerLabel.className = 'change-layer'; layerLabel.textContent = keyLayer;
    row.append(cap, copy, layerLabel); $('#review-changes').append(row);
  });
  $('#apply-button').disabled = true; $('#apply-button').textContent = 'Checking…';
  validation('Checking your changes…', 'Simulating manager validation.'); $('#review-dialog').showModal();
  validationTimer = setTimeout(() => {
    if (disconnected()) validation('Waiting for your keyboard', 'Your draft is safe. Reconnect the keyboard, then review again.', true);
    else if (scenario === 'rejected') validation('This draft needs another look', 'The candidate was rejected. Keep editing to correct the assignment; the active mapping is unchanged.', true);
    else validation('✓ Validation passed', 'Your changes are ready. The manager will check again before applying.');
    $('#apply-button').disabled = disconnected() || scenario === 'rejected'; $('#apply-button').textContent = 'Apply to keyboard';
  }, 600);
});
$('#apply-button').addEventListener('click', () => {
  applying = true; $('#apply-button').disabled = true; $('#apply-button').textContent = 'Applying…';
  validation('Applying your changes…', 'Confirming that the new mapping is healthy.');
  setTimeout(() => {
    applying = false;
    if (scenario === 'rollback') { validation('Previous mapping restored', 'Activation failed. Your working mapping is back; this draft is kept so you can edit and retry.', true); $('#apply-button').textContent = 'Retry apply'; $('#apply-button').disabled = false; return; }
    profile().active = structuredClone(profile().draft); profile().history = []; profile().fresh = false;
    $('#review-dialog').close(); renderEditor(); toast(`${profile().name} is active on ${device}. Simulated successfully.`);
  }, 800);
});
$('#review-dialog').addEventListener('cancel', (event) => { if (applying) event.preventDefault(); });
$('#review-dialog').addEventListener('close', () => clearTimeout(validationTimer));
$('#identify-button').addEventListener('click', () => {
  let seconds = 15; $('#identify-timer').textContent = '15s'; $('#identify-description').textContent = `Press any key on ${device} to confirm it.`;
  $('#identify-dialog').showModal(); identifyTimer = setInterval(() => { seconds--; $('#identify-timer').textContent = `${seconds}s`; if (!seconds) { $('#identify-dialog').close(); toast('Identification timed out. The previous mapping is restored.'); } }, 1000);
});
$('#identify-dialog').addEventListener('close', () => clearInterval(identifyTimer));
$('#simulate-key').addEventListener('click', () => { $('#identify-dialog').close(); toast(`That’s ${device}. Mapping restored.`); });
$('#cancel-identify').addEventListener('click', () => { $('#identify-dialog').close(); toast('Identification cancelled. Mapping restored.'); });
$$('.close-dialog, .close-review, .close-help, .close-setup').forEach((button) => button.addEventListener('click', () => { if (applying && button.closest('dialog').id === 'review-dialog') return; button.closest('dialog').close(); }));
$('#help-button').addEventListener('click', () => $('#help-dialog').showModal());
$('#scenario').addEventListener('change', () => {
  scenario = $('#scenario').value;
  const banner = $('#connection-banner'); banner.hidden = scenario === 'normal';
  const messages = { offline: 'Manager unavailable. Device information below is last known; current mapping health cannot be confirmed.', blocked: 'Keychron Q1 is disconnected. Keep editing your draft; reconnect before applying.', rejected: 'Demo: preview validation will reject the next draft. The active mapping stays running.', rollback: 'Demo: the next apply will fail and restore the previous mapping.', limited: 'Read-only manager. You can explore profiles, but identification and applying are unavailable in this scenario.' };
  banner.textContent = messages[scenario] || '';
  $('.service div').textContent = scenario === 'offline' ? 'Manager unavailable' : 'Manager connected';
  $$('.device-card .badge').forEach((badge, index) => { const absent = index === 2 || (index === 0 && scenario === 'blocked'); badge.textContent = scenario === 'offline' ? 'Status unknown' : absent ? 'Disconnected' : 'Connected'; badge.className = `badge ${absent || scenario === 'offline' ? 'neutral' : 'green'}`; });
  $('.featured .mapping-label').textContent = scenario === 'offline' ? 'Everyday · Last known profile' : scenario === 'blocked' ? 'Everyday · Waiting for keyboard' : '● Everyday profile active';
  $('.count-label').textContent = scenario === 'offline' ? '3 last-known devices' : `${scenario === 'blocked' ? 1 : 2} connected · 3 known`;
  renderDraft();
});
window.addEventListener('hashchange', route);
route();
