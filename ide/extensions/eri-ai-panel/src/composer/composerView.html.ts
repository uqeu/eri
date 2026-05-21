// The Composer webview body. All dynamic content (file paths, diff text,
// counts) is rendered through textContent / createElement in the inline
// script — never via innerHTML — so untrusted strings from the sidecar
// cannot inject markup.
function modelDisplayLabel(modelId: string): string {
  // Map wire-format model IDs to user-visible labels. The diffusion engine
  // family is surfaced as "eri Engine" since we do not market the underlying
  // provider.
  switch (modelId) {
    // wire-format model id, not user-visible
    case "mercury-2":
      return "eri Engine";
    // wire-format model id, not user-visible
    case "mercury-2-coder":
      return "eri Engine (coder)";
    default:
      return modelId;
  }
}

export function renderComposerHtml(initialModel: string): string {
  const safeModel = modelDisplayLabel(String(initialModel)).replace(/[<>&"']/g, "");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<title>eri composer</title>
<style>
  :root {
    color-scheme: dark;
    --bg: #181818;
    --fg: #d6d6dd;
    --muted: #8b8b96;
    --border: #292929;
    --accent: #228df2;
    --eri-accent: #e0ff4f;
    --card: #212121;
    --added: #3fb950;
    --removed: #f85149;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 0;
    font-family: var(--vscode-font-family);
    font-size: 13px;
    line-height: 1.55;
    background: var(--bg);
    color: var(--fg);
    display: flex;
    flex-direction: column;
    height: 100vh;
  }
  .header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    border-bottom: 1px solid var(--border);
    background: #1c1c1c;
  }
  .title { font-weight: 600; letter-spacing: 0.01em; }
  .subtitle { color: var(--muted); font-size: 12px; }
  .spacer { flex: 1; }
  .model-pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 2px 10px;
    border-radius: 9999px;
    background: var(--card);
    border: 1px solid var(--border);
    font-size: 12px;
    cursor: pointer;
  }
  .model-pill::after { content: "▾"; opacity: 0.6; }
  .icon-btn {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--fg);
    border-radius: 6px;
    padding: 2px 8px;
    cursor: pointer;
  }
  .body {
    flex: 1;
    overflow: auto;
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  textarea.prompt {
    width: 100%;
    min-height: 124px;
    padding: 10px 12px;
    border-radius: 8px;
    background: var(--card);
    color: var(--fg);
    border: 1px solid var(--border);
    font-family: var(--vscode-editor-font-family, var(--vscode-font-family));
    font-size: 13px;
    resize: vertical;
    outline: none;
  }
  textarea.prompt:focus { border-color: var(--accent); }
  .prompt-row { display: flex; gap: 8px; align-items: center; }
  button.plan {
    padding: 8px 14px;
    border-radius: 6px;
    border: 1px solid var(--eri-accent);
    background: transparent;
    color: var(--eri-accent);
    cursor: pointer;
    font-weight: 600;
  }
  button.plan:hover { background: rgba(224, 255, 79, 0.08); }
  .group-label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
    margin: 4px 0 6px;
  }
  .file-list { display: flex; flex-direction: column; gap: 6px; }
  .file-row {
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--card);
    overflow: hidden;
  }
  .file-head {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    cursor: pointer;
    user-select: none;
  }
  .file-head:hover { background: #262626; }
  .file-check { accent-color: var(--accent); }
  .file-path {
    flex: 1;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 12px;
  }
  .badge {
    font-size: 11px;
    padding: 1px 6px;
    border-radius: 4px;
    background: rgba(255,255,255,0.04);
  }
  .badge.add { color: var(--added); }
  .badge.del { color: var(--removed); }
  .kind {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: 1px 6px;
    border-radius: 3px;
    border: 1px solid var(--border);
    color: var(--muted);
  }
  .kind.added { color: var(--added); border-color: rgba(63,185,80,0.3); }
  .kind.modified { color: var(--accent); border-color: rgba(34,141,242,0.3); }
  .kind.removed { color: var(--removed); border-color: rgba(248,81,73,0.3); }
  .diff {
    display: none;
    border-top: 1px solid var(--border);
    background: #161616;
    padding: 8px 10px;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 12px;
    white-space: pre;
    overflow-x: auto;
    max-height: 320px;
  }
  .file-row.open .diff { display: block; }
  .diff .add { color: var(--added); }
  .diff .del { color: var(--removed); }
  .diff .ctx { color: var(--muted); }
  .empty {
    color: var(--muted);
    font-style: italic;
    padding: 24px;
    text-align: center;
    border: 1px dashed var(--border);
    border-radius: 8px;
  }
  .toolbar {
    border-top: 1px solid var(--border);
    padding: 10px 14px;
    display: flex;
    gap: 8px;
    align-items: center;
    background: #1c1c1c;
  }
  .summary { color: var(--muted); font-size: 12px; }
  .toolbar .spacer { flex: 1; }
  button.action {
    padding: 7px 12px;
    border-radius: 6px;
    border: 1px solid var(--border);
    background: var(--card);
    color: var(--fg);
    cursor: pointer;
  }
  button.action:hover { background: #2a2a2a; }
  button.action.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: white;
  }
  button.action.primary:hover { filter: brightness(1.08); }
  button.action.danger { color: var(--removed); }
  button.action[disabled] { opacity: 0.4; cursor: not-allowed; }
  .status {
    color: var(--muted);
    font-size: 12px;
    padding: 0 14px 6px;
    min-height: 18px;
  }
</style>
</head>
<body>
<div class="header">
  <span class="title">Composer</span>
  <span class="subtitle">· multi-file</span>
  <span class="spacer"></span>
  <span class="model-pill" id="model-pill">${safeModel}</span>
  <button class="icon-btn" id="btn-close" title="Close">×</button>
</div>

<div class="body">
  <div class="prompt-row">
    <textarea
      class="prompt"
      id="prompt"
      rows="6"
      placeholder="Describe the multi-file change you want…"
    ></textarea>
  </div>
  <div class="prompt-row">
    <span class="summary" id="hint">tip: press Cmd-Enter to plan</span>
    <span class="spacer"></span>
    <button class="plan" id="btn-plan">Plan changes</button>
  </div>

  <div id="groups"></div>
</div>

<div class="status" id="status"></div>

<div class="toolbar">
  <span class="summary" id="summary">no plan yet</span>
  <span class="spacer"></span>
  <button class="action danger" id="btn-discard">Discard</button>
  <button class="action" id="btn-apply-selected" disabled>Apply Selected</button>
  <button class="action primary" id="btn-apply-all" disabled>Apply All</button>
</div>

<script>
const vscode = acquireVsCodeApi();

const promptEl = document.getElementById('prompt');
const groupsEl = document.getElementById('groups');
const statusEl = document.getElementById('status');
const summaryEl = document.getElementById('summary');
const applyAllBtn = document.getElementById('btn-apply-all');
const applySelBtn = document.getElementById('btn-apply-selected');
const discardBtn = document.getElementById('btn-discard');
const planBtn = document.getElementById('btn-plan');
const closeBtn = document.getElementById('btn-close');
const modelPill = document.getElementById('model-pill');

function modelDisplayLabel(modelId) {
  // wire-format model ids, not user-visible — map to "eri Engine"
  if (modelId === 'mercury-2') return 'eri Engine';
  if (modelId === 'mercury-2-coder') return 'eri Engine (coder)';
  return modelId;
}

let currentChanges = [];

function send(method, params) {
  vscode.postMessage({ method: method, params: params || {} });
}

function setStatus(text) {
  statusEl.textContent = text || '';
}

function updateButtons() {
  const hasAny = currentChanges.length > 0;
  applyAllBtn.disabled = !hasAny;
  const anySelected = currentChanges.some(c => c.selected);
  applySelBtn.disabled = !anySelected;
  if (!hasAny) {
    summaryEl.textContent = 'no plan yet';
  } else {
    const add = currentChanges.filter(c => c.kind === 'added').length;
    const mod = currentChanges.filter(c => c.kind === 'modified').length;
    const rem = currentChanges.filter(c => c.kind === 'removed').length;
    summaryEl.textContent = currentChanges.length + ' files · ' + add + ' added · ' + mod + ' modified · ' + rem + ' removed';
  }
}

function buildDiffNode(diff) {
  const wrap = document.createElement('div');
  wrap.className = 'diff';
  if (typeof diff !== 'string' || diff.length === 0) {
    const span = document.createElement('span');
    span.className = 'ctx';
    span.textContent = '(no diff available)';
    wrap.appendChild(span);
    return wrap;
  }
  const lines = diff.split('\\n');
  for (const line of lines) {
    const lineEl = document.createElement('div');
    if (line.startsWith('+')) {
      lineEl.className = 'add';
    } else if (line.startsWith('-')) {
      lineEl.className = 'del';
    } else {
      lineEl.className = 'ctx';
    }
    lineEl.textContent = line;
    wrap.appendChild(lineEl);
  }
  return wrap;
}

function countDiffLines(diff) {
  if (typeof diff !== 'string') return { added: 0, removed: 0 };
  let added = 0;
  let removed = 0;
  for (const line of diff.split('\\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) added++;
    else if (line.startsWith('-') && !line.startsWith('---')) removed++;
  }
  return { added, removed };
}

function renderGroups(changes) {
  currentChanges = (changes || []).map(c => ({
    path: String(c && c.path || ''),
    kind: c && c.kind === 'added' ? 'added' : c && c.kind === 'removed' ? 'removed' : 'modified',
    diff: typeof (c && c.diff) === 'string' ? c.diff : '',
    selected: true,
  }));

  while (groupsEl.firstChild) groupsEl.removeChild(groupsEl.firstChild);

  if (currentChanges.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'no proposed changes yet — describe the edit above and click Plan';
    groupsEl.appendChild(empty);
    updateButtons();
    return;
  }

  const groupOrder = [
    { kind: 'added',    label: '+ added' },
    { kind: 'modified', label: '~ modified' },
    { kind: 'removed',  label: '- removed' },
  ];

  for (const group of groupOrder) {
    const items = currentChanges.filter(c => c.kind === group.kind);
    if (items.length === 0) continue;

    const label = document.createElement('div');
    label.className = 'group-label';
    label.textContent = group.label + ' · ' + items.length;
    groupsEl.appendChild(label);

    const list = document.createElement('div');
    list.className = 'file-list';

    for (const item of items) {
      const row = document.createElement('div');
      row.className = 'file-row';

      const head = document.createElement('div');
      head.className = 'file-head';

      const check = document.createElement('input');
      check.type = 'checkbox';
      check.className = 'file-check';
      check.checked = item.selected;
      check.addEventListener('click', (e) => e.stopPropagation());
      check.addEventListener('change', () => {
        item.selected = check.checked;
        updateButtons();
      });

      const kindTag = document.createElement('span');
      kindTag.className = 'kind ' + group.kind;
      kindTag.textContent = group.kind;

      const path = document.createElement('span');
      path.className = 'file-path';
      path.textContent = item.path;

      const counts = countDiffLines(item.diff);
      const addBadge = document.createElement('span');
      addBadge.className = 'badge add';
      addBadge.textContent = '+' + counts.added;
      const delBadge = document.createElement('span');
      delBadge.className = 'badge del';
      delBadge.textContent = '-' + counts.removed;

      head.appendChild(check);
      head.appendChild(kindTag);
      head.appendChild(path);
      head.appendChild(addBadge);
      head.appendChild(delBadge);

      head.addEventListener('click', () => {
        row.classList.toggle('open');
      });

      row.appendChild(head);
      row.appendChild(buildDiffNode(item.diff));
      list.appendChild(row);
    }

    groupsEl.appendChild(list);
  }
  updateButtons();
}

planBtn.addEventListener('click', () => {
  const text = promptEl.value.trim();
  if (text.length === 0) {
    setStatus('enter a prompt first');
    return;
  }
  setStatus('planning…');
  send('eri/composer/plan/request', { prompt: text });
});

applyAllBtn.addEventListener('click', () => {
  if (currentChanges.length === 0) return;
  setStatus('applying ' + currentChanges.length + ' file(s)…');
  send('eri/composer/apply', { paths: currentChanges.map(c => c.path) });
});

applySelBtn.addEventListener('click', () => {
  const paths = currentChanges.filter(c => c.selected).map(c => c.path);
  if (paths.length === 0) return;
  setStatus('applying ' + paths.length + ' file(s)…');
  send('eri/composer/apply', { paths: paths });
});

discardBtn.addEventListener('click', () => {
  send('eri/composer/discard', {});
  currentChanges = [];
  renderGroups([]);
  setStatus('discarded');
});

closeBtn.addEventListener('click', () => {
  send('eri/composer/close', {});
});

modelPill.addEventListener('click', () => {
  send('eri/model/cycle', {});
});

promptEl.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault();
    planBtn.click();
  }
});

window.addEventListener('message', (event) => {
  const method = event.data && event.data.method;
  const params = (event.data && event.data.params) || {};
  switch (method) {
    case 'eri/composer/plan/result':
      renderGroups(Array.isArray(params.changes) ? params.changes : []);
      setStatus('plan ready');
      break;
    case 'eri/composer/applied':
      setStatus('applied ' + (params.applied || 0) + ' file(s)');
      currentChanges = [];
      renderGroups([]);
      break;
    case 'eri/composer/error':
      setStatus('error: ' + (typeof params.message === 'string' ? params.message : 'unknown'));
      break;
    case 'eri/model/changed':
      modelPill.textContent = typeof params.model === 'string' ? modelDisplayLabel(params.model) : modelPill.textContent;
      break;
    case 'eri/composer/focus':
      promptEl.focus();
      break;
  }
});

renderGroups([]);
</script>
</body>
</html>`;
}
