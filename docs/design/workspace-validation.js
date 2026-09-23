// Prototype validation adapter. Simulates whole-candidate preview responses;
// it does not implement KMonad syntax checking or call the manager.
const validationDebounces = new Map();

function newDraftValidation() {
  return {
    revision: 0, validationGeneration: 0, validationEnvironment: '',
    validation: { phase: 'unchecked', revision: null, issues: [], message: '' },
    lastValidated: null, recovery: {}, validationMode: 'normal',
  };
}
function validationSnapshot(s) {
  return structuredClone({ assignments: s.assignments, layers: s.layers });
}
function snapshotAssignment(snapshot, id) {
  const [number, key] = id.split('|');
  return snapshot.assignments[id] || original(key, Number(number));
}
function validationEnvironment(id) {
  const s = drafts.get(id);
  return JSON.stringify({ online: managerOnline, api: runtimeKnown(), connected: devices[id].connected,
    inaccessible: id === 'framework' && $('#diagnostic-scenario').value === 'permission', mode: s.validationMode });
}
function rememberKeyRecovery(id) {
  const s = state();
  if (s.recovery[id]) return;
  const known = s.lastValidated && s.lastValidated.layers.some((item) => item.id === Number(id.split('|')[0]));
  s.recovery[id] = {
    value: snapshotAssignment(known ? s.lastValidated : validationSnapshot(s), id),
    origin: known ? 'Last validated assignment' : 'Assignment before these edits',
  };
}
function draftChanged() {
  state().revision++;
  scheduleValidation(device);
}
function syncValidationEnvironment() {
  for (const [id, s] of drafts) {
    if (s.validationEnvironment !== validationEnvironment(id)) scheduleValidation(id);
  }
}
function scheduleValidation(id = device) {
  const s = drafts.get(id);
  if (!s) return;
  clearTimeout(validationDebounces.get(id));
  const generation = ++s.validationGeneration;
  const revision = s.revision;
  const candidate = validationSnapshot(s);
  const environment = validationEnvironment(id);
  s.validationEnvironment = environment;
  s.validation = { phase: 'checking', revision, issues: [], message: 'Checking the complete draft…' };
  if (id === device && currentPage === 'keymap') renderValidation();
  // Coalesce rapid clicks, while immediately removing the previous green result.
  validationDebounces.set(id, setTimeout(() => {
    validationDebounces.delete(id);
    // A dispatched request may still return after a newer edit or reconnection.
    setTimeout(() => {
      if (s.revision !== revision || s.validationGeneration !== generation || validationEnvironment(id) !== environment) return;
      const result = simulateCandidateValidation(candidate, JSON.parse(environment));
      s.validation = { ...result, revision };
      if (result.phase === 'valid') {
        s.lastValidated = candidate;
        s.recovery = {};
      }
      // Never paint another device's result into the currently selected keyboard.
      if (id === device && currentPage === 'keymap') renderValidation();
    }, 170);
  }, 100));
}
function simulateCandidateValidation(candidate, environment) {
  const issues = [];
  for (const [id, value] of Object.entries(candidate.assignments)) {
    const [number, key] = id.split('|');
    const layerId = Number(number);
    if (!candidate.layers.some((item) => item.id === layerId)) continue;
    if (value === 'invalid:layer') issues.push({ id: `${id}:missing-layer`, address: id, value, layerId, key,
      title: 'The target layer does not exist.',
      explanation: 'This hold action points to layer 99, which is not in this draft. It cannot be compiled into a complete keymap.',
      remedy: 'Choose an existing layer from the palette, or revert this assignment.' });
    if (value === 'invalid:alias') issues.push({ id: `${id}:missing-alias`, address: id, value, layerId, key,
      title: 'The referenced behavior is undefined.',
      explanation: 'This key calls @quick_escape, but the draft has no behavior with that name.',
      remedy: 'Choose a defined key action, or revert this assignment.' });
  }
  // Definite local errors remain useful even when manager validation is unavailable.
  if (issues.length) return { phase: 'rejected', issues, message: 'Fix these assignments to complete the keymap. Each correction is checked automatically.' };
  if (!environment.online) return { phase: 'unavailable', issues, message: 'The manager is unavailable. The current draft cannot be validated. Keep editing; checks resume when it reconnects.' };
  if (!environment.api) return { phase: 'unavailable', issues, message: 'This manager cannot provide the required validation capability. Use a compatible manager build; the draft remains editable.' };
  if (!environment.connected || environment.inaccessible || environment.mode === 'blocked') return { phase: 'blocked', issues, message: 'The manager cannot currently access the keyboard. Reconnect it or resolve input access, then retry. This does not mean the key assignments are invalid.' };
  if (environment.mode === 'timeout') return { phase: 'blocked', issues, message: 'The validation request timed out. No valid or invalid decision was made; retry when the manager is ready.' };
  if (environment.mode === 'unattributed') return { phase: 'rejected', issues: [{ id: 'candidate-general', title: 'The manager rejected the generated candidate.',
    explanation: 'This simulated diagnostic has no reliable key or source location. It would be misleading to blame the last key you clicked.',
    remedy: 'Inspect the candidate-level diagnostic or retry. A per-key revert is offered only when the affected assignment can be identified.' }], message: 'One keymap-level problem needs attention. No individual key has been identified.' };
  return { phase: 'valid', issues, message: 'The complete current draft passed validation. It has not been applied.' };
}
function currentValidationIssues() {
  const s = state();
  return s.validation.phase === 'rejected' && s.validation.revision === s.revision ? s.validation.issues : [];
}
function validationIssueAt(key, layerId = layer) {
  return currentValidationIssues().find((issue) => issue.address === address(key, layerId));
}
function canRevertIssue(issue) {
  const s = state(); const recovery = s.recovery[issue.address];
  if (!recovery || recovery.value === issue.value || snapshotAssignment(validationSnapshot(s), issue.address) !== issue.value) return false;
  const target = /^(hold|toggle):(\d+)$/.exec(recovery.value);
  return !target || s.layers.some((item) => item.id === Number(target[2]));
}
function revertInvalidAssignment(issue, expectedRevision) {
  const s = state();
  if (s.revision !== expectedRevision || !currentValidationIssues().some((item) => item.id === issue.id) || !canRevertIssue(issue)) return;
  const recovery = s.recovery[issue.address];
  remember();
  s.assignments[issue.address] = recovery.value;
  delete s.recovery[issue.address];
  draftChanged(); renderEditor();
  toast(`${keyName(issue.key)} reverted to ${actionName(recovery.value)}. Other edits kept; checking again.`);
  // The issue button no longer exists; restore focus to the corrected source key.
  layer = issue.layerId; selected = issue.key; renderEditor();
  $$('.key').find((button) => button.dataset.key === selected)?.focus({ preventScroll: true });
}
function renderValidation() {
  const s = state(); const result = s.validation;
  const labels = {
    unchecked: ['○', 'Not checked yet', 'Draft only · not applied'],
    checking: ['…', 'Checking keymap…', 'Current draft · not applied'],
    valid: ['✓', 'Keymap is valid', 'Whole draft checked · not applied'],
    rejected: ['!', 'Keymap is invalid', 'Fix the problems below'],
    blocked: ['○', 'Validation is blocked', 'No validity decision yet'],
    unavailable: ['○', 'Validation unavailable', 'Current draft is not checked'],
  };
  const [icon, title, copy] = labels[result.phase];
  $('#validation-status').dataset.phase = result.phase;
  $('#validation-status-icon').textContent = icon;
  $('#validation-status-title').textContent = title;
  $('#validation-status-copy').textContent = copy;
  const panel = $('#validation-panel');
  panel.hidden = ['unchecked', 'checking', 'valid'].includes(result.phase);
  panel.dataset.phase = result.phase;
  $('#validation-panel-icon').textContent = result.phase === 'rejected' ? '!' : '○';
  const count = result.issues.filter((issue) => issue.address).length;
  $('#validation-panel-title').textContent = result.phase === 'rejected' ? count ? `${count} invalid key ${count === 1 ? 'assignment' : 'assignments'}` : 'Your keymap needs attention' : title;
  $('#validation-panel-copy').textContent = result.message;
  $('.validation-panel-note').hidden = result.phase !== 'rejected';
  $('#validation-issues').replaceChildren();
  for (const issue of result.issues) {
    const row = document.createElement('article'); row.className = 'validation-issue';
    const content = document.createElement('div');
    const location = document.createElement('span'); location.className = 'validation-location'; location.textContent = issue.address ? `${layerName(issue.layerId)} layer / ${keyName(issue.key)}` : 'Whole keymap / no key location';
    const heading = document.createElement('h3'); heading.textContent = issue.title;
    const explanation = document.createElement('p'); explanation.textContent = issue.explanation;
    const remedy = document.createElement('p'); remedy.className = 'validation-remedy'; remedy.textContent = issue.remedy;
    content.append(location, heading, explanation, remedy); row.append(content);
    if (issue.address) {
      const controls = document.createElement('div'); controls.className = 'validation-issue-actions';
      const show = document.createElement('button'); show.className = 'button text'; show.textContent = 'Show key';
      show.addEventListener('click', () => { layer = issue.layerId; selected = issue.key; renderEditor(); const key = $$('.key').find((button) => button.dataset.key === selected); key?.focus(); key?.scrollIntoView({ block: 'center', behavior: 'auto' }); });
      controls.append(show);
      if (canRevertIssue(issue)) {
        const previous = s.recovery[issue.address];
        const revert = document.createElement('button'); revert.className = 'button revert-key'; revert.dataset.revertKey = issue.address; revert.textContent = `Revert ${keyName(issue.key)}`;
        const revision = s.revision; revert.addEventListener('click', () => revertInvalidAssignment(issue, revision));
        const note = document.createElement('small'); note.textContent = `${previous.origin}: ${actionName(previous.value)}`;
        controls.append(revert, note);
      } else {
        const note = document.createElement('small');
        const saved = s.recovery[issue.address];
        const missingTarget = saved && /^(hold|toggle):(\d+)$/.exec(saved.value);
        note.textContent = missingTarget && !s.layers.some((item) => item.id === Number(missingTarget[2]))
          ? 'The saved assignment targets a deleted layer. Repair that dependency or choose a different action.'
          : 'No different earlier assignment is available for this key. Choose a valid action from the palette.';
        controls.append(note);
      }
      row.append(controls);
    }
    $('#validation-issues').append(row);
  }
  $('#validation-scenario').value = s.validationMode;
  $$('.key').forEach((button) => {
    const issue = validationIssueAt(button.dataset.key);
    button.classList.toggle('invalid-key', Boolean(issue));
    button.setAttribute('aria-invalid', String(Boolean(issue)));
    const value = assignment(button.dataset.key);
    button.setAttribute('aria-label', `${keyName(button.dataset.key)}: ${actionName(value)}${issue ? `, invalid: ${issue.title}` : value !== original(button.dataset.key) ? ', changed in draft' : ''}`);
  });
  $$('#layer-tabs [data-layer]').forEach((button) => {
    const id = Number(button.dataset.layer);
    const issues = currentValidationIssues().filter((issue) => issue.layerId === id);
    button.classList.toggle('invalid-layer', issues.length > 0);
    button.textContent = `${id} · ${layerName(id)}${issues.length ? ` · ${issues.length} ${issues.length === 1 ? 'issue' : 'issues'}` : ''}`;
  });
  const announcement = result.phase === 'rejected' ? `${$('#validation-panel-title').textContent}. ${result.issues.map((issue) => `${issue.address ? keyName(issue.key) + ': ' : ''}${issue.title}`).join(' ')}` : '';
  if ($('#validation-alert').textContent !== announcement) $('#validation-alert').textContent = announcement;
}
function initializeValidation() {
  $('#retry-validation').addEventListener('click', () => scheduleValidation());
  $('#demo-missing-layer').addEventListener('click', () => assign('invalid:layer'));
  $('#demo-missing-alias').addEventListener('click', () => assign('invalid:alias'));
  $('#validation-scenario').addEventListener('change', () => { state().validationMode = $('#validation-scenario').value; scheduleValidation(); });
}
