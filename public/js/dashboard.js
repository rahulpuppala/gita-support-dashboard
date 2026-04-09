const API_BASE = '/api';
let token = localStorage.getItem('token');
let currentView = 'responses';
let socket = null;

// ─── Auth ───────────────────────────────────────────────
async function login() {
  const username = document.getElementById('loginUsername').value;
  const password = document.getElementById('loginPassword').value;
  const errorEl = document.getElementById('loginError');
  errorEl.classList.add('hidden');
  try {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');
    token = data.token;
    localStorage.setItem('token', token);
    document.getElementById('adminName').textContent = data.user.username;
    showDashboard();
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove('hidden');
  }
}

function logout() {
  token = null;
  localStorage.removeItem('token');
  document.getElementById('dashboard').classList.add('hidden');
  document.getElementById('loginScreen').classList.remove('hidden');
  if (socket) socket.disconnect();
}

function showDashboard() {
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('dashboard').classList.remove('hidden');
  initSocket();
  showView('responses');
  refreshAll();
}

// ─── API helper ─────────────────────────────────────────
async function api(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
  if (res.status === 401 || res.status === 403) { logout(); throw new Error('Session expired'); }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// ─── Socket.IO ──────────────────────────────────────────
function initSocket() {
  socket = io();
  socket.on('whatsapp_status', (data) => updateWhatsAppStatus(data.status));
  socket.on('new_response', () => {
    if (currentView === 'responses') loadResponses();
    loadStats();
  });
  socket.on('new_ignored', () => {
    if (currentView === 'ignored') loadIgnored();
    loadStats();
  });
  socket.on('new_action', () => {
    if (currentView === 'actions') loadActions();
    loadStats();
  });
}

function updateWhatsAppStatus(status) {
  const el = document.getElementById('whatsappStatus');
  if (status === 'connected') {
    el.className = 'flex items-center gap-1.5 ml-4 px-3 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700';
    el.innerHTML = '<span class="w-2 h-2 rounded-full bg-green-500 pulse-dot"></span> Connected';
  } else {
    el.className = 'flex items-center gap-1.5 ml-4 px-3 py-1 rounded-full text-xs font-medium bg-red-100 text-red-600';
    el.innerHTML = '<span class="w-2 h-2 rounded-full bg-red-500"></span> Disconnected';
  }
}

async function checkWhatsAppStatus() {
  try {
    const data = await fetch(`${API_BASE}/health`).then(r => r.json());
    updateWhatsAppStatus(data.whatsapp);
  } catch (_) {}
}

// ─── Toast ──────────────────────────────────────────────
function showToast(msg) {
  const t = document.createElement('div');
  t.className = 'fixed bottom-4 right-4 bg-gray-900 text-white px-4 py-2.5 rounded-lg text-sm shadow-lg z-50 fade-in';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

// ─── Views ──────────────────────────────────────────────
function showView(view) {
  currentView = view;
  document.querySelectorAll('.view-panel').forEach(p => p.classList.add('hidden'));
  document.getElementById(`view-${view}`).classList.remove('hidden');
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('bg-indigo-50', 'text-indigo-700'));
  document.querySelector(`[data-view="${view}"]`)?.classList.add('bg-indigo-50', 'text-indigo-700');

  if (view === 'responses') loadResponses();
  if (view === 'ignored') loadIgnored();
  if (view === 'actions') loadActions();
  if (view === 'faqs') loadKnowledge();
  if (view === 'settings') loadAdminAuthors();
  if (view === 'test') document.getElementById('testInput').focus();
}

// ─── Refresh ────────────────────────────────────────────
async function refreshAll() {
  checkWhatsAppStatus();
  loadStats();
  refreshMode();
}

async function loadStats() {
  try {
    const data = await api('/dashboard/stats');
    document.getElementById('pendingBadge').textContent = data.pending || 0;
    document.getElementById('ignoredBadge').textContent = data.ignored || 0;
    document.getElementById('actionsBadge').textContent = data.pendingActions || 0;
    document.getElementById('statsLabel').textContent =
      `${data.withResponse || 0} responses | ${data.sent || 0} sent | ${data.pending || 0} pending`;
  } catch (_) {}
}

// ─── Mode Toggle ────────────────────────────────────────
async function refreshMode() {
  try {
    const data = await api('/dashboard/mode');
    updateModeUI(data.mode);
  } catch (_) {}
}

function updateModeUI(mode) {
  const label = document.getElementById('modeLabel');
  const btn = document.getElementById('modeBtn');
  if (mode === 'prod') {
    label.textContent = 'PROD';
    label.className = 'text-xs font-medium px-3 py-1 rounded-full bg-red-100 text-red-700';
    btn.textContent = 'Switch to Test';
  } else {
    label.textContent = 'TEST';
    label.className = 'text-xs font-medium px-3 py-1 rounded-full bg-amber-100 text-amber-700';
    btn.textContent = 'Switch to Prod';
  }
}

async function toggleMode() {
  try {
    const data = await api('/dashboard/mode');
    const newMode = data.mode === 'test' ? 'prod' : 'test';
    if (newMode === 'prod') {
      if (!confirm('Switch to PRODUCTION mode? The bot will auto-respond in the WhatsApp group.')) return;
    }
    const result = await api('/dashboard/mode', { method: 'POST', body: JSON.stringify({ mode: newMode }) });
    updateModeUI(result.mode);
    showToast(`Switched to ${result.mode.toUpperCase()} mode`);
  } catch (err) {
    alert('Failed: ' + err.message);
  }
}

// ─── Responses ──────────────────────────────────────────
async function loadResponses() {
  try {
    const data = await api('/dashboard/responses?limit=50');
    const container = document.getElementById('responsesList');
    const empty = document.getElementById('responsesEmpty');

    if (!data.responses.length) {
      container.innerHTML = '';
      empty.classList.remove('hidden');
      return;
    }
    empty.classList.add('hidden');

    data.responses.forEach(r => { chatMessages[r.id] = r.message; chatResponses[r.id] = r.response; });
    container.innerHTML = data.responses.map(r => responseCard(r)).join('');
  } catch (err) {
    console.error('Failed to load responses:', err);
  }
}

function responseCard(r) {
  const time = new Date(r.created_at).toLocaleString();
  const isSent = r.status === 'sent';
  const isPending = r.status === 'pending';

  const statusBadge = isSent
    ? '<span class="px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700 rounded-full">Sent</span>'
    : '<span class="px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-700 rounded-full">Pending</span>';

  const sendBtn = isPending
    ? `<button onclick="dismissResponse(${r.id})" class="ml-2 px-3 py-1 text-xs font-medium border border-red-300 text-red-600 rounded-lg hover:bg-red-50 transition">Dismiss</button><button onclick="reevaluateResponse(${r.id}, this)" class="ml-1 px-3 py-1 text-xs font-medium border border-amber-300 text-amber-700 rounded-lg hover:bg-amber-50 transition">Re-evaluate</button><button onclick="editResponse(${r.id})" class="ml-1 px-3 py-1 text-xs font-medium border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50 transition">Edit</button><button onclick="sendResponse(${r.id})" class="ml-1 px-3 py-1 text-xs font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition">Send Now</button>`
    : '';

  const confidence = r.confidence ? `${Math.round(r.confidence * 100)}%` : '-';

  return `
    <div class="bg-white rounded-xl border border-gray-200 overflow-hidden fade-in">
      <div class="px-5 py-4 cursor-pointer hover:bg-gray-50 transition" onclick="toggleDetail(${r.id})">
        <div class="flex items-start justify-between gap-4">
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 mb-1">
              <span class="text-sm font-medium text-gray-900">${esc(r.sender_name)}</span>
              <span class="text-xs text-gray-400 font-mono">${esc(r.sender_id || '')}</span>
              ${statusBadge}
              <span class="text-xs text-gray-400">${confidence} confidence</span>
              ${sendBtn}
            </div>
            <p class="text-sm text-gray-600 truncate">${esc(r.message)}</p>
            <p class="text-sm text-indigo-600 mt-1 truncate">${esc(r.response || '')}</p>
          </div>
          <span class="text-xs text-gray-400 whitespace-nowrap">${time}</span>
        </div>
      </div>
      <div id="detail-${r.id}" class="hidden border-t border-gray-100 px-5 py-4 bg-gray-50 text-sm space-y-4">
        <div>
          <h4 class="font-semibold text-gray-700 mb-1">Original Question</h4>
          <p class="text-gray-600 bg-white rounded-lg p-3 border border-gray-200">${esc(r.message)}</p>
        </div>
        <div>
          <h4 class="font-semibold text-gray-700 mb-1">Bot Response</h4>
          <div id="response-display-${r.id}">
            <p class="text-indigo-700 bg-indigo-50 rounded-lg p-3 border border-indigo-100">${esc(r.response || 'No response')}</p>
          </div>
          ${isPending ? `<div id="response-edit-${r.id}" class="hidden">
            <textarea id="response-textarea-${r.id}" rows="4" class="w-full px-3 py-2.5 border border-indigo-300 rounded-lg text-sm text-indigo-700 focus:ring-2 focus:ring-indigo-500 outline-none resize-none">${esc(r.response || '')}</textarea>
            <div class="flex gap-2 mt-2">
              <button onclick="cancelEdit(${r.id})" class="px-3 py-1.5 text-xs font-medium border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50 transition">Cancel</button>
              <button onclick="sendEdited(${r.id})" class="px-3 py-1.5 text-xs font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition">Save & Send</button>
            </div>
          </div>` : ''}
        </div>
        <div>
          <h4 class="font-semibold text-gray-700 mb-1">Reasoning</h4>
          <p class="text-gray-500 text-xs">${esc(r.reasoning || 'N/A')}</p>
        </div>
        ${renderContextWindow(r.context_used)}
        <div class="pt-2 border-t border-gray-200">
          <button onclick="event.stopPropagation(); openKbAppendModal(${r.id})" class="px-3 py-1.5 text-xs font-medium border border-indigo-300 text-indigo-600 rounded-lg hover:bg-indigo-50 transition">Add to Knowledge Base</button>
        </div>
      </div>
    </div>`;
}

function renderContextWindow(ctx) {
  if (!ctx || !ctx.length) return '<p class="text-xs text-gray-400">No context window data</p>';
  return `
    <div>
      <h4 class="font-semibold text-gray-700 mb-1">Context Window (${ctx.length} messages)</h4>
      <div class="bg-white rounded-lg border border-gray-200 max-h-48 overflow-y-auto scrollbar-thin">
        ${ctx.map(m => {
          const marker = m.same_sender ? 'bg-indigo-50 border-l-2 border-indigo-400' : '';
          return `<div class="px-3 py-1.5 text-xs ${marker}"><span class="font-medium text-gray-700">${esc(m.sender_name)}:</span> <span class="text-gray-500">${esc(m.message)}</span></div>`;
        }).join('')}
      </div>
    </div>`;
}

function toggleDetail(id) {
  const el = document.getElementById(typeof id === 'string' ? `detail-${id}` : `detail-${id}`);
  if (el) el.classList.toggle('hidden');
}

async function dismissResponse(id) {
  if (!confirm('Dismiss this response? It will be moved to the Ignored tab.')) return;
  try {
    await api(`/dashboard/responses/${id}/dismiss`, { method: 'POST' });
    showToast('Moved to Ignored');
    loadResponses();
    loadIgnored();
    loadStats();
  } catch (err) {
    alert('Failed: ' + err.message);
  }
}

async function reevaluateResponse(id, btn) {
  const origText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Evaluating...';
  try {
    const data = await api(`/dashboard/responses/${id}/reevaluate`, { method: 'POST' });
    showToast(data.response.status === 'ignored' ? 'Re-evaluated — now ignored' : 'Re-evaluated — new response ready');
    loadResponses();
    loadStats();
  } catch (err) {
    alert('Re-evaluate failed: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = origText;
  }
}

function editResponse(id) {
  document.getElementById(`response-display-${id}`).classList.add('hidden');
  document.getElementById(`response-edit-${id}`).classList.remove('hidden');
  document.getElementById(`response-textarea-${id}`).focus();
}

function cancelEdit(id) {
  document.getElementById(`response-edit-${id}`).classList.add('hidden');
  document.getElementById(`response-display-${id}`).classList.remove('hidden');
}

async function sendResponse(id) {
  if (!confirm('Send this response to the WhatsApp group?')) return;
  try {
    await api(`/dashboard/responses/${id}/send`, { method: 'POST' });
    showToast('Response sent!');
    loadResponses();
    loadStats();
  } catch (err) {
    alert('Failed: ' + err.message);
  }
}

async function sendEdited(id) {
  const textarea = document.getElementById(`response-textarea-${id}`);
  const editedResponse = textarea.value.trim();
  if (!editedResponse) return alert('Response cannot be empty');
  if (!confirm('Send this edited response to the WhatsApp group?')) return;
  try {
    await api(`/dashboard/responses/${id}/send`, {
      method: 'POST',
      body: JSON.stringify({ response: editedResponse }),
    });
    showToast('Edited response sent!');
    loadResponses();
    loadStats();
  } catch (err) {
    alert('Failed: ' + err.message);
  }
}

// ─── Ignored ─────────────────────────────────────────
async function loadIgnored() {
  try {
    const data = await api('/dashboard/ignored?limit=50');
    const container = document.getElementById('ignoredList');
    const empty = document.getElementById('ignoredEmpty');

    if (!data.ignored.length) {
      container.innerHTML = '';
      empty.classList.remove('hidden');
      return;
    }
    empty.classList.add('hidden');

    document.getElementById('ignoredStatsLabel').textContent = `${data.total} ignored messages`;
    data.ignored.forEach(r => { chatMessages[r.id] = r.message; });
    container.innerHTML = data.ignored.map(r => ignoredCard(r)).join('');
  } catch (err) {
    console.error('Failed to load ignored:', err);
  }
}

function ignoredCard(r) {
  const time = new Date(r.created_at).toLocaleString();
  const confidence = r.confidence ? `${Math.round(r.confidence * 100)}%` : '-';

  return `
    <div class="bg-white rounded-xl border border-gray-200 overflow-hidden fade-in">
      <div class="px-5 py-4 cursor-pointer hover:bg-gray-50 transition" onclick="toggleDetail(${r.id})">
        <div class="flex items-start justify-between gap-4">
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 mb-1">
              <span class="text-sm font-medium text-gray-900">${esc(r.sender_name)}</span>
              <span class="text-xs text-gray-400 font-mono">${esc(r.sender_id || '')}</span>
              <span class="px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-500 rounded-full">Ignored</span>
              <span class="text-xs text-gray-400">${confidence} confidence</span>
            </div>
            <p class="text-sm text-gray-600 truncate">${esc(r.message)}</p>
            <p class="text-xs text-gray-400 mt-1 truncate">${esc(r.reasoning || '')}</p>
          </div>
          <span class="text-xs text-gray-400 whitespace-nowrap">${time}</span>
        </div>
      </div>
      <div id="detail-${r.id}" class="hidden border-t border-gray-100 px-5 py-4 bg-gray-50 text-sm space-y-4">
        <div>
          <h4 class="font-semibold text-gray-700 mb-1">Original Message</h4>
          <p class="text-gray-600 bg-white rounded-lg p-3 border border-gray-200">${esc(r.message)}</p>
        </div>
        <div>
          <h4 class="font-semibold text-gray-700 mb-1">Reasoning</h4>
          <p class="text-gray-500 text-xs">${esc(r.reasoning || 'N/A')}</p>
        </div>
        ${renderContextWindow(r.context_used)}
        <div class="pt-2 border-t border-gray-200 flex gap-2">
          <button onclick="event.stopPropagation(); openKbAppendModal(${r.id})" class="px-3 py-1.5 text-xs font-medium border border-indigo-300 text-indigo-600 rounded-lg hover:bg-indigo-50 transition">Add to Knowledge Base</button>
          <button onclick="event.stopPropagation(); reevaluateIgnored(${r.id}, this)" class="px-3 py-1.5 text-xs font-medium border border-amber-300 text-amber-700 rounded-lg hover:bg-amber-50 transition">Re-evaluate</button>
        </div>
      </div>
    </div>`;
}

// ─── Actions ────────────────────────────────────────────
async function loadActions() {
  try {
    const data = await api('/dashboard/actions?limit=50');
    const container = document.getElementById('actionsList');
    const empty = document.getElementById('actionsEmpty');

    if (!data.actions.length) {
      container.innerHTML = '';
      empty.classList.remove('hidden');
      return;
    }
    empty.classList.add('hidden');

    document.getElementById('actionsStatsLabel').textContent = `${data.pending} pending / ${data.total} total`;
    container.innerHTML = data.actions.map(a => actionCard(a)).join('');
  } catch (err) {
    console.error('Failed to load actions:', err);
  }
}

function actionCard(a) {
  const time = new Date(a.created_at).toLocaleString();
  const isPending = a.status === 'pending';

  const typeLabels = {
    remove_host: 'Remove Host',
  };
  const typeColors = {
    remove_host: 'bg-red-100 text-red-700',
  };

  const typeLabel = typeLabels[a.action_type] || a.action_type;
  const typeColor = typeColors[a.action_type] || 'bg-gray-100 text-gray-700';

  const statusBadge = isPending
    ? '<span class="px-2 py-0.5 text-xs font-medium bg-orange-100 text-orange-700 rounded-full">Pending</span>'
    : `<span class="px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700 rounded-full">Resolved</span>`;

  const resolveBtn = isPending
    ? `<button onclick="resolveAction(${a.id})" class="ml-2 px-3 py-1 text-xs font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 transition">Mark Resolved</button>`
    : '';

  const details = a.details || {};

  return `
    <div class="bg-white rounded-xl border border-gray-200 overflow-hidden fade-in">
      <div class="px-5 py-4 cursor-pointer hover:bg-gray-50 transition" onclick="toggleDetail('action-${a.id}')">
        <div class="flex items-start justify-between gap-4">
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 mb-1">
              <span class="text-sm font-medium text-gray-900">${esc(a.sender_name)}</span>
              <span class="text-xs text-gray-400 font-mono">${esc(a.sender_id || '')}</span>
              <span class="px-2 py-0.5 text-xs font-medium ${typeColor} rounded-full">${typeLabel}</span>
              ${statusBadge}
              ${resolveBtn}
            </div>
            <p class="text-sm text-gray-600 truncate">${esc(a.original_message || (details.message || ''))}</p>
          </div>
          <span class="text-xs text-gray-400 whitespace-nowrap">${time}</span>
        </div>
      </div>
      <div id="detail-action-${a.id}" class="hidden border-t border-gray-100 px-5 py-4 bg-gray-50 text-sm space-y-4">
        <div>
          <h4 class="font-semibold text-gray-700 mb-1">Original Message</h4>
          <p class="text-gray-600 bg-white rounded-lg p-3 border border-gray-200">${esc(a.original_message || (details.message || 'N/A'))}</p>
        </div>
        <div>
          <h4 class="font-semibold text-gray-700 mb-1">Reasoning</h4>
          <p class="text-gray-500 text-xs">${esc(details.reasoning || 'N/A')}</p>
        </div>
        ${a.resolved_at ? `<div>
          <h4 class="font-semibold text-gray-700 mb-1">Resolved</h4>
          <p class="text-gray-500 text-xs">${new Date(a.resolved_at).toLocaleString()} by ${esc(a.resolved_by || 'admin')}</p>
        </div>` : ''}
      </div>
    </div>`;
}

async function resolveAction(id) {
  if (!confirm('Mark this action as resolved?')) return;
  try {
    await api(`/dashboard/actions/${id}/resolve`, { method: 'POST' });
    showToast('Action resolved');
    loadActions();
    loadStats();
  } catch (err) {
    alert('Failed: ' + err.message);
  }
}

// ─── KB Append Modal ────────────────────────────────────
let kbAppendChatId = null;
const chatMessages = {};
const chatResponses = {};

function openKbAppendModal(chatId) {
  kbAppendChatId = chatId;
  document.getElementById('kbAppendOriginal').textContent = chatMessages[chatId] || '';
  const msg = chatMessages[chatId] || '';
  const resp = chatResponses[chatId] || '';
  document.getElementById('kbAppendText').value = resp ? `Q: ${msg}\nA: ${resp}` : '';
  document.getElementById('kbAppendReeval').checked = true;
  document.getElementById('kbAppendModal').classList.remove('hidden');
  document.getElementById('kbAppendText').focus();
}

function closeKbAppendModal() {
  document.getElementById('kbAppendModal').classList.add('hidden');
  kbAppendChatId = null;
}

async function submitKbAppend() {
  const text = document.getElementById('kbAppendText').value.trim();
  if (!text) return alert('Please enter knowledge base content.');

  const btn = document.getElementById('kbAppendSubmitBtn');
  const reeval = document.getElementById('kbAppendReeval').checked;
  btn.disabled = true;
  btn.textContent = reeval ? 'Adding & Re-evaluating...' : 'Adding...';

  try {
    await api('/dashboard/knowledge/append', {
      method: 'POST',
      body: JSON.stringify({ content: text }),
    });

    if (reeval && kbAppendChatId) {
      await api(`/dashboard/responses/${kbAppendChatId}/reevaluate`, { method: 'POST' });
      showToast('Knowledge added & message re-evaluated');
    } else {
      showToast('Knowledge added');
    }

    closeKbAppendModal();
    loadResponses();
    loadIgnored();
    loadStats();
  } catch (err) {
    alert('Failed: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Add & Re-evaluate';
  }
}

async function reevaluateIgnored(id, btn) {
  const origText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Evaluating...';
  try {
    const data = await api(`/dashboard/responses/${id}/reevaluate`, { method: 'POST' });
    showToast(data.response.status === 'ignored' ? 'Still ignored after re-evaluation' : 'Re-evaluated — response generated!');
    loadResponses();
    loadIgnored();
    loadStats();
  } catch (err) {
    alert('Re-evaluate failed: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = origText;
  }
}

// ─── Knowledge Base ─────────────────────────────────────
async function loadKnowledge() {
  try {
    const data = await api('/dashboard/knowledge');
    const textarea = document.getElementById('knowledgeBlob');
    textarea.value = data.content || '';
    document.getElementById('kbCharCount').textContent = (data.content || '').length.toLocaleString() + ' chars';
    if (data.updated_at) {
      document.getElementById('kbLastSaved').textContent = 'Last saved: ' + new Date(data.updated_at).toLocaleString();
    }
  } catch (err) {
    console.error('Failed to load knowledge base:', err);
  }
}

async function saveKnowledge() {
  const content = document.getElementById('knowledgeBlob').value;
  const btn = document.getElementById('kbSaveBtn');
  btn.disabled = true;
  btn.textContent = 'Saving...';
  try {
    await api('/dashboard/knowledge', { method: 'PUT', body: JSON.stringify({ content }) });
    document.getElementById('kbLastSaved').textContent = 'Last saved: ' + new Date().toLocaleString();
    showToast('Knowledge base saved');
  } catch (err) {
    alert('Failed: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save';
  }
}

async function runEnrichment() {
  const days = parseInt(document.getElementById('enrichDays').value) || 7;
  const btn = document.getElementById('enrichBtn');
  btn.disabled = true;
  btn.textContent = 'Enriching...';
  try {
    const result = await api('/dashboard/knowledge/enrich', {
      method: 'POST',
      body: JSON.stringify({ days }),
    });
    if (result.added) {
      showToast(`Added ${result.charsAdded} chars from ${result.answeredMessages} answered messages`);
      loadKnowledge();
    } else {
      showToast(result.reason || 'No new knowledge found');
    }
  } catch (err) {
    alert('Enrichment failed: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Auto-Enrich';
  }
}

// ─── Admin Authors ──────────────────────────────────────
async function loadAdminAuthors() {
  try {
    const data = await api('/dashboard/admin-authors');
    const container = document.getElementById('adminAuthorsList');
    if (!data.authors.length) {
      container.innerHTML = '<p class="text-gray-400 text-sm">No admin authors configured</p>';
      return;
    }
    container.innerHTML = data.authors.map(a => `
      <div class="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
        <div>
          <span class="text-sm font-medium text-gray-900">${esc(a.sender_id)}</span>
          ${a.sender_name ? `<span class="text-sm text-gray-500 ml-2">${esc(a.sender_name)}</span>` : ''}
        </div>
        <button onclick="removeAdminAuthor(${a.id})" class="text-xs text-red-500 hover:text-red-700">Remove</button>
      </div>
    `).join('');
  } catch (err) {
    console.error('Failed to load admin authors:', err);
  }
}

async function addAdminAuthor() {
  const senderId = document.getElementById('addAdminSenderId').value.trim();
  const senderName = document.getElementById('addAdminSenderName').value.trim();
  if (!senderId) return alert('Sender ID is required');
  try {
    await api('/dashboard/admin-authors', { method: 'POST', body: JSON.stringify({ sender_id: senderId, sender_name: senderName }) });
    document.getElementById('addAdminSenderId').value = '';
    document.getElementById('addAdminSenderName').value = '';
    showToast('Admin author added');
    loadAdminAuthors();
  } catch (err) {
    alert('Failed: ' + err.message);
  }
}

async function removeAdminAuthor(id) {
  if (!confirm('Remove this admin author?')) return;
  try {
    await api(`/dashboard/admin-authors/${id}`, { method: 'DELETE' });
    loadAdminAuthors();
  } catch (err) {
    alert('Failed: ' + err.message);
  }
}

// ─── Test ───────────────────────────────────────────────
async function runTest() {
  const input = document.getElementById('testInput');
  const senderName = document.getElementById('testSenderName').value.trim() || 'Test User';
  const message = input.value.trim();
  if (!message) return;

  const btn = document.getElementById('testBtn');
  btn.disabled = true;
  btn.textContent = 'Testing...';

  try {
    const result = await api('/dashboard/test', {
      method: 'POST',
      body: JSON.stringify({ message, sender_name: senderName }),
    });

    const container = document.getElementById('testResults');
    const card = testResultCard(message, senderName, result);
    container.insertAdjacentHTML('afterbegin', card);
    input.value = '';
  } catch (err) {
    alert('Test failed: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Test';
  }
}

function testResultCard(message, senderName, r) {
  const actionBadges = {
    answer: '<span class="px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700 rounded-full">Answer</span>',
    remove_host: '<span class="px-2 py-0.5 text-xs font-medium bg-red-100 text-red-700 rounded-full">Remove Host</span>',
    ignore: '<span class="px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-500 rounded-full">Ignore</span>',
  };
  const respondBadge = actionBadges[r.action] || (r.shouldRespond
    ? '<span class="px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700 rounded-full">Would Respond</span>'
    : '<span class="px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-500 rounded-full">Would Ignore</span>');
  const confidence = r.confidence ? `${Math.round(r.confidence * 100)}%` : '-';

  return `
    <div class="bg-white rounded-xl border border-gray-200 p-5 fade-in">
      <div class="flex items-center gap-2 mb-3">
        ${respondBadge}
        <span class="text-xs text-gray-400">${confidence} confidence</span>
      </div>
      <div class="mb-3">
        <p class="text-xs text-gray-400 mb-1">${esc(senderName)} asked:</p>
        <p class="text-sm text-gray-800 bg-gray-50 rounded-lg p-3">${esc(message)}</p>
      </div>
      ${r.response ? `
        <div class="mb-3">
          <p class="text-xs text-gray-400 mb-1">Bot would reply:</p>
          <p class="text-sm text-indigo-700 bg-indigo-50 rounded-lg p-3">${esc(r.response)}</p>
        </div>
      ` : ''}
      <div class="text-xs text-gray-400">
        <span class="font-medium">Reasoning:</span> ${esc(r.reasoning || 'N/A')}
      </div>
    </div>`;
}

// ─── Utilities ──────────────────────────────────────────
function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
}

function esc(str) {
  if (!str) return '';
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// ─── Auto-login on page load ────────────────────────────
if (token) {
  fetch(`${API_BASE}/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
    .then(r => { if (r.ok) return r.json(); throw new Error(); })
    .then(data => {
      document.getElementById('adminName').textContent = data.user.username;
      showDashboard();
    })
    .catch(() => { token = null; localStorage.removeItem('token'); });
}

// Auto-refresh every 30 seconds
setInterval(() => { if (token) refreshAll(); }, 30000);
