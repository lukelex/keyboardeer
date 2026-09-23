// Linked design fixtures. No API calls, file writes, or real keyboard changes.
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const pageNames = ['keyboards', 'setup', 'identify', 'profiles', 'layers', 'review', 'diagnostics', 'external'];
const annotations = {
  keyboards: ['A device list, not a dashboard.', 'Connection and mapping health are separate. Known-disconnected devices stay visible. Empty and unavailable-manager states explain a useful next step.'],
  setup: ['Choose geometry before editing behavior.', 'The bottom panel names the new profile and explains that it is only a draft. Exact laptop and custom geometry need templates; product names are not a reliable layout detector.'],
  identify: ['A bounded check with a clear ending.', 'Identify only the selected device. Show waiting, success, timeout, cancellation, and disconnect explicitly; the affected mapping resumes afterward.'],
  profiles: ['Saved does not mean active.', 'Profiles live in the GUI; the manager reports what is running. Opening another profile is an editing action. Activating it goes through review and validation.'],
  layers: ['Keep layers reachable.', 'The layer list sits above contextual settings, echoing the keyboard-over-palette editor. Show the entry key and fall-through behavior; flag new layers until an entry action exists.'],
  review: ['Fast draft edits, deliberate activation.', 'Compare the active mapping with the draft. Blocked, rejected, stale, applied, and rolled-back results have different explanations. The examples here use a fixed two-change fixture, not the separate editor’s in-memory draft.'],
  diagnostics: ['Explain the problem next to its remedy.', 'Prefer actionable manager-provided findings to logs or technical identifiers. If disconnected, replace live health with unknown state. Never claim cached mappings are still healthy.'],
  external: ['Show ownership before offering editing.', 'External configuration remains manager-supervised and read-only. Viewing does not imply adoption, disablement, or rewrite. Raw source display depends on a future manager API method.'],
};
let activePage = '';
let setupDevice = 'Keychron Q1';
let identifyTimer;
let identifyActive = false;
let remaining = 15;
let toastTimer;
let applyTimer;
let reviewPhase = 'idle';
let baselineRevision = 6;
let reviewProfile = 'Everyday';
let dialogSave;
let selectedLayer = 'navigation';

function toast(message) {
  clearTimeout(toastTimer); $('#flow-toast').textContent = message; $('#flow-toast').hidden = false;
  toastTimer = setTimeout(() => { $('#flow-toast').hidden = true; }, 4000);
}
function editorURL(device = 'Keychron Q1', profile = 'Everyday', fresh = false) {
  const params = new URLSearchParams({ device, profile });
  if (fresh) params.set('fresh', '1');
  return `low-fidelity-palette.html?${params}`;
}
function route() {
  const requested = location.hash.slice(1) || 'keyboards';
  const next = pageNames.includes(requested) ? requested : 'keyboards';
  if (activePage === 'identify' && next !== 'identify' && identifyActive) finishIdentify('cancelled');
  activePage = next;
  const connectionState = next === 'diagnostics' ? $('#diagnostics-state').value : next === 'keyboards' ? $('#devices-state').value : 'normal';
  $('.manager-link').textContent = connectionState === 'offline' ? '○ Manager unavailable' : connectionState === 'incomplete' ? '○ API incomplete' : '● Manager connected';
  $$('.flow-page').forEach((page) => { page.hidden = page.id !== next; });
  $$('.screen-index a').forEach((link) => { if (link.hash === `#${next}`) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current'); });
  const nav = next === 'profiles' ? 'profiles' : next === 'diagnostics' ? 'diagnostics' : 'keyboards';
  $$('[data-nav]').forEach((link) => { if (link.dataset.nav === nav) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current'); });
  $('#annotation-title').textContent = annotations[next][0]; $('#annotation-copy').textContent = annotations[next][1];
  $(`#${next}-title`).focus({ preventScroll: true });
  document.title = `KeyboarDeer · ${$(`#${next}-title`).textContent} · Wireframe`;
}
function detail(title, copy, field = null, onSave = null) {
  $('#detail-title').textContent = title; $('#detail-copy').textContent = copy;
  $('#detail-field').hidden = field === null; $('#detail-save').hidden = !onSave;
  $('#detail-input').value = field || ''; dialogSave = onSave;
  $('#detail-dialog').showModal();
}
$('#detail-dialog').addEventListener('close', () => {
  if ($('#detail-dialog').returnValue === 'save' && dialogSave) dialogSave($('#detail-input').value.trim());
  dialogSave = null;
});

$('#devices-state').addEventListener('change', () => {
  const state = $('#devices-state').value;
  $('#device-list').hidden = state === 'empty'; $('#devices-empty').hidden = state !== 'empty'; $('#devices-offline').hidden = state !== 'offline';
  $$('.device-state').forEach((item, index) => { item.textContent = state === 'offline' ? 'Last known device' : index === 2 ? 'Disconnected' : 'Connected'; });
  const runtime = ['Everyday active · Healthy', 'No profile yet', 'Work saved · Waiting for keyboard', 'thinkpad.kbd running · Read-only'];
  $$('.runtime-state').forEach((item, index) => { item.textContent = state === 'offline' ? 'Current runtime state unknown' : runtime[index]; });
  $('.manager-link').textContent = state === 'offline' ? '○ Manager unavailable' : '● Manager connected';
});
$$('[data-setup-device]').forEach((link) => link.addEventListener('click', () => {
  setupDevice = link.dataset.setupDevice;
  $('#setup-device-label').textContent = setupDevice.toUpperCase();
  $('#identify-device-name').textContent = setupDevice;
  $('#identify-editor-link').href = editorURL(setupDevice);
}));
$('#device-list a[href="#identify"]').addEventListener('click', () => {
  setupDevice = 'Keychron Q1';
  $('#setup-device-label').textContent = 'KEYCHRON Q1';
  $('#identify-device-name').textContent = setupDevice;
  $('#identify-editor-link').href = editorURL(setupDevice);
});
$$('[name="geometry"]').forEach((radio) => radio.addEventListener('change', () => {
  $('#geometry-summary').textContent = radio.value;
  $('#setup-feedback').textContent = radio.value === 'ANSI 75%' ? '' : 'The linked editor currently illustrates ANSI 75% only.';
}));
$('#setup-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const name = $('#new-profile-name').value.trim();
  if (!name) { $('#setup-feedback').textContent = 'Give this profile a name.'; return; }
  if ($('[name="geometry"]:checked').value !== 'ANSI 75%') { $('#setup-feedback').textContent = 'Choose ANSI 75% to explore the linked editor. Other layouts are wireframe examples.'; return; }
  location.href = editorURL(setupDevice, name, true);
});

function finishIdentify(outcome) {
  clearInterval(identifyTimer); identifyActive = false;
  const states = {
    success: ['That’s the one.', 'This keyboard responded. Its previous mapping is restored.', 'Keyboard confirmed'],
    timeout: ['No keypress detected.', 'The session ended after 15 seconds. The previous mapping is restored; try again when ready.', 'Timed out'],
    cancelled: ['Identification cancelled.', 'The selected device’s previous mapping is restored.', 'Cancelled'],
    disconnected: ['The keyboard disconnected.', 'Reconnect it before trying again. Its enabled mapping will resume when the manager can access the device.', 'Waiting for device'],
  };
  const [title, copy, state] = states[outcome];
  $('#identify-result-title').textContent = title; $('#identify-result-copy').textContent = copy;
  $('#identify-state').textContent = state; $('#identify-countdown').textContent = 'Session ended';
  $('#start-identify').disabled = false; $('#start-identify').textContent = 'Try identification again';
  $('#cancel-identify').disabled = true; $('#identify-demo-controls').hidden = true;
}
$('#start-identify').addEventListener('click', () => {
  clearInterval(identifyTimer); identifyActive = true; remaining = 15;
  $('#identify-result-title').textContent = 'Press any key now.';
  $('#identify-result-copy').textContent = `Use ${setupDevice}. A matching keypress confirms the selected device.`;
  $('#identify-state').textContent = 'Waiting for a keypress'; $('#identify-countdown').textContent = '15 seconds';
  $('#start-identify').disabled = true; $('#cancel-identify').disabled = false; $('#identify-demo-controls').hidden = false;
  identifyTimer = setInterval(() => { remaining--; $('#identify-countdown').textContent = `${remaining} seconds`; if (!remaining) finishIdentify('timeout'); }, 1000);
});
$('#identify-keypress').addEventListener('click', () => finishIdentify('success'));
$('#identify-disconnect').addEventListener('click', () => finishIdentify('disconnected'));
$('#cancel-identify').addEventListener('click', () => finishIdentify('cancelled'));

$('#rename-profile').addEventListener('click', () => detail('Rename Everyday', 'Changing its name does not change which revision is active.', $('.selected-row h3').textContent, (name) => {
  if (!name) return;
  $('.selected-row h3').textContent = name; $('.profile-detail h3').textContent = name; toast('Profile renamed in this wireframe example.');
}));
$('#duplicate-profile').addEventListener('click', () => detail('Duplicate as a new draft', 'The copy starts inactive and keeps the same layout and behaviors. It does not replace the active profile.', 'Everyday copy', (name) => {
  if (!name) return;
  const row = document.createElement('article'); row.className = 'profile-line';
  for (const [title, caption] of [[name, 'Keychron Q1 · ANSI 75%'], ['Saved copy', 'Draft only'], ['Not active', 'Everyday remains active']]) {
    const cell = document.createElement('div'); const strong = document.createElement('strong'); strong.textContent = title;
    const text = document.createElement('p'); text.textContent = caption; cell.append(strong, text); row.append(cell);
  }
  const link = document.createElement('a'); link.className = 'secondary-button'; link.href = editorURL('Keychron Q1', name, true); link.textContent = 'Edit draft →'; row.append(link); $('.profile-table').append(row);
  toast('Inactive copy added to the wireframe.');
}));
$('#profile-files').addEventListener('click', () => detail('Import / export profiles', 'Import a versioned KeyboarDeer profile into a new local draft. Review the device association and geometry before applying.\n\nExport includes geometry, layers, and behaviors. It is not a runnable device-specific .kbd file.\n\nA native file chooser follows these actions in the application; no file operation is performed in this wireframe.'));
$('#work-details').addEventListener('click', () => detail('Work · Logitech MX Keys', 'This saved profile is available while the keyboard is disconnected. Its current mapping is waiting for the device.\n\nThe complete application allows local editing here. This linked editor demonstrates the ANSI 75% canvas only.'));
$('#preview-writing').addEventListener('click', () => {
  detail('Activate a different profile', 'The application compares Writing against the currently active Everyday profile, validates it, then asks you to apply explicitly.\n\nUse Review & apply in the wireframe gallery to explore the two-change Everyday example. Opening a profile alone does not activate it.');
});

function showLayer(id) {
  selectedLayer = id;
  $$('.layer-card').forEach((button) => { button.classList.toggle('chosen', button.dataset.layerDetail === id); button.setAttribute('aria-pressed', String(button.dataset.layerDetail === id)); });
  const card = $$('.layer-card').find((item) => item.dataset.layerDetail === id);
  $('#layer-detail-name').textContent = card.querySelector('strong').textContent;
  $('#layer-detail-copy').textContent = id === 'base' ? 'Layer 0 · always available' : id === 'navigation' ? 'Layer 1 · entered by holding Fn' : 'New layer · draft only';
  $('#layer-access').textContent = id === 'base' ? '✓ The base layout is always available' : id === 'navigation' ? '✓ This layer can be reached' : '! No entry key assigned yet';
  $('#layer-fallback').textContent = id === 'base' ? 'Every source key needs an assignment.' : id === 'navigation' ? 'Unassigned keys pass through to Base.' : 'Use a hold or toggle action in the key palette to reach this layer.';
}
$$('[data-layer-detail]').forEach((button) => button.addEventListener('click', () => showLayer(button.dataset.layerDetail)));
$('#add-layer').addEventListener('click', () => detail('Add a layer', 'New layers inherit lower-layer actions until you assign keys. Add an entry action so the layer can be reached.', 'Symbols', (name) => {
  if (!name) return;
  const number = $$('.layer-card').length; const card = document.createElement('button'); card.className = 'layer-card'; card.dataset.layerDetail = `new-${number}`;
  const badge = document.createElement('span'); badge.className = 'layer-number'; badge.textContent = number;
  const text = document.createElement('span'); const strong = document.createElement('strong'); strong.textContent = name; const small = document.createElement('small'); small.textContent = 'Pass-through keys · No entry action'; text.append(strong, small);
  const state = document.createElement('span'); state.className = 'outline-badge'; state.textContent = 'Not reachable'; card.append(badge, text, state); card.addEventListener('click', () => showLayer(card.dataset.layerDetail)); $('.layer-list').append(card); showLayer(card.dataset.layerDetail);
}));
$('#rename-layer').addEventListener('click', () => detail('Rename layer', 'Use a name that describes its purpose: Navigation, Symbols, or Media.', $('#layer-detail-name').textContent, (name) => {
  if (!name) return;
  $$('.layer-card').find((item) => item.dataset.layerDetail === selectedLayer).querySelector('strong').textContent = name; showLayer(selectedLayer);
}));

function renderReview() {
  const state = $('#review-state').value;
  const result = reviewPhase === 'applying' ? 'applying' : reviewPhase === 'rolled-back' ? 'rolled-back' : state;
  const messages = {
    ready: ['✓', 'Validation passed', 'The candidate passed the manager’s preview checks. It will be checked again immediately before activation.', 'Apply to Keychron Q1 →'],
    blocked: ['○', 'Waiting for your keyboard', 'Reconnect Keychron Q1, then validate again. Your draft is saved; this temporary condition does not mean its assignments are invalid.', 'Reconnect before applying'],
    rejected: ['!', 'This candidate was rejected', 'The Navigation layer references an undefined behavior. Return to the editor and correct it. Revision 6 continues running.', 'Fix draft before applying'],
    stale: ['!', 'A newer revision is active', 'Another client changed this configuration. Refresh the comparison and review your changes against revision 8 before retrying.', 'Refresh comparison →'],
    rollback: ['✓', 'Validation passed', 'Preview is valid. This scenario simulates an activation failure after you apply, followed by restoration of the previous mapping.', 'Apply to Keychron Q1 →'],
    'rolled-back': ['↶', 'Previous mapping restored', 'Activation failed. Revision 6 is running again; your draft is retained so you can revise it or retry.', 'Retry apply →'],
    applying: ['…', 'Applying your draft', 'The manager is revalidating and confirming that the replacement mapping is healthy.', 'Applying…'],
    success: ['✓', 'Everyday is active', 'Revision 7 is running and healthy. You can close the window; the manager keeps your mapping running.', 'Back to keyboards →'],
  };
  const [symbol, title, copy, action] = messages[result];
  $('#validation-symbol').textContent = symbol; $('#validation-title').textContent = title; $('#validation-copy').textContent = copy; $('#apply-draft').textContent = action;
  $('#apply-draft').disabled = ['blocked', 'rejected', 'applying'].includes(result);
  $('#review-state').disabled = reviewPhase === 'applying';
  $('#validation-help').hidden = !['blocked', 'rejected', 'rolled-back'].includes(result);
  $('#revision-badge').textContent = result === 'success' ? 'Active & healthy' : result === 'rolled-back' ? 'Draft not active' : result === 'applying' ? 'Applying' : 'Not live yet';
  const revision = result === 'success' ? baselineRevision + 1 : state === 'stale' ? 8 : baselineRevision;
  $('#running-revision').textContent = `Everyday · revision ${revision}`;
  if (result === 'success') $('#validation-copy').textContent = `Revision ${revision} is running and healthy. You can close the window; the manager keeps your mapping running.`;
  $('#candidate-revision').textContent = result === 'success' ? 'Everyday · no pending changes' : `${reviewProfile} · 2 changes`;
  $('#apply-status').textContent = reviewPhase === 'applying' ? 'Accepted operation · simulated' : '';
}
$('#review-state').addEventListener('change', () => { clearTimeout(applyTimer); reviewPhase = 'idle'; baselineRevision = 6; renderReview(); });
$('#apply-draft').addEventListener('click', () => {
  const state = $('#review-state').value;
  if (state === 'success') { location.hash = 'keyboards'; return; }
  if (state === 'stale') { baselineRevision = 8; $('#review-state').value = 'ready'; renderReview(); toast('Comparison refreshed against revision 8. Review again before applying.'); return; }
  if (['blocked', 'rejected'].includes(state) || reviewPhase === 'applying') return;
  reviewPhase = 'applying'; renderReview();
  applyTimer = setTimeout(() => {
    if (state === 'rollback') reviewPhase = 'rolled-back';
    else { reviewPhase = 'idle'; $('#review-state').value = 'success'; }
    renderReview();
  }, 900);
});
$$('[data-review-reset]').forEach((link) => link.addEventListener('click', () => {
  if (reviewPhase === 'applying') return;
  reviewProfile = 'Everyday'; baselineRevision = 6; reviewPhase = 'idle'; $('#review-state').value = 'ready'; renderReview();
}));

function renderDiagnostics() {
  const state = $('#diagnostics-state').value;
  const values = {
    permission: ['Manager connected', '2 healthy', '1 device needs access', 'Action needed', 'Framework keyboard cannot be opened', 'The manager can see the keyboard but does not have permission to read it.', 'Complete the manager’s input-access setup, then sign out and back in if group membership changed.', 'device_inaccessible · Framework keyboard'],
    healthy: ['Manager connected', '2 healthy', 'No action needed', 'Ready', 'Your connected keyboards are ready', 'The manager reports healthy mappings and no blocking diagnostics.', 'Keep editing. Known-disconnected keyboards will resume their enabled mappings when available.', 'All checks clear · illustrative snapshot'],
    offline: ['Manager unavailable', 'Unknown', 'Connection required', 'Unavailable', 'Cannot connect to your manager', 'Live device availability and mapping health cannot be confirmed. Last-known data is not live status.', 'Check that the manager is installed and running for this user, then reconnect. Local profile drafts remain available.', 'Connection failed · client state'],
    incomplete: ['Connected · API incomplete', 'Unknown', 'Manager update needed', 'Unsupported', 'This manager cannot report the required state yet', 'Capability or snapshot requests returned unsupported_capability. Features that depend on them remain unavailable.', 'Use a compatible manager build. The GUI will not substitute logs, CLI output, or private status files for API state.', 'unsupported_capability · API state'],
  };
  const selectors = ['#health-connection', '#health-mappings', '#health-attention', '#finding-severity', '#finding-title', '#finding-copy', '#finding-remediation', '#finding-code'];
  selectors.forEach((selector, index) => { $(selector).textContent = values[state][index]; });
  $('#diagnostic-checks').hidden = ['offline', 'incomplete'].includes(state);
  $('.finding-symbol').textContent = state === 'healthy' ? '✓' : '!';
  $('.manager-link').textContent = state === 'offline' ? '○ Manager unavailable' : state === 'incomplete' ? '○ API incomplete' : '● Manager connected';
}
$('#diagnostics-state').addEventListener('change', renderDiagnostics);
$('#refresh-diagnostics').addEventListener('click', () => { renderDiagnostics(); toast('Simulated checks refreshed. Use the state selector to explore another result.'); });
$('#diagnostic-details').addEventListener('click', () => detail('Technical details', `Selected finding: ${$('#finding-code').textContent}\n\nProtocol: API v1\nSource: illustrative manager snapshot\n\nProduction diagnostics retain resource IDs, stable reason codes, and remediation. No real system information is read by this wireframe.`));
window.addEventListener('hashchange', route);
renderReview(); route();
