function toEST(dateStr) {
  return new Date(dateStr).toLocaleString('en-US', { timeZone: 'America/New_York' });
}

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
  socket.on('email_processed', () => {
    if (currentView === 'email') loadEmailList();
    loadEmailStats();
  });
  socket.on('email_sent', () => {
    if (currentView === 'email') loadEmailList();
    loadEmailStats();
  });
  socket.on('email_backfill_progress', (data) => {
    updateBackfillProgress(data);
  });
  socket.on('email_backfill_complete', (data) => {
    updateBackfillComplete(data);
    if (currentView === 'email') loadEmailList();
    loadEmailStats();
  });
}

function updateWhatsAppStatus(status) {
  const el = document.getElementById('whatsappStatus');
  if (status === 'connected') {
    el.className = 'flex items-center gap-1.5 ml-4 px-3 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700';
    el.innerHTML = '<span class="w-2 h-2 rounded-full bg-green-500 pulse-dot"></span> WhatsApp';
  } else {
    el.className = 'flex items-center gap-1.5 ml-4 px-3 py-1 rounded-full text-xs font-medium bg-red-100 text-red-600';
    el.innerHTML = '<span class="w-2 h-2 rounded-full bg-red-500"></span> WhatsApp';
  }
}

async function checkWhatsAppStatus() {
  try {
    const data = await fetch(`${API_BASE}/health`).then(r => r.json());
    updateWhatsAppStatus(data.whatsapp);
    updateGmailStatus(data.gmail);
  } catch (_) {}
}

function updateGmailStatus(status) {
  const el = document.getElementById('gmailStatus');
  if (status === 'connected') {
    el.className = 'flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700';
    el.innerHTML = '<span class="w-2 h-2 rounded-full bg-green-500 pulse-dot"></span> Gmail';
    document.getElementById('emailNotConnected')?.classList.add('hidden');
  } else {
    el.className = 'flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-red-100 text-red-600';
    el.innerHTML = '<span class="w-2 h-2 rounded-full bg-red-500"></span> Gmail';
    document.getElementById('emailNotConnected')?.classList.remove('hidden');
  }
}

// ─── Toast ──────────────────────────────────────────────
function showToast(msg, type = 'info', onClick = null) {
  const t = document.createElement('div');
  if (type === 'warn') {
    t.className = 'fixed top-4 left-1/2 -translate-x-1/2 bg-amber-500 text-white px-6 py-3 rounded-lg text-sm font-medium shadow-lg z-50 fade-in';
    setTimeout(() => t.remove(), 5000);
  } else {
    t.className = 'fixed bottom-4 right-4 bg-gray-900 text-white px-4 py-2.5 rounded-lg text-sm shadow-lg z-50 fade-in';
    setTimeout(() => t.remove(), 3000);
  }
  t.textContent = msg;
  if (onClick) {
    t.style.cursor = 'pointer';
    t.textContent = msg + ' (click to view)';
    t.addEventListener('click', () => { t.remove(); onClick(); });
  }
  document.body.appendChild(t);
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
  if (view === 'email') { loadEmailList(); loadEmailStats(); }
  if (view === 'faqs') loadKnowledge();
  if (view === 'prompt') loadPrompt();
  if (view === 'settings') loadAdminAuthors();
  if (view === 'test') document.getElementById('testInput').focus();
}

// ─── Refresh ────────────────────────────────────────────
async function refreshAll() {
  checkWhatsAppStatus();
  loadStats();
  loadEmailStats();
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
const PAGE_SIZE = 50;
let responsesOffset = 0;
let responsesTotal = 0;
let ignoredOffset = 0;
let ignoredTotal = 0;

async function loadResponses() {
  responsesOffset = 0;
  try {
    const data = await api(`/dashboard/responses?limit=${PAGE_SIZE}&offset=0`);
    const container = document.getElementById('responsesList');
    const empty = document.getElementById('responsesEmpty');

    responsesTotal = data.total || 0;

    if (!data.responses.length) {
      container.innerHTML = '';
      empty.classList.remove('hidden');
      document.getElementById('responsesLoadMore').classList.add('hidden');
      return;
    }
    empty.classList.add('hidden');

    data.responses.forEach(r => { chatMessages[r.id] = r.message; chatResponses[r.id] = r.response; });
    container.innerHTML = data.responses.map(r => responseCard(r)).join('');
    responsesOffset = data.responses.length;
    document.getElementById('responsesLoadMore').classList.toggle('hidden', responsesOffset >= responsesTotal);
  } catch (err) {
    console.error('Failed to load responses:', err);
  }
}

async function loadMoreResponses() {
  const btn = document.getElementById('responsesLoadMoreBtn');
  btn.disabled = true;
  btn.textContent = 'Loading...';
  try {
    const data = await api(`/dashboard/responses?limit=${PAGE_SIZE}&offset=${responsesOffset}`);
    const container = document.getElementById('responsesList');
    data.responses.forEach(r => { chatMessages[r.id] = r.message; chatResponses[r.id] = r.response; });
    container.insertAdjacentHTML('beforeend', data.responses.map(r => responseCard(r)).join(''));
    responsesOffset += data.responses.length;
    document.getElementById('responsesLoadMore').classList.toggle('hidden', responsesOffset >= responsesTotal);
  } catch (err) {
    console.error('Failed to load more responses:', err);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Load More';
  }
}

function responseCard(r) {
  const time = toEST(r.created_at);
  const isSent = r.status === 'sent';
  const isPending = r.status === 'pending';

  const isVerified = r.verified;

  const statusBadge = isSent
    ? '<span class="px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700 rounded-full">Sent</span>'
    : '<span class="px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-700 rounded-full">Pending</span>';

  const verifiedBadge = isVerified
    ? '<span class="px-2 py-0.5 text-xs font-medium bg-emerald-100 text-emerald-700 rounded-full">Verified</span>'
    : '';

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
              <span class="px-1.5 py-0.5 text-xs font-mono font-medium bg-gray-200 text-gray-600 rounded">#${r.id}</span>
              <span class="text-sm font-medium text-gray-900">${esc(r.sender_name)}</span>
              ${r.group_name ? `<span class="px-2 py-0.5 text-xs font-medium bg-blue-50 text-blue-600 rounded-full" title="${esc(r.group_name)}">${esc(shortGroupName(r.group_name))}</span>` : ''}
              ${statusBadge}
              ${verifiedBadge}
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
        <div class="pt-2 border-t border-gray-200 flex gap-2">
          <button onclick="event.stopPropagation(); openKbAppendModal(${r.id})" class="px-3 py-1.5 text-xs font-medium border border-indigo-300 text-indigo-600 rounded-lg hover:bg-indigo-50 transition">Add to Knowledge Base</button>
          <button onclick="event.stopPropagation(); verifyChat(${r.id}, this)" class="px-3 py-1.5 text-xs font-medium border ${isVerified ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-gray-300 text-gray-600 hover:bg-gray-50'} rounded-lg transition">${isVerified ? 'Verified' : 'Mark as Correct'}</button>
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
    const scrollY = window.scrollY;
    const data = await api(`/dashboard/responses/${id}/reevaluate`, { method: 'POST' });
    if (data.response.status === 'ignored') {
      loadResponses();
      loadStats();
      showToast(`#${id} re-evaluated — moved to Ignored tab`, 'warn', async () => {
        showView('ignored');
        await loadIgnored();
        requestAnimationFrame(() => {
          const card = document.querySelector(`#detail-${id}`)?.parentElement;
          if (card) {
            card.scrollIntoView({ behavior: 'smooth', block: 'center' });
            card.classList.add('ring-2', 'ring-amber-400');
            setTimeout(() => card.classList.remove('ring-2', 'ring-amber-400'), 3000);
          }
        });
      });
    } else {
      showToast(`#${id} re-evaluated — new response ready`);
      loadResponses();
      loadStats();
      requestAnimationFrame(() => window.scrollTo(0, scrollY));
    }
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

// ─── Verify ──────────────────────────────────────────
async function verifyChat(id, btn) {
  const origText = btn.innerHTML;
  btn.disabled = true;
  try {
    const data = await api(`/dashboard/responses/${id}/verify`, { method: 'POST' });
    const isNowVerified = data.response.verified;
    showToast(isNowVerified ? 'Marked as handled correctly' : 'Verification removed');
    if (currentView === 'responses') loadResponses();
    if (currentView === 'ignored') loadIgnored();
  } catch (err) {
    alert('Failed: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = origText;
  }
}

// ─── Ignored ─────────────────────────────────────────
async function loadIgnored() {
  ignoredOffset = 0;
  try {
    const data = await api(`/dashboard/ignored?limit=${PAGE_SIZE}&offset=0`);
    const container = document.getElementById('ignoredList');
    const empty = document.getElementById('ignoredEmpty');

    ignoredTotal = data.total || 0;

    if (!data.ignored.length) {
      container.innerHTML = '';
      empty.classList.remove('hidden');
      document.getElementById('ignoredLoadMore').classList.add('hidden');
      return;
    }
    empty.classList.add('hidden');

    document.getElementById('ignoredStatsLabel').textContent = `${data.total} ignored messages`;
    data.ignored.forEach(r => { chatMessages[r.id] = r.message; });
    container.innerHTML = data.ignored.map(r => ignoredCard(r)).join('');
    ignoredOffset = data.ignored.length;
    document.getElementById('ignoredLoadMore').classList.toggle('hidden', ignoredOffset >= ignoredTotal);
  } catch (err) {
    console.error('Failed to load ignored:', err);
  }
}

async function loadMoreIgnored() {
  const btn = document.getElementById('ignoredLoadMoreBtn');
  btn.disabled = true;
  btn.textContent = 'Loading...';
  try {
    const data = await api(`/dashboard/ignored?limit=${PAGE_SIZE}&offset=${ignoredOffset}`);
    const container = document.getElementById('ignoredList');
    data.ignored.forEach(r => { chatMessages[r.id] = r.message; });
    container.insertAdjacentHTML('beforeend', data.ignored.map(r => ignoredCard(r)).join(''));
    ignoredOffset += data.ignored.length;
    document.getElementById('ignoredLoadMore').classList.toggle('hidden', ignoredOffset >= ignoredTotal);
  } catch (err) {
    console.error('Failed to load more ignored:', err);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Load More';
  }
}

function ignoredCard(r) {
  const time = toEST(r.created_at);
  const confidence = r.confidence ? `${Math.round(r.confidence * 100)}%` : '-';
  const isVerified = r.verified;

  const verifiedBadge = isVerified
    ? '<span class="px-2 py-0.5 text-xs font-medium bg-emerald-100 text-emerald-700 rounded-full">Verified</span>'
    : '';

  return `
    <div class="bg-white rounded-xl border border-gray-200 overflow-hidden fade-in">
      <div class="px-5 py-4 cursor-pointer hover:bg-gray-50 transition" onclick="toggleDetail(${r.id})">
        <div class="flex items-start justify-between gap-4">
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 mb-1">
              <span class="px-1.5 py-0.5 text-xs font-mono font-medium bg-gray-200 text-gray-600 rounded">#${r.id}</span>
              <span class="text-sm font-medium text-gray-900">${esc(r.sender_name)}</span>
              ${r.group_name ? `<span class="px-2 py-0.5 text-xs font-medium bg-blue-50 text-blue-600 rounded-full" title="${esc(r.group_name)}">${esc(shortGroupName(r.group_name))}</span>` : ''}
              <span class="px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-500 rounded-full">Ignored</span>
              ${verifiedBadge}
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
          <button onclick="event.stopPropagation(); verifyChat(${r.id}, this)" class="px-3 py-1.5 text-xs font-medium border ${isVerified ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-gray-300 text-gray-600 hover:bg-gray-50'} rounded-lg transition">${isVerified ? 'Verified' : 'Mark as Correct'}</button>
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
  const time = toEST(a.created_at);
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
  const isEmail = details.source === 'email' || a.group_id === 'email';

  return `
    <div class="bg-white rounded-xl border border-gray-200 overflow-hidden fade-in">
      <div class="px-5 py-4 cursor-pointer hover:bg-gray-50 transition" onclick="toggleDetail('action-${a.id}')">
        <div class="flex items-start justify-between gap-4">
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 mb-1">
              <span class="text-sm font-medium text-gray-900">${esc(a.sender_name)}</span>
              ${isEmail ? '<span class="px-2 py-0.5 text-xs font-medium bg-purple-50 text-purple-600 rounded-full">Email</span>' : ''}
              ${!isEmail && a.group_name ? `<span class="px-2 py-0.5 text-xs font-medium bg-blue-50 text-blue-600 rounded-full" title="${esc(a.group_name)}">${esc(shortGroupName(a.group_name))}</span>` : ''}
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
        ${details.host_name || details.host_email || details.host_phone ? `
        <div class="bg-white rounded-lg p-3 border border-gray-200">
          <h4 class="font-semibold text-gray-700 mb-2">Host Info</h4>
          <div class="grid grid-cols-2 gap-2 text-xs">
            ${details.host_name ? `<div><span class="text-gray-400">Name:</span> <span class="text-gray-800 font-medium">${esc(details.host_name)}</span></div>` : ''}
            ${details.host_email ? `<div><span class="text-gray-400">Email:</span> <span class="text-gray-800 font-medium">${esc(details.host_email)}</span></div>` : ''}
            ${details.host_phone ? `<div><span class="text-gray-400">Phone:</span> <span class="text-gray-800 font-medium">${esc(details.host_phone)}</span></div>` : ''}
          </div>
        </div>` : ''}
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
          <p class="text-gray-500 text-xs">${toEST(a.resolved_at)} by ${esc(a.resolved_by || 'admin')}</p>
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
let kbOriginalContent = '';

function toggleKbEdit() {
  const textarea = document.getElementById('knowledgeBlob');
  kbOriginalContent = textarea.value;
  textarea.readOnly = false;
  textarea.classList.remove('bg-gray-50', 'cursor-default');
  textarea.classList.add('bg-white');
  textarea.focus();
  document.getElementById('kbEditBtn').classList.add('hidden');
  document.getElementById('kbSaveBtn').classList.remove('hidden');
  document.getElementById('kbCancelBtn').classList.remove('hidden');
}

function cancelKbEdit() {
  const textarea = document.getElementById('knowledgeBlob');
  textarea.value = kbOriginalContent;
  textarea.readOnly = true;
  textarea.classList.add('bg-gray-50', 'cursor-default');
  textarea.classList.remove('bg-white');
  document.getElementById('kbEditBtn').classList.remove('hidden');
  document.getElementById('kbSaveBtn').classList.add('hidden');
  document.getElementById('kbCancelBtn').classList.add('hidden');
  document.getElementById('kbCharCount').textContent = kbOriginalContent.length.toLocaleString() + ' chars';
}

function exitKbEditMode() {
  const textarea = document.getElementById('knowledgeBlob');
  textarea.readOnly = true;
  textarea.classList.add('bg-gray-50', 'cursor-default');
  textarea.classList.remove('bg-white');
  document.getElementById('kbEditBtn').classList.remove('hidden');
  document.getElementById('kbSaveBtn').classList.add('hidden');
  document.getElementById('kbCancelBtn').classList.add('hidden');
}

async function loadKnowledge() {
  try {
    const data = await api('/dashboard/knowledge');
    const textarea = document.getElementById('knowledgeBlob');
    textarea.value = data.content || '';
    document.getElementById('kbCharCount').textContent = (data.content || '').length.toLocaleString() + ' chars';
    if (data.updated_at) {
      document.getElementById('kbLastSaved').textContent = 'Last saved: ' + toEST(data.updated_at);
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
    document.getElementById('kbLastSaved').textContent = 'Last saved: ' + toEST(new Date());
    showToast('Knowledge base saved');
    exitKbEditMode();
  } catch (err) {
    alert('Failed: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save';
  }
}

// ─── LLM Prompt ────────────────────────────────────────
let promptOriginalContent = '';
let promptDefaultTemplate = '';

async function loadPrompt() {
  try {
    const data = await api('/dashboard/prompt');
    const textarea = document.getElementById('promptBlob');
    textarea.value = data.content || '';
    promptDefaultTemplate = data.defaultTemplate || '';
    document.getElementById('promptCharCount').textContent = (data.content || '').length.toLocaleString() + ' chars';
    if (data.updated_at) {
      document.getElementById('promptLastSaved').textContent = 'Last saved: ' + toEST(data.updated_at);
    } else {
      document.getElementById('promptLastSaved').textContent = 'Using default template';
    }
    document.getElementById('promptCustomBadge').classList.toggle('hidden', !data.isCustom);
  } catch (err) {
    console.error('Failed to load prompt:', err);
  }
}

function togglePromptEdit() {
  const textarea = document.getElementById('promptBlob');
  promptOriginalContent = textarea.value;
  textarea.readOnly = false;
  textarea.classList.remove('bg-gray-50', 'cursor-default');
  textarea.classList.add('bg-white');
  textarea.focus();
  document.getElementById('promptEditBtn').classList.add('hidden');
  document.getElementById('promptSaveBtn').classList.remove('hidden');
  document.getElementById('promptCancelBtn').classList.remove('hidden');
}

function cancelPromptEdit() {
  const textarea = document.getElementById('promptBlob');
  textarea.value = promptOriginalContent;
  textarea.readOnly = true;
  textarea.classList.add('bg-gray-50', 'cursor-default');
  textarea.classList.remove('bg-white');
  document.getElementById('promptEditBtn').classList.remove('hidden');
  document.getElementById('promptSaveBtn').classList.add('hidden');
  document.getElementById('promptCancelBtn').classList.add('hidden');
  document.getElementById('promptCharCount').textContent = promptOriginalContent.length.toLocaleString() + ' chars';
}

function exitPromptEditMode() {
  const textarea = document.getElementById('promptBlob');
  textarea.readOnly = true;
  textarea.classList.add('bg-gray-50', 'cursor-default');
  textarea.classList.remove('bg-white');
  document.getElementById('promptEditBtn').classList.remove('hidden');
  document.getElementById('promptSaveBtn').classList.add('hidden');
  document.getElementById('promptCancelBtn').classList.add('hidden');
}

async function savePrompt() {
  const content = document.getElementById('promptBlob').value;
  const btn = document.getElementById('promptSaveBtn');
  btn.disabled = true;
  btn.textContent = 'Saving...';
  try {
    await api('/dashboard/prompt', { method: 'PUT', body: JSON.stringify({ content }) });
    document.getElementById('promptLastSaved').textContent = 'Last saved: ' + toEST(new Date());
    document.getElementById('promptCustomBadge').classList.remove('hidden');
    showToast('LLM prompt saved — takes effect on next message');
    exitPromptEditMode();
  } catch (err) {
    alert('Failed: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save';
  }
}

async function resetPrompt() {
  if (!confirm('Reset the LLM prompt to the default template? Your custom prompt will be deleted.')) return;
  try {
    await api('/dashboard/prompt/reset', { method: 'POST' });
    showToast('Prompt reset to default');
    loadPrompt();
  } catch (err) {
    alert('Reset failed: ' + err.message);
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

// ─── Email ──────────────────────────────────────────────
let emailFilter = null;
let emailOffset = 0;
let emailTotal = 0;

async function loadEmailStats() {
  try {
    const data = await api('/email/status');
    document.getElementById('emailBadge').textContent = data.pending || 0;
    document.getElementById('emailStatsLabel').textContent =
      `${data.total || 0} total | ${data.drafts || 0} drafts | ${data.sent || 0} sent`;
    updateGmailStatus(data.gmailConnected ? 'connected' : 'disconnected');
  } catch (_) {}
}

async function loadEmailList(filter) {
  if (filter !== undefined) emailFilter = filter;
  emailOffset = 0;

  // Update filter button styles
  document.querySelectorAll('.email-filter-btn').forEach(b => {
    b.classList.remove('bg-indigo-100', 'text-indigo-700', 'border-indigo-300');
  });
  const activeFilter = emailFilter || 'all';
  document.querySelector(`.email-filter-btn[data-filter="${activeFilter}"]`)?.classList.add('bg-indigo-100', 'text-indigo-700', 'border-indigo-300');

  try {
    const params = `limit=${PAGE_SIZE}&offset=0${emailFilter ? `&filter=${emailFilter}` : ''}`;
    const data = await api(`/email/list?${params}`);
    const container = document.getElementById('emailList');
    const empty = document.getElementById('emailEmpty');

    emailTotal = data.total || 0;

    if (!data.emails.length) {
      container.innerHTML = '';
      empty.classList.remove('hidden');
      document.getElementById('emailLoadMore').classList.add('hidden');
      return;
    }
    empty.classList.add('hidden');
    container.innerHTML = data.emails.map(e => emailCard(e)).join('');
    emailOffset = data.emails.length;
    document.getElementById('emailLoadMore').classList.toggle('hidden', emailOffset >= emailTotal);
  } catch (err) {
    console.error('Failed to load emails:', err);
  }
}

async function loadMoreEmails() {
  const btn = document.getElementById('emailLoadMoreBtn');
  btn.disabled = true;
  btn.textContent = 'Loading...';
  try {
    const params = `limit=${PAGE_SIZE}&offset=${emailOffset}${emailFilter ? `&filter=${emailFilter}` : ''}`;
    const data = await api(`/email/list?${params}`);
    const container = document.getElementById('emailList');
    container.insertAdjacentHTML('beforeend', data.emails.map(e => emailCard(e)).join(''));
    emailOffset += data.emails.length;
    document.getElementById('emailLoadMore').classList.toggle('hidden', emailOffset >= emailTotal);
  } catch (err) {
    console.error('Failed to load more emails:', err);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Load More';
  }
}

function emailCard(e) {
  const time = e.received_at ? toEST(e.received_at) : '';
  const classification = e.classification || 'new';

  const statusBadges = {
    new: '<span class="px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-700 rounded-full">New</span>',
    answer: '<span class="px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700 rounded-full">Answer</span>',
    remove_host: '<span class="px-2 py-0.5 text-xs font-medium bg-red-100 text-red-700 rounded-full">Remove Host</span>',
    ignore: '<span class="px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-500 rounded-full">Ignored</span>',
    duplicate: '<span class="px-2 py-0.5 text-xs font-medium bg-yellow-100 text-yellow-700 rounded-full">Duplicate</span>',
    error: '<span class="px-2 py-0.5 text-xs font-medium bg-red-100 text-red-600 rounded-full">Error</span>',
  };

  const draftBadge = e.gmail_draft_id
    ? '<span class="px-2 py-0.5 text-xs font-medium bg-purple-100 text-purple-700 rounded-full">Draft</span>'
    : '';
  const sentBadge = e.status === 'sent'
    ? '<span class="px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700 rounded-full">Sent</span>'
    : '';

  const confidence = e.confidence ? `${Math.round(e.confidence * 100)}%` : '';

  const canAct = e.status !== 'sent' && e.status !== 'ignored' && classification !== 'duplicate';
  const actionBtns = canAct ? `
    ${classification === 'new' ? `<button onclick="event.stopPropagation(); processEmailItem(${e.id}, this)" class="px-3 py-1 text-xs font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition">Process</button>` : ''}
    ${e.response && !e.gmail_draft_id ? `<button onclick="event.stopPropagation(); createEmailDraft(${e.id}, this)" class="px-3 py-1 text-xs font-medium bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition">Create Draft</button>` : ''}
    ${e.gmail_draft_id && e.status !== 'sent' ? `<button onclick="event.stopPropagation(); sendEmailDraft(${e.id})" class="px-3 py-1 text-xs font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 transition">Send</button>` : ''}
    <button onclick="event.stopPropagation(); dismissEmail(${e.id})" class="px-3 py-1 text-xs font-medium border border-red-300 text-red-600 rounded-lg hover:bg-red-50 transition">Dismiss</button>
    <button onclick="event.stopPropagation(); reevaluateEmail(${e.id}, this)" class="px-3 py-1 text-xs font-medium border border-amber-300 text-amber-700 rounded-lg hover:bg-amber-50 transition">Re-evaluate</button>
  ` : '';

  return `
    <div class="bg-white rounded-xl border border-gray-200 overflow-hidden fade-in">
      <div class="px-5 py-4 cursor-pointer hover:bg-gray-50 transition" onclick="toggleDetail('email-${e.id}')">
        <div class="flex items-start justify-between gap-4">
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 mb-1 flex-wrap">
              <span class="px-1.5 py-0.5 text-xs font-mono font-medium bg-gray-200 text-gray-600 rounded">#${e.id}</span>
              <span class="text-sm font-medium text-gray-900">${esc(e.from_name || e.from_address)}</span>
              ${statusBadges[classification] || ''}
              ${draftBadge}
              ${sentBadge}
              ${confidence ? `<span class="text-xs text-gray-400">${confidence}</span>` : ''}
              ${actionBtns}
            </div>
            <p class="text-sm font-medium text-gray-700 truncate">${esc(e.subject)}</p>
            <p class="text-xs text-gray-500 mt-0.5 truncate">${esc(e.body_snippet || '')}</p>
          </div>
          <span class="text-xs text-gray-400 whitespace-nowrap">${time}</span>
        </div>
      </div>
      <div id="detail-email-${e.id}" class="hidden border-t border-gray-100 px-5 py-4 bg-gray-50 text-sm space-y-4">
        <div>
          <h4 class="font-semibold text-gray-700 mb-1">From</h4>
          <p class="text-gray-600 text-xs">${esc(e.from_name || '')} &lt;${esc(e.from_address || '')}&gt;</p>
        </div>
        <div>
          <h4 class="font-semibold text-gray-700 mb-1">Subject</h4>
          <p class="text-gray-600">${esc(e.subject)}</p>
        </div>
        <div>
          <h4 class="font-semibold text-gray-700 mb-1">Email Body</h4>
          <pre class="text-gray-600 bg-white rounded-lg p-3 border border-gray-200 text-xs whitespace-pre-wrap max-h-64 overflow-y-auto scrollbar-thin">${esc(e.body_text || e.body_snippet || '')}</pre>
        </div>
        ${e.response ? `
          <div>
            <h4 class="font-semibold text-gray-700 mb-1">Draft Reply ${e.gmail_draft_id ? '(in Gmail)' : ''}</h4>
            <div id="email-response-display-${e.id}">
              <pre class="text-indigo-700 bg-indigo-50 rounded-lg p-3 border border-indigo-100 text-xs whitespace-pre-wrap">${esc(e.response)}</pre>
            </div>
            ${canAct ? `
              <div class="mt-2">
                <button onclick="event.stopPropagation(); editEmailDraft(${e.id})" class="px-3 py-1.5 text-xs font-medium border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50 transition">Edit Draft</button>
              </div>
              <div id="email-edit-${e.id}" class="hidden mt-2">
                <textarea id="email-textarea-${e.id}" rows="6" class="w-full px-3 py-2.5 border border-indigo-300 rounded-lg text-sm text-indigo-700 focus:ring-2 focus:ring-indigo-500 outline-none resize-none">${esc(e.response)}</textarea>
                <div class="flex gap-2 mt-2">
                  <button onclick="event.stopPropagation(); cancelEmailEdit(${e.id})" class="px-3 py-1.5 text-xs font-medium border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50 transition">Cancel</button>
                  <button onclick="event.stopPropagation(); saveEmailDraft(${e.id})" class="px-3 py-1.5 text-xs font-medium bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition">Save Draft</button>
                </div>
              </div>
            ` : ''}
          </div>
        ` : ''}
        ${e.reasoning ? `
          <div>
            <h4 class="font-semibold text-gray-700 mb-1">Reasoning</h4>
            <p class="text-gray-500 text-xs">${esc(e.reasoning)}</p>
          </div>
        ` : ''}
        ${e.duplicate_of ? `
          <div>
            <p class="text-xs text-yellow-700">Duplicate of email #${e.duplicate_of}</p>
          </div>
        ` : ''}
      </div>
    </div>`;
}

async function fetchEmails() {
  const btn = document.getElementById('emailFetchBtn');
  btn.disabled = true;
  btn.textContent = 'Fetching...';
  try {
    const data = await api('/email/fetch', { method: 'POST' });
    showToast(`Fetched ${data.fetched} new emails`);
    loadEmailList();
    loadEmailStats();
  } catch (err) {
    alert('Fetch failed: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Fetch New';
  }
}

async function processEmailItem(id, btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Processing...'; }
  try {
    await api(`/email/${id}/process`, { method: 'POST' });
    showToast('Email processed');
    loadEmailList();
    loadEmailStats();
  } catch (err) {
    alert('Process failed: ' + err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Process'; }
  }
}

async function createEmailDraft(id, btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Creating...'; }
  try {
    await api(`/email/${id}/draft`, { method: 'POST' });
    showToast('Gmail draft created');
    loadEmailList();
  } catch (err) {
    alert('Draft creation failed: ' + err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Create Draft'; }
  }
}

async function sendEmailDraft(id) {
  if (!confirm('Send this draft reply via Gmail?')) return;
  try {
    await api(`/email/${id}/send`, { method: 'POST' });
    showToast('Email sent!');
    loadEmailList();
    loadEmailStats();
  } catch (err) {
    alert('Send failed: ' + err.message);
  }
}

async function dismissEmail(id) {
  if (!confirm('Dismiss this email?')) return;
  try {
    await api(`/email/${id}/dismiss`, { method: 'POST' });
    showToast('Email dismissed');
    loadEmailList();
    loadEmailStats();
  } catch (err) {
    alert('Dismiss failed: ' + err.message);
  }
}

async function reevaluateEmail(id, btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Evaluating...'; }
  try {
    await api(`/email/${id}/reevaluate`, { method: 'POST' });
    showToast('Email re-evaluated');
    loadEmailList();
    loadEmailStats();
  } catch (err) {
    alert('Re-evaluate failed: ' + err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Re-evaluate'; }
  }
}

function editEmailDraft(id) {
  document.getElementById(`email-response-display-${id}`).classList.add('hidden');
  document.getElementById(`email-edit-${id}`).classList.remove('hidden');
  document.getElementById(`email-textarea-${id}`).focus();
}

function cancelEmailEdit(id) {
  document.getElementById(`email-edit-${id}`).classList.add('hidden');
  document.getElementById(`email-response-display-${id}`).classList.remove('hidden');
}

async function saveEmailDraft(id) {
  const textarea = document.getElementById(`email-textarea-${id}`);
  const response = textarea.value.trim();
  if (!response) return alert('Draft cannot be empty');
  try {
    await api(`/email/${id}/draft`, { method: 'PUT', body: JSON.stringify({ response }) });
    showToast('Draft updated in Gmail');
    loadEmailList();
  } catch (err) {
    alert('Save failed: ' + err.message);
  }
}

// ─── Email Backfill ─────────────────────────────────────
async function startBackfill() {
  const startDate = document.getElementById('backfillStart').value;
  const endDate = document.getElementById('backfillEnd').value;
  const delayMs = parseInt(document.getElementById('backfillDelay').value) || 3000;
  const unreadOnly = document.getElementById('backfillUnread').checked;

  if (!startDate || !endDate) return alert('Select both start and end dates');

  const btn = document.getElementById('backfillBtn');
  btn.disabled = true;
  btn.textContent = 'Starting...';

  try {
    const data = await api('/email/backfill', {
      method: 'POST',
      body: JSON.stringify({ startDate, endDate, delayMs, unreadOnly }),
    });
    showToast(`Backfill started: ${data.toProcess} emails to process`);
    document.getElementById('backfillProgress').classList.remove('hidden');
  } catch (err) {
    alert('Backfill failed: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Start Backfill';
  }
}

async function stopBackfill() {
  try {
    await api('/email/backfill/stop', { method: 'POST' });
    showToast('Backfill stop requested');
  } catch (err) {
    alert('Stop failed: ' + err.message);
  }
}

function updateBackfillProgress(data) {
  document.getElementById('backfillProgress').classList.remove('hidden');
  const pct = data.total > 0 ? Math.round((data.processed / data.total) * 100) : 0;
  document.getElementById('backfillBar').style.width = `${pct}%`;
  document.getElementById('backfillLabel').textContent = `${data.processed}/${data.total}`;
}

function updateBackfillComplete(data) {
  document.getElementById('backfillBar').style.width = '100%';
  document.getElementById('backfillLabel').textContent = `Done: ${data.processed}/${data.total}`;
  showToast(`Backfill complete: ${data.processed} emails processed`);
  setTimeout(() => {
    document.getElementById('backfillProgress').classList.add('hidden');
  }, 5000);
}

// ─── Utilities ──────────────────────────────────────────
function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
}

function shortGroupName(name) {
  if (!name) return '';
  // Remove common filler words to shorten, keep it recognizable
  return name.length > 25 ? name.substring(0, 22) + '...' : name;
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
