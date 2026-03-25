const API_BASE = '/api';
let token = localStorage.getItem('token');
let currentView = 'overview';
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
  showView('overview');
  refreshAll();
}

// ─── API helpers ────────────────────────────────────────
async function api(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
  if (res.status === 401 || res.status === 403) {
    logout();
    throw new Error('Session expired');
  }
  return res.json();
}

async function apiUpload(path, formData) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  return res.json();
}

// ─── Socket.IO ──────────────────────────────────────────
function initSocket() {
  socket = io();

  socket.on('whatsapp_status', (data) => {
    updateWhatsAppStatus(data.status);
  });

  socket.on('new_message', (data) => {
    showToast(`New message from ${data.chat.sender_name}: ${data.chat.message.substring(0, 60)}...`);
    refreshAll();
  });

  socket.on('new_action', (data) => {
    showToast(`New action: ${data.action.action_type} from ${data.chat.sender_name}`);
    refreshAll();
  });

  socket.on('response_sent', () => {
    refreshAll();
  });
}

function updateWhatsAppStatus(status) {
  const el = document.getElementById('whatsappStatus');
  if (status === 'connected') {
    el.className = 'flex items-center gap-1.5 ml-4 px-3 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700';
    el.innerHTML = '<span class="w-2 h-2 rounded-full bg-green-500 pulse-dot"></span> WhatsApp Connected';
  } else if (status === 'disconnected') {
    el.className = 'flex items-center gap-1.5 ml-4 px-3 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700';
    el.innerHTML = '<span class="w-2 h-2 rounded-full bg-red-500"></span> Disconnected';
  } else {
    el.className = 'flex items-center gap-1.5 ml-4 px-3 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600';
    el.innerHTML = '<span class="w-2 h-2 rounded-full bg-gray-400 pulse-dot"></span> Connecting...';
  }
}

// ─── Views ──────────────────────────────────────────────
function showView(view) {
  currentView = view;
  document.querySelectorAll('.view-panel').forEach((p) => p.classList.add('hidden'));
  document.getElementById(`view-${view}`).classList.remove('hidden');

  document.querySelectorAll('.nav-btn').forEach((btn) => {
    const isActive = btn.dataset.view === view;
    btn.classList.toggle('bg-indigo-50', isActive);
    btn.classList.toggle('text-indigo-700', isActive);
    btn.classList.toggle('text-gray-700', !isActive);
  });

  switch (view) {
    case 'overview': loadOverview(); break;
    case 'messages': loadMessages(); break;
    case 'unknown': loadUnknown(); break;
    case 'actions': loadActions(); break;
    case 'faq': loadFaqs(); break;
    case 'context': loadContextDocs(); break;
    case 'simulator': break;
    case 'knowledge-files': loadFiles(); break;
  }
}

async function refreshAll() {
  try {
    const stats = await api('/dashboard/stats');
    document.getElementById('statTotal').textContent = stats.chats.total;
    document.getElementById('statFaq').textContent = stats.chats.faq;
    document.getElementById('statActions').textContent = stats.actions.pending;
    document.getElementById('statUnknown').textContent = stats.chats.unknown;
    document.getElementById('unknownBadge').textContent = stats.chats.unknown;
    document.getElementById('actionsBadge').textContent = stats.actions.pending;

    updateWhatsAppStatus(stats.whatsappConnected ? 'connected' : 'disconnected');

    await refreshMode();

    if (currentView === 'overview') loadOverview();
  } catch (err) {
    console.error('Refresh failed:', err);
  }
}

// ─── Mode Toggle ─────────────────────────────────────────
async function refreshMode() {
  try {
    const data = await api('/dashboard/mode');
    updateModeUI(data.mode, data.group_name);
  } catch (err) {
    console.error('Failed to fetch mode:', err);
  }
}

function updateModeUI(mode, groupName) {
  const label = document.getElementById('modeLabel');
  const group = document.getElementById('modeGroup');
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
  group.textContent = groupName || '';
}

async function toggleMode() {
  try {
    const data = await api('/dashboard/mode');
    const currentMode = data.mode;
    const newMode = currentMode === 'test' ? 'prod' : 'test';

    if (newMode === 'prod') {
      const confirmed = confirm(
        '⚠️ You are about to switch to PRODUCTION mode.\n\n' +
        'The bot will now monitor and respond to messages in "CGS Webex Hosts Only".\n\n' +
        'Are you sure you want to go live?'
      );
      if (!confirmed) return;
    }

    const result = await api('/dashboard/mode', {
      method: 'POST',
      body: JSON.stringify({ mode: newMode }),
    });

    updateModeUI(result.mode, result.group_name);
    showToast(`Switched to ${result.mode.toUpperCase()} mode — monitoring "${result.group_name}"`);
  } catch (err) {
    alert('Failed to switch mode: ' + err.message);
  }
}

// ─── Overview ───────────────────────────────────────────
async function loadOverview() {
  try {
    const stats = await api('/dashboard/stats');
    document.getElementById('statTotal').textContent = stats.chats.total;
    document.getElementById('statFaq').textContent = stats.chats.faq;
    document.getElementById('statActions').textContent = stats.actions.pending;
    document.getElementById('statUnknown').textContent = stats.chats.unknown;

    const data = await api('/dashboard/recent?limit=10');
    document.getElementById('recentMessages').innerHTML = data.chats.map(chatCard).join('');
  } catch (err) {
    console.error(err);
  }
}

// ─── Messages ───────────────────────────────────────────
async function loadMessages() {
  try {
    const filter = document.getElementById('messageFilter').value;
    const search = document.getElementById('messageSearch').value;
    let url = '/chats?limit=50';
    if (filter) url += `&classification=${filter}`;
    if (search) url += `&search=${encodeURIComponent(search)}`;

    const data = await api(url);
    const container = document.getElementById('messagesList');
    container.innerHTML = data.chats.length
      ? data.chats.map(chatCard).join('')
      : '<p class="text-gray-400 text-center py-8">No messages found</p>';
  } catch (err) {
    console.error(err);
  }
}

// ─── Unknown ────────────────────────────────────────────
async function loadUnknown() {
  try {
    const data = await api('/chats?classification=unknown&limit=50');
    const pending = await api('/chats?status=pending&limit=50');
    const combined = [...data.chats, ...pending.chats];
    const unique = [...new Map(combined.map((c) => [c.id, c])).values()];

    const container = document.getElementById('unknownList');
    container.innerHTML = unique.length
      ? unique.map((c) => unknownCard(c)).join('')
      : '<p class="text-gray-400 text-center py-8">No messages need review</p>';
  } catch (err) {
    console.error(err);
  }
}

// ─── Actions ────────────────────────────────────────────
async function loadActions() {
  try {
    const statusFilter = document.getElementById('actionFilter').value;
    const typeFilter = document.getElementById('actionTypeFilter').value;
    let url = '/actions?limit=50';
    if (statusFilter) url += `&status=${statusFilter}`;
    if (typeFilter) url += `&type=${typeFilter}`;

    const data = await api(url);
    const container = document.getElementById('actionsList');

    if (!data.actions.length) {
      container.innerHTML = '<p class="text-gray-400 text-center py-8">No actions found</p>';
      return;
    }

    // Group by action_type
    const grouped = {};
    data.actions.forEach((a) => {
      if (a.action_data && typeof a.action_data === 'string') {
        try { a.action_data = JSON.parse(a.action_data); } catch (_) {}
      }
      const type = a.action_type || 'other';
      if (!grouped[type]) grouped[type] = [];
      grouped[type].push(a);
    });

    const typeLabels = { remove_host: 'Remove Host', get_participants: 'Get Participants' };
    const typeColors = { remove_host: 'purple', get_participants: 'cyan' };

    let html = '';
    for (const [type, actions] of Object.entries(grouped)) {
      const color = typeColors[type] || 'gray';
      const label = typeLabels[type] || type;
      html += `
        <div>
          <div class="flex items-center gap-2 mb-3">
            <span class="bg-${color}-100 text-${color}-700 text-sm px-3 py-1 rounded-full font-medium">${label}</span>
            <span class="text-xs text-gray-400">${actions.length} item${actions.length > 1 ? 's' : ''}</span>
          </div>
          <div class="space-y-3 ml-1 border-l-2 border-${color}-200 pl-4">
            ${actions.map(actionCard).join('')}
          </div>
        </div>`;
    }
    container.innerHTML = html;
  } catch (err) {
    console.error(err);
  }
}

// ─── FAQs ───────────────────────────────────────────────
async function loadFaqs() {
  try {
    const data = await api('/knowledge/faqs');
    const container = document.getElementById('faqList');
    container.innerHTML = data.faqs.length
      ? data.faqs.map(faqCard).join('')
      : '<p class="text-gray-400 text-center py-8">No FAQs yet. Upload a file or add manually.</p>';
  } catch (err) {
    console.error(err);
  }
}

// ─── Context Documents ───────────────────────────────────
async function loadContextDocs() {
  try {
    const data = await api('/context');
    const container = document.getElementById('contextList');
    container.innerHTML = data.documents.length
      ? data.documents.map(contextCard).join('')
      : '<p class="text-gray-400 text-center py-8">No reference context yet. Add links, notes, or upload a file.</p>';
  } catch (err) {
    console.error(err);
  }
}

function contextCard(doc) {
  const time = new Date(doc.created_at).toLocaleString();
  const typeColors = { general: 'gray', link: 'blue', guide: 'purple', notes: 'amber' };
  const c = typeColors[doc.doc_type] || 'gray';
  const charLimit = 300;
  const isLong = doc.content.length > charLimit;
  const preview = isLong ? doc.content.substring(0, charLimit) + '...' : doc.content;

  return `
    <div class="bg-white rounded-xl border border-gray-200 p-4 fade-in">
      <div class="flex items-start justify-between mb-2">
        <div class="flex items-center gap-2">
          <p class="font-medium text-gray-900 text-sm">${escapeHtml(doc.title)}</p>
          <span class="bg-${c}-100 text-${c}-700 text-xs px-2 py-0.5 rounded-full">${doc.doc_type}</span>
          <span class="px-2 py-0.5 rounded-full text-xs ${doc.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}">${doc.is_active ? 'Active' : 'Inactive'}</span>
        </div>
        <div class="flex gap-2 ml-4 shrink-0">
          <button onclick="toggleContext(${doc.id})" class="text-xs ${doc.is_active ? 'text-amber-600 hover:text-amber-800' : 'text-green-600 hover:text-green-800'}">${doc.is_active ? 'Disable' : 'Enable'}</button>
          <button onclick="deleteContext(${doc.id})" class="text-xs text-red-500 hover:text-red-700">Delete</button>
        </div>
      </div>
      <div class="bg-gray-50 rounded-lg p-3 mb-2 max-h-48 overflow-y-auto scrollbar-thin">
        <p id="ctx-preview-${doc.id}" class="text-gray-600 text-sm whitespace-pre-line">${escapeHtml(preview)}</p>
        <p id="ctx-full-${doc.id}" class="text-gray-600 text-sm whitespace-pre-line hidden">${escapeHtml(doc.content)}</p>
      </div>
      ${isLong ? `<button onclick="toggleContextExpand(${doc.id})" id="ctx-toggle-${doc.id}" class="text-indigo-600 hover:text-indigo-800 text-xs font-medium">Show full content</button>` : ''}
      <div class="flex items-center gap-2 text-xs text-gray-400 mt-1">
        <span>Source: ${escapeHtml(doc.source_file || 'manual')}</span>
        <span>${time}</span>
        <span>${doc.content.length.toLocaleString()} chars</span>
      </div>
    </div>`;
}

function toggleContextExpand(id) {
  const preview = document.getElementById('ctx-preview-' + id);
  const full = document.getElementById('ctx-full-' + id);
  const btn = document.getElementById('ctx-toggle-' + id);
  const isExpanded = !full.classList.contains('hidden');
  preview.classList.toggle('hidden', !isExpanded);
  full.classList.toggle('hidden', isExpanded);
  btn.textContent = isExpanded ? 'Show full content' : 'Collapse';
  if (!isExpanded) btn.closest('.fade-in').querySelector('.max-h-48').classList.remove('max-h-48');
  else btn.closest('.fade-in').querySelector('.overflow-y-auto').classList.add('max-h-48');
}

function showAddContextModal() {
  document.getElementById('contextTitle').value = '';
  document.getElementById('contextContent').value = '';
  document.getElementById('contextType').value = 'general';
  document.getElementById('contextModal').classList.remove('hidden');
}

async function addContext() {
  const title = document.getElementById('contextTitle').value.trim();
  const content = document.getElementById('contextContent').value.trim();
  const doc_type = document.getElementById('contextType').value;
  if (!title || !content) return alert('Title and content are required');

  try {
    await api('/context', {
      method: 'POST',
      body: JSON.stringify({ title, content, doc_type }),
    });
    closeModal('contextModal');
    showToast('Context added');
    loadContextDocs();
  } catch (err) {
    alert('Failed: ' + err.message);
  }
}

async function toggleContext(id) {
  try {
    await api(`/context/${id}/toggle`, { method: 'PATCH' });
    loadContextDocs();
  } catch (err) {
    alert('Failed: ' + err.message);
  }
}

async function deleteContext(id) {
  if (!confirm('Delete this context document?')) return;
  try {
    await api(`/context/${id}`, { method: 'DELETE' });
    showToast('Context deleted');
    loadContextDocs();
  } catch (err) {
    alert('Failed: ' + err.message);
  }
}

async function uploadContextFile() {
  const input = document.getElementById('contextFileUpload');
  if (!input.files.length) return;
  const formData = new FormData();
  formData.append('file', input.files[0]);
  try {
    const res = await apiUpload('/context/upload', formData);
    showToast(res.message || 'Context file uploaded');
    input.value = '';
    loadContextDocs();
  } catch (err) {
    alert('Upload failed: ' + err.message);
  }
}

// ─── Simulator ───────────────────────────────────────────
async function simulateMessage() {
  const input = document.getElementById('simInput');
  const message = input.value.trim();
  if (!message) return;

  const chatLog = document.getElementById('simChatLog');
  const btn = document.getElementById('simSendBtn');

  // Add user bubble
  chatLog.innerHTML += `
    <div class="flex justify-end">
      <div class="bg-indigo-600 text-white rounded-xl rounded-br-sm px-4 py-2 max-w-md text-sm">${escapeHtml(message)}</div>
    </div>`;
  input.value = '';
  btn.disabled = true;
  btn.textContent = 'Classifying...';

  // Add loading indicator
  const loadingId = 'sim-loading-' + Date.now();
  chatLog.innerHTML += `<div id="${loadingId}" class="flex justify-start"><div class="bg-gray-200 text-gray-500 rounded-xl rounded-bl-sm px-4 py-2 text-sm italic">Thinking...</div></div>`;
  chatLog.scrollTop = chatLog.scrollHeight;

  try {
    const result = await api('/simulator/classify', {
      method: 'POST',
      body: JSON.stringify({ message }),
    });

    const el = document.getElementById(loadingId);
    if (el) el.remove();

    const badgeColor = { faq: 'green', action: 'blue', unknown: 'amber' }[result.classification] || 'gray';

    chatLog.innerHTML += `
      <div class="flex justify-start">
        <div class="bg-white border border-gray-200 rounded-xl rounded-bl-sm px-4 py-3 max-w-lg text-sm space-y-2">
          <div class="flex items-center gap-2 mb-1">
            <span class="bg-${badgeColor}-100 text-${badgeColor}-700 text-xs px-2 py-0.5 rounded-full font-medium">${result.classification}</span>
            <span class="text-xs text-gray-400">${(result.confidence * 100).toFixed(0)}% confidence</span>
            <span class="text-xs text-gray-400">${result.duration_ms}ms</span>
          </div>
          ${result.response ? `<p class="text-gray-800">${escapeHtml(result.response)}</p>` : ''}
          ${result.classification === 'action' ? `
            <div class="bg-blue-50 border border-blue-200 rounded-lg p-2 space-y-1">
              <p class="text-blue-800 text-xs font-medium">Action: ${escapeHtml(result.action_type || 'unknown')}</p>
              ${result.extracted_email ? `<p class="text-blue-700 text-xs">Email: ${escapeHtml(result.extracted_email)}</p>` : '<p class="text-blue-400 text-xs">No email found in message</p>'}
              <p class="text-blue-400 text-xs italic">This would be tracked in the dashboard — no reply sent to the group.</p>
            </div>` : ''}
          ${result.classification === 'unknown' ? `
            <div class="bg-amber-50 border border-amber-200 rounded-lg p-2">
              <p class="text-amber-600 text-xs italic">This would be flagged for human review — no reply sent to the group.</p>
            </div>` : ''}
          <p class="text-gray-400 text-xs italic">${escapeHtml(result.reasoning)}</p>
        </div>
      </div>`;
  } catch (err) {
    const el = document.getElementById(loadingId);
    if (el) el.remove();
    chatLog.innerHTML += `
      <div class="flex justify-start">
        <div class="bg-red-50 border border-red-200 rounded-xl rounded-bl-sm px-4 py-2 text-sm text-red-600">Error: ${escapeHtml(err.message)}</div>
      </div>`;
  }

  btn.disabled = false;
  btn.textContent = 'Send';
  chatLog.scrollTop = chatLog.scrollHeight;
}

async function runBacktest() {
  const btn = document.getElementById('backtestBtn');
  const classification = document.getElementById('backtestFilter').value;
  const limit = parseInt(document.getElementById('backtestLimit').value) || 20;

  btn.disabled = true;
  btn.textContent = 'Running...';
  document.getElementById('backtestResults').innerHTML = '<p class="text-gray-400 text-center py-4 text-sm">Running backtest, this may take a while...</p>';
  document.getElementById('backtestSummary').classList.add('hidden');

  try {
    const data = await api('/simulator/backtest', {
      method: 'POST',
      body: JSON.stringify({ limit, classification: classification || undefined }),
    });

    // Summary
    const s = data.summary;
    const summaryEl = document.getElementById('backtestSummary');
    summaryEl.classList.remove('hidden');
    summaryEl.innerHTML = `
      <div class="grid grid-cols-2 md:grid-cols-5 gap-3 text-center">
        <div><div class="text-lg font-bold text-gray-900">${s.total}</div><div class="text-xs text-gray-500">Total</div></div>
        <div><div class="text-lg font-bold text-red-600">${s.changed}</div><div class="text-xs text-gray-500">Changed</div></div>
        <div><div class="text-lg font-bold text-green-600">${s.breakdown.faq}</div><div class="text-xs text-gray-500">FAQ</div></div>
        <div><div class="text-lg font-bold text-blue-600">${s.breakdown.action}</div><div class="text-xs text-gray-500">Action</div></div>
        <div><div class="text-lg font-bold text-amber-600">${s.breakdown.unknown}</div><div class="text-xs text-gray-500">Unknown</div></div>
      </div>`;

    // Results
    const container = document.getElementById('backtestResults');
    if (data.results.length === 0) {
      container.innerHTML = '<p class="text-gray-400 text-center py-4 text-sm">No messages to backtest.</p>';
    } else {
      container.innerHTML = data.results.map(backtestCard).join('');
    }
  } catch (err) {
    document.getElementById('backtestResults').innerHTML = `<p class="text-red-500 text-center py-4 text-sm">Backtest failed: ${escapeHtml(err.message)}</p>`;
  }

  btn.disabled = false;
  btn.textContent = 'Run Backtest';
}

function backtestCard(r) {
  const origColor = { faq: 'green', action: 'blue', unknown: 'amber' }[r.original.classification] || 'gray';
  const newColor = { faq: 'green', action: 'blue', unknown: 'amber' }[r.new.classification] || 'gray';

  return `
    <div class="bg-white rounded-xl border ${r.changed ? 'border-red-200' : 'border-gray-200'} p-4 fade-in">
      <div class="flex items-start justify-between mb-2">
        <div class="flex-1">
          <div class="flex items-center gap-2 mb-1">
            <span class="font-medium text-gray-900 text-sm">${escapeHtml(r.sender_name || 'Unknown')}</span>
            ${r.changed ? '<span class="bg-red-100 text-red-700 text-xs px-2 py-0.5 rounded-full font-medium">Changed</span>' : '<span class="bg-gray-100 text-gray-500 text-xs px-2 py-0.5 rounded-full">Same</span>'}
            <span class="text-xs text-gray-400">${r.duration_ms}ms</span>
          </div>
          <p class="text-gray-700 text-sm mb-2">${escapeHtml(r.message)}</p>
        </div>
      </div>
      <div class="grid grid-cols-2 gap-3 text-xs">
        <div class="bg-gray-50 rounded-lg p-2">
          <div class="text-gray-400 mb-1">Original</div>
          <span class="bg-${origColor}-100 text-${origColor}-700 px-2 py-0.5 rounded-full">${r.original.classification || 'none'}</span>
          <span class="text-gray-400 ml-1">${r.original.confidence ? (r.original.confidence * 100).toFixed(0) + '%' : ''}</span>
          ${r.original.response ? `<p class="text-gray-600 mt-1 truncate">${escapeHtml(r.original.response)}</p>` : ''}
        </div>
        <div class="bg-gray-50 rounded-lg p-2">
          <div class="text-gray-400 mb-1">New</div>
          <span class="bg-${newColor}-100 text-${newColor}-700 px-2 py-0.5 rounded-full">${r.new.classification}</span>
          <span class="text-gray-400 ml-1">${(r.new.confidence * 100).toFixed(0)}%</span>
          ${r.new.response ? `<p class="text-gray-600 mt-1 truncate">${escapeHtml(r.new.response)}</p>` : ''}
          <p class="text-gray-400 mt-1 italic">${escapeHtml(r.new.reasoning)}</p>
        </div>
      </div>
    </div>`;
}

// ─── Files ──────────────────────────────────────────────
async function loadFiles() {
  try {
    const data = await api('/knowledge/files');
    const container = document.getElementById('filesList');
    container.innerHTML = data.files.length
      ? data.files.map(fileCard).join('')
      : '<p class="text-gray-400 text-center py-8">No files uploaded yet</p>';
  } catch (err) {
    console.error(err);
  }
}

// ─── Card renderers ─────────────────────────────────────
function chatCard(chat, showRespond = false) {
  const badge = classificationBadge(chat.classification);
  const statusBadge = statusBadgeHtml(chat.status);
  const time = new Date(chat.created_at).toLocaleString();
  const respondBtn = (showRespond && chat.status !== 'responded')
    ? `<button onclick="openResponseModal(${chat.id}, '${escapeHtml(chat.message)}')" class="text-indigo-600 hover:text-indigo-800 text-sm font-medium">Respond</button>`
    : '';
  const ignoreBtn = (showRespond && chat.status === 'pending')
    ? `<button onclick="updateChatStatus(${chat.id}, 'ignored')" class="text-gray-400 hover:text-gray-600 text-sm">Ignore</button>`
    : '';

  return `
    <div class="bg-white rounded-xl border border-gray-200 p-4 fade-in hover:shadow-sm transition">
      <div class="flex items-start justify-between">
        <div class="flex-1">
          <div class="flex items-center gap-2 mb-1">
            <span class="font-medium text-gray-900 text-sm">${escapeHtml(chat.sender_name || 'Unknown')}</span>
            <span class="text-xs text-gray-400">${escapeHtml(chat.group_name || '')}</span>
            <span class="text-xs text-gray-400">${chat.source === 'email' ? '(Email)' : ''}</span>
          </div>
          <p class="text-gray-700 text-sm mb-2">${escapeHtml(chat.message)}</p>
          ${chat.response ? `<p class="text-sm text-green-700 bg-green-50 rounded-lg p-2 mb-2"><strong>Response:</strong> ${escapeHtml(chat.response)}</p>` : ''}
          <div class="flex items-center gap-2 text-xs text-gray-400">
            <span>${time}</span>
            ${badge}
            ${statusBadge}
            ${chat.confidence ? `<span>Confidence: ${(chat.confidence * 100).toFixed(0)}%</span>` : ''}
          </div>
        </div>
        <div class="flex items-center gap-2 ml-4">
          ${respondBtn}
          ${ignoreBtn}
        </div>
      </div>
    </div>`;
}

function actionCard(action) {
  const time = new Date(action.created_at).toLocaleString();
  const statusColor = { pending: 'amber', processing: 'blue', completed: 'green', failed: 'red' }[action.status] || 'gray';
  const ad = action.action_data || {};

  const contactInfo = [];
  if (ad.phone) contactInfo.push(`<span class="text-xs"><strong>Phone:</strong> ${escapeHtml(ad.phone)}</span>`);
  if (ad.email) contactInfo.push(`<span class="text-xs"><strong>Email:</strong> ${escapeHtml(ad.email)}</span>`);

  const notesHtml = action.admin_notes
    ? `<div class="bg-amber-50 border border-amber-200 rounded-lg p-2 mt-2 text-xs text-gray-700 whitespace-pre-line">${escapeHtml(action.admin_notes)}</div>`
    : '';

  return `
    <div class="bg-white rounded-xl border border-gray-200 p-4 fade-in">
      <div class="flex items-start justify-between">
        <div class="flex-1">
          <div class="flex items-center gap-2 mb-1">
            <span class="font-medium text-gray-900 text-sm">${escapeHtml(action.sender_name || 'Unknown')}</span>
            <span class="bg-${statusColor}-100 text-${statusColor}-700 text-xs px-2 py-0.5 rounded-full">${action.status}</span>
            <span class="text-xs text-gray-400">${escapeHtml(action.group_name || '')}</span>
          </div>
          <p class="text-gray-700 text-sm mb-2">${escapeHtml(action.message || '')}</p>
          ${contactInfo.length ? `<div class="flex items-center gap-4 mb-2 text-gray-600">${contactInfo.join('')}</div>` : ''}
          <div class="flex items-center gap-2 text-xs text-gray-400">
            <span>${time}</span>
            ${action.assigned_to ? `<span>Assigned: ${escapeHtml(action.assigned_to)}</span>` : ''}
          </div>
          ${notesHtml}
        </div>
        <div class="flex flex-col gap-1.5 ml-4">
          <button onclick="openNoteModal(${action.id}, 'action', '${escapeHtml(action.message || '')}')" class="text-indigo-600 hover:text-indigo-800 text-xs font-medium">Note</button>
          <button onclick="updateActionStatus(${action.id})" class="text-blue-600 hover:text-blue-800 text-xs font-medium">Status</button>
          <button onclick="deleteAction(${action.id})" class="text-red-500 hover:text-red-700 text-xs font-medium">Delete</button>
        </div>
      </div>
    </div>`;
}

function unknownCard(chat) {
  const badge = classificationBadge(chat.classification);
  const statusBadge = statusBadgeHtml(chat.status);
  const time = new Date(chat.created_at).toLocaleString();

  return `
    <div class="bg-white rounded-xl border border-gray-200 p-4 fade-in">
      <div class="flex items-start justify-between">
        <div class="flex-1">
          <div class="flex items-center gap-2 mb-1">
            <span class="font-medium text-gray-900 text-sm">${escapeHtml(chat.sender_name || 'Unknown')}</span>
            <span class="text-xs text-gray-400">${escapeHtml(chat.group_name || '')}</span>
          </div>
          <p class="text-gray-700 text-sm mb-2">${escapeHtml(chat.message)}</p>
          <div class="flex items-center gap-2 text-xs text-gray-400">
            <span>${time}</span>
            ${badge}
            ${statusBadge}
            ${chat.confidence ? `<span>Confidence: ${(chat.confidence * 100).toFixed(0)}%</span>` : ''}
          </div>
        </div>
        <div class="flex flex-col gap-1.5 ml-4">
          ${chat.status !== 'responded' ? `<button onclick="openResponseModal(${chat.id}, '${escapeHtml(chat.message)}')" class="text-indigo-600 hover:text-indigo-800 text-xs font-medium">Respond</button>` : ''}
          ${chat.status === 'pending' ? `<button onclick="updateChatStatus(${chat.id}, 'ignored')" class="text-gray-400 hover:text-gray-600 text-xs font-medium">Ignore</button>` : ''}
          <button onclick="deleteChatRecord(${chat.id})" class="text-red-500 hover:text-red-700 text-xs font-medium">Delete</button>
        </div>
      </div>
    </div>`;
}

function faqCard(faq) {
  return `
    <div class="bg-white rounded-xl border border-gray-200 p-4 fade-in">
      <div class="flex items-start justify-between">
        <div class="flex-1">
          <p class="font-medium text-gray-900 text-sm mb-1">Q: ${escapeHtml(faq.question)}</p>
          <p class="text-gray-600 text-sm mb-2">A: ${escapeHtml(faq.answer)}</p>
          <div class="flex items-center gap-2 text-xs text-gray-400">
            ${faq.keywords ? `<span>Keywords: ${escapeHtml(faq.keywords)}</span>` : ''}
            <span>Used: ${faq.usage_count}x</span>
            <span>Source: ${escapeHtml(faq.source_file || 'manual')}</span>
            <span class="px-2 py-0.5 rounded-full ${faq.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}">${faq.is_active ? 'Active' : 'Inactive'}</span>
          </div>
        </div>
        <div class="flex gap-2 ml-4">
          <button onclick="toggleFaq(${faq.id})" class="text-xs ${faq.is_active ? 'text-amber-600 hover:text-amber-800' : 'text-green-600 hover:text-green-800'}">${faq.is_active ? 'Disable' : 'Enable'}</button>
          <button onclick="deleteFaq(${faq.id})" class="text-xs text-red-500 hover:text-red-700">Delete</button>
        </div>
      </div>
    </div>`;
}

function fileCard(file) {
  const size = (file.size / 1024).toFixed(1);
  const modified = new Date(file.modified).toLocaleString();
  return `
    <div class="bg-white rounded-xl border border-gray-200 p-4 flex items-center justify-between fade-in">
      <div>
        <p class="font-medium text-gray-900 text-sm">${escapeHtml(file.name)}</p>
        <p class="text-xs text-gray-400">${size} KB &middot; Modified: ${modified}</p>
      </div>
      <button onclick="deleteFile('${escapeHtml(file.name)}')" class="text-red-500 hover:text-red-700 text-sm">Delete</button>
    </div>`;
}

function classificationBadge(cls) {
  const colors = { faq: 'green', action: 'blue', unknown: 'amber', manual: 'purple' };
  const c = colors[cls] || 'gray';
  return cls ? `<span class="bg-${c}-100 text-${c}-700 text-xs px-2 py-0.5 rounded-full">${cls}</span>` : '';
}

function statusBadgeHtml(status) {
  const colors = { pending: 'amber', responded: 'green', escalated: 'blue', ignored: 'gray' };
  const c = colors[status] || 'gray';
  return status ? `<span class="bg-${c}-100 text-${c}-700 text-xs px-2 py-0.5 rounded-full">${status}</span>` : '';
}

// ─── Actions ────────────────────────────────────────────
function openResponseModal(chatId, message) {
  document.getElementById('modalMessage').textContent = message;
  document.getElementById('modalResponse').value = '';
  document.getElementById('responseModal').classList.remove('hidden');

  const btn = document.getElementById('sendResponseBtn');
  btn.onclick = async () => {
    const response = document.getElementById('modalResponse').value.trim();
    if (!response) return;
    try {
      await api(`/chats/${chatId}/respond`, {
        method: 'POST',
        body: JSON.stringify({ response }),
      });
      closeModal('responseModal');
      showToast('Response sent successfully');
      refreshAll();
      if (currentView === 'unknown') loadUnknown();
    } catch (err) {
      alert('Failed: ' + err.message);
    }
  };
}

function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
}

async function updateChatStatus(chatId, status) {
  try {
    await api(`/chats/${chatId}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
    refreshAll();
    if (currentView === 'unknown') loadUnknown();
  } catch (err) {
    alert('Failed: ' + err.message);
  }
}

async function deleteAction(actionId) {
  if (!confirm('Delete this action? This cannot be undone.')) return;
  try {
    await api(`/actions/${actionId}`, { method: 'DELETE' });
    showToast('Action deleted');
    loadActions();
    refreshAll();
  } catch (err) {
    alert('Failed: ' + err.message);
  }
}

async function updateActionStatus(actionId) {
  const status = prompt('Enter new status (pending, processing, completed, failed):');
  if (!status) return;
  if (!['pending', 'processing', 'completed', 'failed'].includes(status)) {
    return alert('Invalid status. Must be: pending, processing, completed, or failed');
  }
  try {
    await api(`/actions/${actionId}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
    showToast(`Status updated to ${status}`);
    loadActions();
    refreshAll();
  } catch (err) {
    alert('Failed: ' + err.message);
  }
}

function openNoteModal(actionId, type, message) {
  document.getElementById('noteModalContext').textContent = message;
  document.getElementById('noteModalText').value = '';
  const existingEl = document.getElementById('noteModalExisting');
  existingEl.classList.add('hidden');

  // Fetch current notes
  api(`/actions/${actionId}`).then((data) => {
    if (data.action && data.action.admin_notes) {
      existingEl.textContent = data.action.admin_notes;
      existingEl.classList.remove('hidden');
    }
  }).catch(() => {});

  document.getElementById('noteModal').classList.remove('hidden');

  document.getElementById('saveNoteBtn').onclick = async () => {
    const note = document.getElementById('noteModalText').value.trim();
    if (!note) return;
    try {
      await api(`/actions/${actionId}/note`, { method: 'POST', body: JSON.stringify({ note }) });
      closeModal('noteModal');
      showToast('Note added');
      loadActions();
    } catch (err) {
      alert('Failed: ' + err.message);
    }
  };
}

async function deleteChatRecord(chatId) {
  if (!confirm('Delete this message? This cannot be undone.')) return;
  try {
    await api(`/chats/${chatId}`, { method: 'DELETE' });
    showToast('Message deleted');
    loadUnknown();
    refreshAll();
  } catch (err) {
    alert('Failed: ' + err.message);
  }
}

function showAddFaqModal() {
  document.getElementById('faqQuestion').value = '';
  document.getElementById('faqAnswer').value = '';
  document.getElementById('faqKeywords').value = '';
  document.getElementById('faqCategory').value = '';
  document.getElementById('faqModal').classList.remove('hidden');
}

async function addFaq() {
  const question = document.getElementById('faqQuestion').value.trim();
  const answer = document.getElementById('faqAnswer').value.trim();
  const keywords = document.getElementById('faqKeywords').value.trim();
  const category = document.getElementById('faqCategory').value.trim();
  if (!question || !answer) return alert('Question and answer are required');

  try {
    await api('/knowledge/faqs', {
      method: 'POST',
      body: JSON.stringify({ question, answer, keywords, category }),
    });
    closeModal('faqModal');
    showToast('FAQ added');
    loadFaqs();
  } catch (err) {
    alert('Failed: ' + err.message);
  }
}

async function toggleFaq(id) {
  try {
    await api(`/knowledge/faqs/${id}/toggle`, { method: 'PATCH' });
    loadFaqs();
  } catch (err) {
    alert('Failed: ' + err.message);
  }
}

async function deleteFaq(id) {
  if (!confirm('Delete this FAQ?')) return;
  try {
    await api(`/knowledge/faqs/${id}`, { method: 'DELETE' });
    showToast('FAQ deleted');
    loadFaqs();
  } catch (err) {
    alert('Failed: ' + err.message);
  }
}

async function uploadFile() {
  const input = document.getElementById('fileUpload');
  if (!input.files.length) return;
  const formData = new FormData();
  formData.append('file', input.files[0]);
  try {
    const res = await apiUpload('/knowledge/upload', formData);
    showToast(res.message || 'File uploaded');
    input.value = '';
    loadFiles();
    loadFaqs();
  } catch (err) {
    alert('Upload failed: ' + err.message);
  }
}

async function deleteFile(filename) {
  if (!confirm(`Delete ${filename} and its FAQ entries?`)) return;
  try {
    await api(`/knowledge/files/${encodeURIComponent(filename)}`, { method: 'DELETE' });
    showToast('File deleted');
    loadFiles();
    loadFaqs();
  } catch (err) {
    alert('Failed: ' + err.message);
  }
}

async function reloadKnowledgeBase() {
  try {
    const res = await api('/knowledge/reload', { method: 'POST' });
    showToast(res.message || 'Knowledge base reloaded');
    loadFaqs();
  } catch (err) {
    alert('Failed: ' + err.message);
  }
}

// ─── Utils ──────────────────────────────────────────────
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function showToast(message) {
  const toast = document.createElement('div');
  toast.className = 'fixed bottom-4 right-4 bg-gray-900 text-white px-4 py-3 rounded-lg shadow-lg text-sm z-50 fade-in';
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; toast.style.transition = 'opacity 0.3s'; }, 2500);
  setTimeout(() => toast.remove(), 3000);
}

// ─── Init ───────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  if (token) {
    api('/auth/me')
      .then((data) => {
        document.getElementById('adminName').textContent = data.user.username;
        showDashboard();
      })
      .catch(() => {
        token = null;
        localStorage.removeItem('token');
      });
  }

  // Enter key on login
  document.getElementById('loginPassword').addEventListener('keyup', (e) => {
    if (e.key === 'Enter') login();
  });
});

// Refresh every 30 seconds
setInterval(() => {
  if (token) refreshAll();
}, 30000);
