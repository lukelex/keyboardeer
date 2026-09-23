// Low-fidelity interaction model only; assignments never reach a real keyboard.
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const context = new URLSearchParams(location.search);
const deviceName = context.get('device') || 'Keychron Q1';
const profileName = context.get('profile') || 'Everyday';
const freshProfile = context.get('fresh') === '1';
$('#editor-device-name').textContent = deviceName;
$('#editor-profile-name').textContent = `${profileName} profile`;
$('#editor-review-profile').textContent = `${profileName.toUpperCase()} / DRAFT REVIEW`;
const names = {
  Esc: 'Escape', Caps: 'Caps Lock', Bksp: 'Backspace', Ctrl: 'Left Control',
  RCtrl: 'Right Control', Shift: 'Left Shift', RShift: 'Right Shift',
  Alt: 'Left Alt', RAlt: 'Right Alt', Super: 'Left Super', RSuper: 'Right Super',
  Del: 'Delete', PgUp: 'Page Up', PgDn: 'Page Down', Ins: 'Insert',
  '↑': 'Up arrow', '←': 'Left arrow', '↓': 'Down arrow', '→': 'Right arrow',
};
const basicRows = [
  ['Esc', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12'],
  ['`', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '=', ['Bksp', 2]],
  [['Tab', 1.5], 'Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P', '[', ']', ['\\', 1.5]],
  [['Caps', 1.8], 'A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', ';', "'", ['Enter', 2.2]],
  [['Shift', 2.2], 'Z', 'X', 'C', 'V', 'B', 'N', 'M', ',', '.', '/', ['RShift', 2.8]],
  [['Ctrl', 1.3], ['Super', 1.3], ['Alt', 1.3], ['Space', 6], 'RAlt', 'RSuper', 'Menu', 'RCtrl'],
];
const physicalRows = basicRows.map((row) => [...row]);
physicalRows[0].push('Del');
physicalRows[1].push('Home');
physicalRows[2].push('PgUp');
physicalRows[3].push('PgDn');
physicalRows[4] = [...basicRows[4].slice(0, -1), ['RShift', 1.8], '↑', 'End'];
physicalRows[5] = [['Ctrl', 1.3], ['Super', 1.3], ['Alt', 1.3], ['Space', 6], 'RAlt', 'Fn', 'RCtrl', '←', '↓', '→'];
const navigation = ['Ins', 'Home', 'PgUp', 'Del', 'End', 'PgDn', 'Print Screen', 'Scroll Lock', 'Pause'];
const arrows = ['↑', '←', '↓', '→'];
const numpad = ['Num Lock', 'KP /', 'KP *', 'KP −', 'KP 7', 'KP 8', 'KP 9', 'KP +', 'KP 4', 'KP 5', 'KP 6', 'KP Enter', 'KP 1', 'KP 2', 'KP 3', 'KP .', 'KP 0'];
const actions = new Map();
function register(id, label, category, description, short = label) {
  const action = { id, label, category, description, short };
  actions.set(id, action);
  return action;
}
function keyName(key) { return names[key] || key; }
function rowEntry(entry) { return Array.isArray(entry) ? entry : [entry, 1]; }
const basicKeys = basicRows.flatMap((row) => row.map((entry) => rowEntry(entry)[0]));
for (const key of new Set([...basicKeys, ...navigation, ...arrows, ...numpad])) {
  register(key, keyName(key), 'Basic', `Send ${keyName(key)} when pressed.`, key);
}
// The physical Fn position maps to a layer action, not a universal sendable key.
const modifiers = ['Ctrl', 'Shift', 'Alt', 'Super', 'RCtrl', 'RShift', 'RAlt', 'RSuper'];
register('hold-nav', 'Hold for Navigation', 'Layers', 'Use layer 1 while this key is held. Release to return.', 'Hold L1');
register('toggle-nav', 'Toggle Navigation', 'Layers', 'Switch layer 1 on or off with a press.', 'Toggle L1');
register('to-base', 'Go to Base', 'Layers', 'Return to layer 0.', 'Base L0');
register('transparent', 'Pass through', 'Layers', 'Use the assignment from the layer below. Available on Navigation.', '▽');
register('disabled', 'Do nothing', 'Layers', 'Disable this key on the selected layer.', 'None');
for (const label of ['Play / pause', 'Next track', 'Previous track', 'Stop playback', 'Volume up', 'Volume down', 'Mute', 'Brightness up', 'Brightness down']) {
  register(label, label, 'Media & system', `${label}. Support depends on the runtime and operating system.`);
}
register('esc-ctrl', 'Escape / Control', 'Tap & hold', 'Tap for Escape; hold for Left Control.', 'Esc / Ctrl');
register('space-nav', 'Space / Navigation', 'Tap & hold', 'Tap for Space; hold for Navigation layer.', 'Space / L1');
register('enter-shift', 'Enter / Shift', 'Tap & hold', 'Tap for Enter; hold for Left Shift.', 'Enter / Shift');
register('tab-alt', 'Tab / Alt', 'Tap & hold', 'Tap for Tab; hold for Left Alt.', 'Tab / Alt');

let layer = 'Base';
let selected = 'Caps';
let category = 'Basic';
let draft = {};
const history = [];
function address(key = selected) { return `${layer}:${key}`; }
function original(key, keyLayer = layer) {
  const navigationMap = { H: '←', J: '↓', K: '↑', L: '→', Fn: 'to-base' };
  if (keyLayer === 'Navigation') return navigationMap[key] || 'transparent';
  return key === 'Fn' ? 'hold-nav' : key;
}
function originalAt(id) { const [keyLayer, key] = id.split(':'); return original(key, keyLayer); }
function current(key = selected) { return draft[address(key)] || original(key); }
function actionLabel(id) { return actions.get(id)?.label || keyName(id); }
function changed() { return Object.keys(draft).filter((id) => draft[id] !== originalAt(id)); }

function renderKeyboard() {
  $('#physical-keyboard').replaceChildren();
  physicalRows.forEach((row, index) => {
    const line = document.createElement('div'); line.className = 'key-row';
    row.forEach((entry) => {
      const [key, width] = rowEntry(entry);
      const value = current(key);
      const edited = value !== original(key);
      const button = document.createElement('button');
      button.className = `physical-key ${index === 0 ? 'function' : ''} ${key === selected ? 'selected' : ''} ${edited ? 'edited' : ''}`;
      button.style.setProperty('--width', width);
      button.dataset.key = key;
      button.setAttribute('aria-pressed', String(key === selected));
      button.setAttribute('aria-label', `${keyName(key)}: ${actionLabel(value)}${edited ? ', changed in draft' : ''}`);
      button.textContent = actions.get(value)?.short || key;
      if (edited) { const originalLabel = document.createElement('span'); originalLabel.className = 'original-label'; originalLabel.textContent = keyName(key); button.append(originalLabel); }
      button.addEventListener('click', () => {
        selected = key; render();
        // Keep keyboard focus on the selected source key after re-rendering.
        $$('.physical-key').find((item) => item.dataset.key === selected)?.focus({ preventScroll: true });
      });
      line.append(button);
    });
    $('#physical-keyboard').append(line);
  });
}
function assign(id) {
  if (id === 'transparent' && layer === 'Base') return;
  if (id === current()) return;
  history.push({ ...draft });
  draft[address()] = id;
  renderKeyboard(); renderSummary(); updatePaletteSelection();
  $('#draft-status').textContent = `${keyName(selected)} → ${actionLabel(id)} saved to draft. Running mapping unchanged.`;
}
function actionButton(id, tile = false) {
  const action = actions.get(id);
  const button = document.createElement('button');
  button.className = tile ? 'action-tile' : 'palette-key';
  button.dataset.action = id;
  button.setAttribute('aria-label', `Assign ${action.label} to selected key`);
  button.setAttribute('aria-pressed', String(current() === id));
  button.title = action.description;
  button.disabled = id === 'transparent' && layer === 'Base';
  if (tile) {
    const name = document.createElement('strong'); name.textContent = action.label;
    const detail = document.createElement('small'); detail.textContent = action.category === 'Tap & hold' ? 'Tap / hold' : action.category;
    button.append(name, detail);
  } else button.textContent = action.short;
  button.addEventListener('click', () => assign(id));
  const describe = () => { $('#action-description').textContent = `${action.label} — ${action.description}`; };
  button.addEventListener('mouseenter', describe); button.addEventListener('focus', describe);
  return button;
}
function group(label) {
  const wrapper = document.createElement('div');
  const title = document.createElement('h3'); title.className = 'group-heading'; title.textContent = label;
  wrapper.append(title); return wrapper;
}
function renderBasic() {
  const layout = document.createElement('div'); layout.className = 'basic-palette';
  const main = group('LETTERS, NUMBERS & EVERYDAY KEYS');
  basicRows.forEach((row) => {
    const line = document.createElement('div'); line.className = 'palette-row';
    row.forEach((entry) => { const [id, width] = rowEntry(entry); const button = actionButton(id); button.style.setProperty('--width', width); line.append(button); });
    main.append(line);
  });
  const nav = group('NAVIGATION'); const navGrid = document.createElement('div'); navGrid.className = 'utility-grid';
  navigation.forEach((id) => navGrid.append(actionButton(id))); nav.append(navGrid);
  const arrowGrid = document.createElement('div'); arrowGrid.className = 'arrow-grid';
  arrows.forEach((id, index) => { const button = actionButton(id); if (!index) { button.style.gridColumn = '2'; button.style.gridRow = '1'; } else button.style.gridRow = '2'; arrowGrid.append(button); }); nav.append(arrowGrid);
  const pad = group('NUMPAD'); const padGrid = document.createElement('div'); padGrid.className = 'numpad-grid';
  numpad.forEach((id) => { const button = actionButton(id); button.textContent = id.replace('KP ', ''); padGrid.append(button); }); pad.append(padGrid);
  layout.append(main, nav, pad); $('#palette').append(layout);
}
function renderPalette() {
  const query = $('#key-search').value.trim().toLowerCase();
  $('#palette').replaceChildren();
  const available = [...actions.values()].filter((action) => query ? `${action.label} ${action.short} ${action.category} ${action.description}`.toLowerCase().includes(query) : category === 'Modifiers' ? modifiers.includes(action.id) : action.category === category);
  $('#option-count').textContent = `${available.length} ${query ? 'matches · all categories' : 'options'}`;
  if (!query && category === 'Basic') renderBasic();
  else if (!available.length) {
    const empty = document.createElement('p'); empty.className = 'empty-state'; empty.textContent = 'No actions match. Try a key name, “volume”, or “layer”.'; $('#palette').append(empty);
  } else {
    const descriptions = {
      Modifiers: 'Choose the left or right modifier explicitly.',
      Layers: 'Reach another layer, return to Base, or inherit the assignment below.',
      'Media & system': 'Playback, volume, and brightness controls. Availability depends on the manager.',
      'Tap & hold': 'Quick-start combinations: the first action happens on tap, the second while held. Custom behaviors and timing are follow-up designs.',
    };
    const description = document.createElement('p'); description.className = 'category-description'; description.textContent = query ? 'Results across all categories. Click an action to assign it.' : descriptions[category];
    const grid = document.createElement('div'); grid.className = 'action-grid'; available.forEach((action) => grid.append(actionButton(action.id, true)));
    $('#palette').append(description, grid);
  }
  updatePaletteSelection();
}
function updatePaletteSelection() { $$('[data-action]').forEach((button) => { button.setAttribute('aria-pressed', String(button.dataset.action === current())); button.disabled = button.dataset.action === 'transparent' && layer === 'Base'; }); }
function renderSummary() {
  $('#selected-name').textContent = keyName(selected);
  $('#selected-assignment').textContent = actionLabel(current());
  $('#selected-layer').textContent = `${layer} layer`;
  const count = changed().length;
  $('#draft-count').textContent = count ? `${count} ${count === 1 ? 'change' : 'changes'} in draft` : 'No changes in draft';
  $('#draft-status').textContent = freshProfile ? 'New profile draft. Nothing has been applied.' : `${profileName} is active. Your running mapping is unchanged.`;
  $('#undo').disabled = !history.length; $('#review').disabled = !count;
  $('#restore-key').disabled = current() === original(selected);
}
function render() { renderKeyboard(); renderSummary(); renderPalette(); }
function tabs(selector, onSelect) {
  const buttons = $$(selector);
  function choose(button) {
    buttons.forEach((tab) => { tab.setAttribute('aria-selected', String(tab === button)); tab.tabIndex = tab === button ? 0 : -1; });
    onSelect(button);
  }
  buttons.forEach((button, index) => {
    button.addEventListener('click', () => choose(button));
    button.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
      choose(buttons[next]); buttons[next].focus();
    });
  });
}
tabs('[data-layer]', (button) => { layer = button.dataset.layer; render(); });
tabs('[data-category]', (button) => { category = button.dataset.category; $('#key-search').value = ''; renderPalette(); });
$('#key-search').addEventListener('input', renderPalette);
document.addEventListener('keydown', (event) => {
  if (event.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName) && !event.ctrlKey && !event.metaKey && !event.altKey && !$('#review-dialog').open) { event.preventDefault(); $('#key-search').focus(); }
});
$('#restore-key').addEventListener('click', () => assign(original(selected)));
$('#undo').addEventListener('click', () => { if (history.length) { draft = history.pop(); render(); $('#draft-status').textContent = 'Last assignment undone. Running mapping unchanged.'; } });
$('#review').addEventListener('click', () => {
  $('#review-list').replaceChildren();
  changed().forEach((id) => {
    const [keyLayer, key] = id.split(':'); const row = document.createElement('div'); row.className = 'review-change';
    const title = document.createElement('strong'); title.textContent = `${keyName(key)} · ${keyLayer} layer`;
    const detail = document.createElement('p'); detail.textContent = `${actionLabel(originalAt(id))} → ${actionLabel(draft[id])}`;
    row.append(title, detail); $('#review-list').append(row);
  });
  $('#review-dialog').showModal();
});
$('#close-review').addEventListener('click', () => $('#review-dialog').close());
render();
