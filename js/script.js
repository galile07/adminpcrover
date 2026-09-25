// ==========================================
// SUPABASE CLIENT INIT (with fallback)
// ==========================================
const SUPABASE_URL = 'https://bpleimrxzigbhpofavec.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwbGVpbXJ4emlnYmhwb2ZhdmVjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM3Njg5NjIsImV4cCI6MjA5OTM0NDk2Mn0.bElPIF6WLAqWUD9WQLea8pMsPeO3IZr4K-1kjeim5Gw';

console.log('script.js v2 loaded');
let sbClient = null;
try {
  if (typeof window.supabase !== 'undefined' && window.supabase && window.supabase.createClient) {
    sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    console.log('sbClient created');
  } else {
    console.log('window.supabase not available');
  }
} catch (e) { console.log('sbClient init error:', e); }

function sb(table) { return sbClient ? sbClient.from(table) : null; }
setTimeout(() => {
  if (!sbClient && typeof window.supabase !== 'undefined' && window.supabase && window.supabase.createClient) {
    try { sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY); console.log('sbClient created (retry)'); } catch (e) {}
  }
}, 1500);

// ==========================================
// HELPERS: backend / localStorage
// ==========================================
async function fetchAll(table) {
  const raw = localStorage.getItem(table);
  const local = raw ? JSON.parse(raw) : null;
  if (local && local.length) return local;
  if (!sbClient) return local || [];
  try {
    const { data, error } = await sb(table).select('*').order('id');
    if (error) throw error;
    if (data && data.length) { localStorage.setItem(table, JSON.stringify(data)); return data; }
    return [];
  } catch(e) { return local || []; }
}
async function upsertAll(table, rows) {
  localStorage.setItem(table, JSON.stringify(rows));
  if (!sbClient) return;
  if (!rows.length) { try { const r = await sb(table).delete().neq('id', 0); if (r.error) throw r.error; } catch(e) {} return; }
  try {
    const r = await sb(table).upsert(rows, { onConflict: 'id' });
    if (r.error) throw r.error;
  } catch(e) {}
}
async function deleteAll(table) {
  if (!sbClient) { localStorage.setItem(table, '[]'); return; }
  try { const r = await sb(table).delete().neq('id', 0); if (r.error) throw r.error; }
  catch(e) { localStorage.setItem(table, '[]'); }
}

// ==========================================
// OFFLINE POS SUPPORT (global)
// ==========================================
function _genUid() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}
function posPendingCount() {
  try { return JSON.parse(localStorage.getItem('posOrders') || '[]').filter(o => o.pendingSync).length; } catch (e) { return 0; }
}
async function flushPendingPos() {
  if (!sbClient) return;
  try {
    const { error } = await sb('pos_orders').select('id').limit(1);
    if (error) return;
  } catch (e) { return; }
  let anything = false;
  for (let pass = 0; pass < 10; pass++) {
    let rec = JSON.parse(localStorage.getItem('posOrders') || '[]');
    const idx = rec.findIndex(o => o.pendingSync);
    if (idx === -1) break;
    const o = rec[idx];
    const payload = { customer: o.customer || 'Walk-in Customer', type: o.type || 'Walk-in', amount: o.amount, status: o.status || 'Completed', date: o.date };
    try {
      const { data, error } = await sb('pos_orders').insert(payload).select();
      if (error) return;
      if (data && data[0]) {
        rec = JSON.parse(localStorage.getItem('posOrders') || '[]');
        const i = rec.findIndex(r => r._syncUid === o._syncUid);
        if (i !== -1) {
          rec[i].id = data[0].id;
          delete rec[i].pendingSync;
          delete rec[i]._syncUid;
          localStorage.setItem('posOrders', JSON.stringify(rec));
        }
        anything = true;
      }
    } catch (e) { return; }
  }
  if (localStorage.getItem('_posStockDirty') === '1') {
    try {
      const inv = JSON.parse(localStorage.getItem('inventory') || '[]');
      const imp = JSON.parse(localStorage.getItem('imported_products') || '[]');
      if (inv.length) { const r1 = await sbClient.from('inventory').upsert(inv, { onConflict: 'id' }); if (r1.error) throw r1.error; }
      if (imp.length) { const r2 = await sbClient.from('imported_products').upsert(imp, { onConflict: 'id' }); if (r2.error) throw r2.error; }
      localStorage.removeItem('_posStockDirty');
      anything = true;
    } catch (e) {}
  }
  if (anything) showToast('Offline orders synced to the dashboard.', 'success');
  updatePosSyncBanner();
}
function updatePosSyncBanner() {
  const offline = navigator.onLine === false;
  const pending = posPendingCount();
  let b = document.getElementById('posSyncBanner');
  if (!offline && pending === 0) { if (b) b.remove(); return; }
  if (!b) { b = document.createElement('div'); b.id = 'posSyncBanner'; document.body.appendChild(b); }
  b.className = 'posSyncBanner' + (offline ? ' offline' : ' syncing');
  b.textContent = offline
    ? 'Offline mode — POS keeps working. ' + (pending ? pending + ' order(s) waiting to sync once reconnected.' : 'Orders made now will sync automatically.')
    : 'Syncing... ' + pending + ' offline order(s) remaining.';
}
function registerServiceWorker() {
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.register('sw.js').catch(function (e) { console.warn('SW register failed:', e); });
  }
}
window.addEventListener('online', function () { updatePosSyncBanner(); flushPendingPos(); });
window.addEventListener('offline', updatePosSyncBanner);
setInterval(function () { if (navigator.onLine === false || posPendingCount() > 0) flushPendingPos(); }, 30000);
function launchOfflineSupport() {
  registerServiceWorker();
  updatePosSyncBanner();
  if (posPendingCount() > 0) flushPendingPos();
}
launchOfflineSupport();

// ==========================================
// HELPERS: price rules cache
// ==========================================
let _rulesCache = null;
async function getRules() {
  if (_rulesCache) return _rulesCache;
  const raw = localStorage.getItem('autoRules');
  const local = raw ? JSON.parse(raw) : null;
  if (local && local.length) { _rulesCache = local; return local; }
  if (!sbClient) return _rulesCache || [];
  try {
    const { data } = await sb('auto_rules').select('*').order('id');
    _rulesCache = (data || []).map(r => ({ ...r, adjustValue: r.adjustvalue, adjustType: r.adjusttype }));
    if (_rulesCache.length) localStorage.setItem('autoRules', JSON.stringify(_rulesCache));
    return _rulesCache;
  } catch(e) { return _rulesCache || []; }
}
function saveRules(r) {
  _rulesCache = r;
  localStorage.setItem('autoRules', JSON.stringify(r));
}
async function syncRulesToBackend() {
  if (!sbClient) return;
  try {
    const r = await getRules();
    const d = await sb('auto_rules').delete().neq('id', 0);
    if (d.error) throw d.error;
    if (r.length) {
      const mapped = r.map(x => ({ id: x.id, name: x.name || '', direction: x.direction, field: x.field, operator: x.operator, value: x.value, adjustvalue: x.adjustValue, adjusttype: x.adjustType, enabled: x.enabled !== false }));
      const i = await sb('auto_rules').insert(mapped);
      if (i.error) throw i.error;
    }
  } catch(e) { console.warn('rule sync failed:', e); }
}
function applyRulesToProduct(product) {
  const rules = (_rulesCache || []).filter(r => r.enabled);
  let price = product.price;
  rules.forEach(r => {
    let match = false;
    const val = r.field === 'stock' ? product.stock : 0;
    if (r.operator === 'greater' && val > r.value) match = true;
    if (r.operator === 'less' && val < r.value) match = true;
    if (r.operator === 'equal' && val === r.value) match = true;
    if (match) {
      const change = r.adjustType === 'percent' ? price * r.adjustValue / 100 : r.adjustValue;
      price = r.direction === 'subtract' ? price - change : price + change;
    }
  });
  return price;
}
function isRuleAdjusted(product) {
  return Math.abs(applyRulesToProduct(product) - (Number(product.price) || 0)) > 0.001;
}
function ruleAdjustedPrice(product) {
  return applyRulesToProduct(product);
}

// ==========================================
// SIDEBAR NOTIFICATION DOTS
// ==========================================
function setNavBadge(id, show) {
  const el = document.getElementById(id);
  if (el) el.classList.toggle('show', !!show);
}
async function refreshNavNotifications() {
  if (!document.getElementById('navBadgeOrders') && !document.getElementById('navBadgeInventory')) return;
  let gotOrders = false, gotInv = false, pending = 0, low = 0;
  if (sbClient && sbClient.functions) {
    try {
      const { data, error } = await sbClient.functions.invoke('admin-orders', { method: 'GET' });
      if (!error && data && Array.isArray(data.orders)) {
        gotOrders = true;
        pending = data.orders.filter(o => String(o.status || '').toLowerCase() === 'pending').length;
      }
    } catch (e) {}
  }
  try {
    const inv = await fetchAll('inventory');
    const imp = await fetchAll('imported_products');
    gotInv = true;
    low = [...inv, ...imp].filter(p => p.enabled && (p.stock || 0) <= (p.threshold || 5)).length;
  } catch (e) {}
  if (gotOrders) setNavBadge('navBadgeOrders', pending > 0);
  if (gotInv) setNavBadge('navBadgeInventory', low > 0);
}

// ==========================================
// LAZADA SYNC (global)
// ==========================================
function setLazadaSync(msg) {
  const el = document.getElementById('lazadaSyncStatus');
  if (el) { el.textContent = msg; return; }
  showToast(msg);
}
function lazadaErrorMsg(err, data) {
  if (data && (data.message || data.error)) return (data.message || data.error);
  if (err && err.context) {
    try {
      const b = JSON.parse(err.context.response.text());
      if (b && (b.message || b.error)) return b.message || b.error;
    } catch (e) {}
  }
  return (err && err.message) || 'unknown error';
}
window.checkLazadaStatus = async () => {
  if (!sbClient || !sbClient.functions) return;
  const pill = document.getElementById('lazadaStatusPill');
  const sub = document.getElementById('lazadaStatusSub');
  const syncCue = document.getElementById('lazadaSyncCue');
  if (!pill) return;
  try {
    const { data, error } = await sbClient.functions.invoke('lazada-status', { method: 'GET' });
    if (error || !data || !data.ok) {
      pill.textContent = 'Connection unknown';
      pill.className = 'status-pill status-unknown';
      return;
    }
    const fmt = (ts) => ts ? new Date(ts).toLocaleString() : '';
    if (data.connected && !data.refresh_expired) {
      pill.textContent = 'Connected';
      pill.className = 'status-pill status-connected';
      if (sub) {
        const dt = fmt(data.connected_at);
        sub.textContent = 'Lazada seller account linked' + (dt ? ' since ' + dt : '') + '.';
      }
      if (syncCue) {
        if (data.last_synced_at) {
          syncCue.style.display = 'flex';
          syncCue.querySelector('.sync-cue-text').textContent = 'Lazada synced to this system — last sync ' + fmt(data.last_synced_at);
        } else {
          syncCue.style.display = 'none';
        }
      }
      const connectBtn = document.getElementById('connectLazadaBtn');
      if (connectBtn) {
        connectBtn.textContent = 'Reconnect';
        connectBtn.classList.add('btn-secondary');
        connectBtn.classList.remove('btn-primary');
      }
    } else {
      pill.textContent = data.refresh_expired ? 'Reconnect needed' : 'Not connected';
      pill.className = 'status-pill ' + (data.refresh_expired ? 'status-warning' : 'status-off');
      if (sub) sub.textContent = data.refresh_expired
        ? 'The connection expired. Click Reconnect to link your account again.'
        : 'Click Connect Lazada and authorize your seller account.';
      if (syncCue) syncCue.style.display = 'none';
    }
  } catch (e) {
    pill.textContent = 'Connection unknown';
    pill.className = 'status-pill status-unknown';
  }
};
window.connectLazada = () => {
  const cb = 'https://galile07.github.io/adminpcrover/lazada-callback.html';
  window.open('https://auth.lazada.com/oauth/authorize?response_type=code&force_auth=true&redirect_uri=' + encodeURIComponent(cb) + '&client_id=140929', '_blank');
};
window.syncLazada = async () => {
  if (!sbClient || !sbClient.functions) { setLazadaSync('Supabase is not available.'); return; }
  const btn = document.getElementById('syncLazadaBtn');
  const old = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Syncing...'; }
  try {
    const { data, error } = await sbClient.functions.invoke('lazada-sync', { method: 'GET' });
    if (error) throw error;
    if (!data || !data.ok) { setLazadaSync('Sync failed: ' + lazadaErrorMsg(null, data)); window.checkLazadaStatus(); return; }
    let msg = 'Synced ' + data.synced + ' new Lazada order(s). Skipped ' + data.skipped + ' already-imported.';
    if (data.products !== null && data.products !== undefined) {
      msg += '\nProducts: ' + data.products + ' synced/updated.' + (data.products_error ? ' (error: ' + data.products_error + ')' : '');
    }
    setLazadaSync(msg);
    window.checkLazadaStatus();
    if (window.__refreshOrders) await window.__refreshOrders();
  } catch (e) {
    setLazadaSync('Sync failed: ' + lazadaErrorMsg(e));
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = old; }
  }
};

// ==========================================
// HELPERS: currency / date
// ==========================================
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function showToast(msg, type) {
  const t = document.createElement('div');
  t.className = 'toast-notification' + (type === 'success' ? ' toast-success' : type === 'error' ? ' toast-error' : '');
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3000);
}

function showConfirm(msg, onConfirm) {
  let ov = document.getElementById('confirmOverlay');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'confirmOverlay';
    ov.innerHTML = '<div class="modal-box" style="max-width:380px"><div class="modal-header"><h3>Confirm</h3></div><div class="modal-body"><p id="confirmMessage"></p></div><div class="modal-footer"><button class="btn btn-secondary" id="confirmCancelBtn">Cancel</button><button class="btn btn-primary" id="confirmOkBtn">OK</button></div></div>';
    document.body.appendChild(ov);
  }
  document.getElementById('confirmMessage').textContent = msg;
  ov.style.display = 'flex';
  document.getElementById('confirmCancelBtn').onclick = () => { ov.style.display = 'none'; };
  document.getElementById('confirmOkBtn').onclick = () => { ov.style.display = 'none'; onConfirm(); };
  ov.onclick = (e) => { if (e.target === ov) ov.style.display = 'none'; };
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  try { localStorage.setItem('pcrover_theme', theme); } catch (e) {}
  const btn = document.getElementById('themeToggleBtn');
  if (btn) btn.textContent = theme === 'dark' ? 'Light' : 'Dark';
  if (window.__chartThemeUpdate) window.__chartThemeUpdate(theme);
}

function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  applyTheme(cur === 'dark' ? 'light' : 'dark');
}

function isDarkTheme() {
  return document.documentElement.getAttribute('data-theme') === 'dark';
}

(function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem('pcrover_theme'); } catch (e) {}
  let theme = 'light';
  if (saved === 'dark' || saved === 'light') theme = saved;
  else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) theme = 'dark';
  applyTheme(theme);
})();

const fmtCurrency = (a) => '₱' + a.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function getTodayStr() { return new Date().toISOString().split('T')[0]; }
function getMonthStart() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-01';
}

// Product images (same logic as customer site: real image or Unsplash fallback)
const IMAGE_POOL = [
  '1517336714731-489689fd1ca8',
  '1587829741301-dc798b83add3',
  '1527814050087-3793815479db',
  '1505740420928-5e560c06d30e',
  '1527443224154-c4a3942d3acf',
  '1516035069371-29a1b244cc32',
  '1608043152269-423dbba4e7e1',
  '1622233744431-84c86c7f60f4',
  '1618384887929-16ec33fab9ef',
  '1585060544812-6b45742d762f',
  '1593640408182-31c70c8268f5',
  '1587202372775-e229f172b9d7',
];
const PRODUCT_IMAGE_IDS = {
  'mechanical keyboard': '1756388371735-cc845c578200',
  'gaming mouse': '1616296425622-4560a2ad83de',
  '27 monitor': '1674621702671-5b92364391f2',
  'laptop stand': '1652198144911-4f204ccf35e6',
  'gaming headset': '1566055972289-c52022ae23b7',
  'webcam hd': '1642083139428-9ee5fa423c46',
  'bluetooth speaker': '1511499271651-073325718d90',
  'ssd 1tb': '1757083840018-cd665233a112',
  'usb c hub': '1760376789478-c1023d2dc007',
  printer: '1612815154858-60aa4c59eaa6',
  'mouse pad': '1569050806800-0d6be7035923',
  'extension cord': '1565049981953-379c9c2a5d48',
};
function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}
function normalizeProductName(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}
function guessCategory(name) {
  const n = String(name || '').toLowerCase();
  const words = n.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  const hasAny = (...ws) => ws.some(w => n.includes(w));
  const hasWord = (...ws) => ws.some(w => words.includes(w));
  if (hasAny('used', 'second hand', '2nd hand', 'preowned', 'pre-owned', 'refurbished')) return 'preowned';
  if (hasAny('cctv', 'camera', 'dvr', 'nvr', 'alarm', 'doorbell', 'surveillance', 'security', 'sensor', 'ip cam')) return 'security';
  if (hasWord('monitor', 'ssd', 'hdd', 'printer', 'desktop', 'tower', 'cpu', 'processor', 'ram', 'memory', 'laptop', 'notebook', 'motherboard', 'gpu', 'graphics', 'pc')) return 'computers';
  return 'accessories';
}
function unsplashImage(seed, width) {
  const id = IMAGE_POOL[hashString(String(seed)) % IMAGE_POOL.length];
  return 'https://images.unsplash.com/photo-' + id + '?auto=format&fit=crop&w=' + width + '&q=80&ixlib=rb-4.1.0';
}
function productImage(product, width) {
  if (product.image) return product.image;
  const normalized = normalizeProductName(product.name);
  const keys = Object.keys(PRODUCT_IMAGE_IDS).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (normalized.includes(key)) {
      return 'https://images.unsplash.com/photo-' + PRODUCT_IMAGE_IDS[key] + '?auto=format&fit=crop&w=' + width + '&q=80&ixlib=rb-4.1.0';
    }
  }
  return unsplashImage(product.name, width);
}

// ==========================================
// 1. LOGIN
// ==========================================
const loginForm = document.getElementById('loginForm');
if (loginForm) {
  const err = document.getElementById('loginError');
  loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const u = document.getElementById('username').value.trim();
    const p = document.getElementById('password').value.trim();
    if (u === 'admin' && p === 'pcrover123') {
      window.location.href = 'dashboard.html';
      return;
    }
    err.textContent = 'Invalid username or password. Please try again.';
    err.style.display = 'block';
  });
}

// ==========================================
// 2. POS
// ==========================================
const cartList = document.querySelector('.pos-cart-list');
if (cartList) {
  let cart = [];
  const subtotalEl = document.querySelector('.pos-summary-row span:nth-child(2)');
  const totalEl = document.querySelector('.pos-summary-total span:nth-child(2)');
  const checkoutBtn = document.querySelector('.btn-checkout');
  const searchInput = document.getElementById('posSearchInput');
const posGrid = document.querySelector('.pos-grid');

  let _pendingTotal = 0;
  let _posCategory = 'all';
  const POS_CAT_LABELS = { computers: 'Computers', accessories: 'Accessories', security: 'Security', preowned: 'Preowned', other: 'Other' };

  async function loadAndRenderPOS() {
    await getRules();
    const inv = await fetchAll('inventory');
    const imp = await fetchAll('imported_products');
    const invCards = inv.filter(p => p.enabled && (p.stock || 0) > 0).map(p => ({ name: p.name, price: applyRulesToProduct(p), adjusted: isRuleAdjusted(p), image: productImage(p, 400), category: p.category || guessCategory(p.name), stock: p.stock || 0, source: 'inventory', dataId: p.id }));
    const impCards = imp.filter(p => p.enabled && (p.stock || 0) > 0).map(p => ({ name: p.name, price: applyRulesToProduct(p), adjusted: isRuleAdjusted(p), image: productImage(p, 400), category: p.category || guessCategory(p.name), stock: p.stock || 0, source: 'imported', dataId: p.id }));
    const all = [...invCards, ...impCards];
    renderPosCategories(all);
    posGrid.innerHTML = all.length
      ? all.map(c =>
          '<div class="pos-item-card" data-name="' + esc(c.name) + '" data-price="' + c.price + '" data-source="' + c.source + '" data-id="' + c.dataId + '" data-category="' + esc(c.category) + '" data-stock="' + c.stock + '">' +
            '<div class="pos-item-img"><img src="' + c.image + '" alt="' + esc(c.name) + '" loading="lazy"></div>' +
            '<div class="pos-item-name">' + esc(c.name) + '</div>' +
            '<div class="pos-item-price' + (c.adjusted ? ' rule' : '') + '" title="' + (c.adjusted ? 'Price automation active' : '') + '">' + fmtCurrency(c.price) + '</div>' +
          '</div>'
        ).join('')
      : '<div style="text-align:center;color:#999;padding:50px 0;">There\'s nothing here.</div>';
    if (searchInput && searchInput.value.trim()) filterPOS();
  }

  function renderPosCategories(products) {
    const catEl = document.getElementById('posCategories');
    if (!catEl) return;
    const cats = [];
    products.forEach(p => { if (cats.indexOf(p.category) === -1) cats.push(p.category); });
    const label = c => POS_CAT_LABELS[c] || (c.charAt(0).toUpperCase() + c.slice(1));
    catEl.innerHTML = '<button class="pos-category-btn active" data-cat="all" onclick="setPosCategory(\'all\')">All</button>' +
      cats.map(c => '<button class="pos-category-btn" data-cat="' + esc(c) + '" onclick="setPosCategory(\'' + esc(c) + '\')">' + esc(label(c)) + '</button>').join('');
  }

  window.setPosCategory = (cat) => {
    _posCategory = cat;
    document.querySelectorAll('.pos-category-btn').forEach(b => b.classList.toggle('active', b.dataset.cat === cat));
    filterPOS();
  };

  function filterPOS() {
    const t = searchInput.value.trim().toLowerCase();
    document.querySelectorAll('.pos-item-card').forEach(c => {
      const matchCat = _posCategory === 'all' || c.dataset.category === _posCategory;
      const matchText = !t || c.dataset.name.toLowerCase().includes(t);
      c.style.display = matchCat && matchText ? '' : 'none';
    });
  }

  posGrid.addEventListener('click', (e) => {
    const card = e.target.closest('.pos-item-card');
    if (!card || card.style.display === 'none') return;
    const name = card.dataset.name, price = parseFloat(card.dataset.price);
    const source = card.dataset.source || 'inventory', dataId = parseInt(card.dataset.id);
    const stock = parseInt(card.dataset.stock) || 0;
    const key = source + '-' + dataId;
    const ex = cart.find(i => i._key === key);
    const currentQty = ex ? ex.qty : 0;
    if (currentQty + 1 > stock) { showToast(name + ' only has ' + stock + ' unit(s) in stock.', 'error'); return; }
    if (ex) ex.qty += 1;
    else cart.push({ _key: key, name, price, qty: 1, stock, source, dataId });
    updateCartUI();
  });

  if (searchInput) searchInput.addEventListener('input', filterPOS);

  function updateCartUI() {
    cartList.innerHTML = '';
    let sub = 0;
    cart.forEach((item, i) => {
      sub += item.price * item.qty;
      const d = document.createElement('div');
      d.className = 'pos-cart-item';
      d.innerHTML = '<div class="pos-cart-item-details"><span class="pos-cart-item-name">' + esc(item.name) + '</span><span class="pos-cart-item-price">' + fmtCurrency(item.price) + '</span></div><div class="pos-cart-qty"><button class="pos-qty-btn" onclick="changeQty(' + i + ',-1)">-</button><span>' + item.qty + '</span><button class="pos-qty-btn" onclick="changeQty(' + i + ',1)">+</button></div>';
      cartList.appendChild(d);
    });
    _pendingTotal = sub;
    subtotalEl.innerText = fmtCurrency(sub);
    totalEl.innerText = fmtCurrency(sub);
    checkoutBtn.innerText = 'Pay Now ' + fmtCurrency(sub);
checkoutBtn.onclick = () => {
      if (cart.length === 0) { showToast('Cart is empty!', 'error'); return; }
      openCashModal(sub);
    };
}

  window.changeQty = (i, d) => {
    const item = cart[i];
    if (!item) return;
    if (d > 0 && item.qty + d > (item.stock || 0)) { showToast(item.name + ' only has ' + item.stock + ' unit(s) in stock.', 'error'); return; }
    item.qty += d;
    if (item.qty <= 0) cart.splice(i, 1);
    updateCartUI();
  };

  // --- Cash Modal ---
  window.openCashModal = (total) => {
    document.getElementById('cashTotalDisplay').textContent = fmtCurrency(total);
    document.getElementById('cashReceived').value = '';
    document.getElementById('cashChangeGroup').style.display = 'none';
    document.getElementById('cashModal').style.display = 'flex';
    document.getElementById('cashReceived').oninput = function() {
      const rec = parseFloat(this.value) || 0;
      if (rec >= total) {
        document.getElementById('cashChangeGroup').style.display = 'block';
        document.getElementById('cashChangeDisplay').textContent = fmtCurrency(rec - total);
      } else {
        document.getElementById('cashChangeGroup').style.display = 'none';
      }
    };
document.getElementById('cashConfirmBtn').onclick = () => {
      const rec = parseFloat(document.getElementById('cashReceived').value) || 0;
      if (rec < total) { showToast('Amount received is less than total.', 'error'); return; }
      showConfirm('Complete payment of ' + fmtCurrency(total) + '?', () => void (async () => {
      try {
      const inv = await fetchAll('inventory');
      const imp = await fetchAll('imported_products');
      cart.forEach(item => {
        if (item.source === 'imported') {
          const prod = imp.find(p => p.id === item.dataId);
          if (prod) prod.stock = Math.max(0, prod.stock - item.qty);
        } else {
          const prod = inv.find(p => p.id === item.dataId);
          if (prod) prod.stock = Math.max(0, prod.stock - item.qty);
        }
      });
      await upsertAll('inventory', inv);
      await upsertAll('imported_products', imp);
      const order = {
        id: '#' + String(Date.now()).slice(-4),
        customer: 'Walk-in Customer', type: 'Walk-in',
        amount: total, status: 'Completed',
        date: getTodayStr(),
        _syncUid: _genUid(),
        pendingSync: true
      };
      const s = JSON.parse(localStorage.getItem('posOrders') || '[]');
      s.unshift(order); localStorage.setItem('posOrders', JSON.stringify(s));
      const tryInsert = async () => {
        if (!sbClient) return false;
        try {
          const { data: inserted, error } = await sb('pos_orders').insert({ customer: order.customer, type: order.type, amount: order.amount, status: order.status, date: order.date }).select();
          if (error) throw error;
          if (inserted && inserted[0]) {
            const rec = JSON.parse(localStorage.getItem('posOrders') || '[]');
            const i = rec.findIndex(x => x._syncUid === order._syncUid);
            if (i !== -1) { rec[i].id = inserted[0].id; delete rec[i].pendingSync; delete rec[i]._syncUid; localStorage.setItem('posOrders', JSON.stringify(rec)); }
          }
          return true;
        } catch (e) {
          localStorage.setItem('_posStockDirty', '1');
          console.warn('pos order sync failed (kept offline):', e);
          return false;
        }
      };
      if (navigator.onLine === false) localStorage.setItem('_posStockDirty', '1');
      if (!(await tryInsert())) updatePosSyncBanner();
      showToast('Transaction completed! Change: ' + fmtCurrency(rec - total), 'success');
      } catch(e) { showToast('Transaction failed: ' + (e.message || 'Unknown error'), 'error'); }
      closeCashModal();
      cart = [];
      updateCartUI();
      })());
    };
  };

  window.closeCashModal = () => { document.getElementById('cashModal').style.display = 'none'; };

  loadAndRenderPOS();
  updateCartUI();
}

// ==========================================
// 3. DASHBOARD
// ==========================================
const recentOrdersBody = document.getElementById('recentOrdersBody');
if (recentOrdersBody) {
  const recentOrdersCountEl = document.getElementById('recentOrdersCount');
  const ordersToAcceptCountEl = document.getElementById('ordersToAcceptCount');
  const ordersToAcceptMetaEl = document.getElementById('ordersToAcceptMeta');
  const lowStockCountEl = document.getElementById('lowStockCount');
  const lowStockMetaEl = document.getElementById('lowStockMeta');
  const dailySalesValueEl = document.getElementById('dailySalesValue');
  const monthlySalesValueEl = document.getElementById('monthlySalesValue');

  (async () => {
    let posOrders = [], onlineOrdersList = [], pendingCount = 0;
    posOrders = (JSON.parse(localStorage.getItem('posOrders') || '[]')).map(o => ({ ...o, type: o.type || 'Walk-in', status: o.status || 'Completed' }));
    const stored = JSON.parse(localStorage.getItem('onlineOrders') || '[]');
    if (!sbClient || !sbClient.functions) {
      onlineOrdersList = stored.filter(o => String(o.status).toLowerCase() !== 'pending').map(o => ({ id: o.code || o.id, customer: o.customer, type: 'Online', amount: o.amount, status: o.status, date: o.date }));
      pendingCount = stored.filter(o => o.status === 'pending' || o.status === 'Pending').length;
    } else {
      try {
        const { data, error } = await sbClient.functions.invoke('admin-orders', { method: 'GET' });
        if (!error) {
          const all = ((data && data.orders) || []).map(o => ({
            id: String(o.id || '').toUpperCase().slice(0, 8),
            customer: o.customer_name || o.name || 'Customer',
            type: 'Online', amount: o.total || 0, status: o.status, date: (o.created_at || '').slice(0, 10)
          }));
          pendingCount = all.filter(o => String(o.status).toLowerCase() === 'pending').length;
          onlineOrdersList = all.filter(o => String(o.status).toLowerCase() !== 'pending');
        }
      } catch (e) {
        pendingCount = stored.filter(o => o.status === 'pending' || o.status === 'Pending').length;
        onlineOrdersList = stored.filter(o => String(o.status).toLowerCase() !== 'pending').map(o => ({ id: o.code || o.id, customer: o.customer, type: 'Online', amount: o.amount, status: o.status, date: o.date }));
      }
      try {
        const { data: p } = await sb('pos_orders').select('*').order('date', { ascending: false });
        if (p && p.length) {
          const sup = p.map(o => ({ id: o.id, customer: o.customer || 'Walk-in Customer', type: o.type || 'Walk-in', amount: o.amount, status: o.status || 'Completed', date: o.date }));
          const ids = new Set(posOrders.map(x => String(x.id)));
          sup.forEach(o => { if (!ids.has(String(o.id))) posOrders.push(o); });
        }
      } catch (e) {}
    }

    const recentOrders = [...posOrders, ...onlineOrdersList];

const invProducts = await fetchAll('inventory');
    const impProducts = await fetchAll('imported_products');
    const lowStockItems = [...invProducts, ...impProducts].filter(p => p.enabled && (p.stock || 0) <= (p.threshold || 5));

    // Daily sales: filter today
    const today = getTodayStr();
    const todayOrders = recentOrders.filter(o => o.date === today);
    const dailySales = todayOrders.reduce((s, o) => s + o.amount, 0);

    // Monthly sales: filter this month
    const monthStart = getMonthStart();
    const monthOrders = recentOrders.filter(o => o.date >= monthStart);
    const monthlySales = monthOrders.reduce((s, o) => s + o.amount, 0);

    recentOrdersBody.innerHTML = recentOrders.length
      ? recentOrders.slice(0, 20).map(o => '<tr><td>' + esc(o.date) + '</td><td>#' + esc(o.id || '') + '</td><td>' + esc(o.customer || '-') + '</td><td>' + esc(o.type || '') + ' · ' + esc(o.status || '') + '</td><td>' + fmtCurrency(o.amount) + '</td></tr>').join('')
      : '<tr><td colspan="5" style="text-align:center;color:#999;">There\'s nothing here.</td></tr>';

    recentOrdersCountEl.innerText = recentOrders.length;
    ordersToAcceptCountEl.innerText = pendingCount;
    ordersToAcceptMetaEl.innerText = pendingCount + ' pending confirmations';
lowStockCountEl.innerText = lowStockItems.length;
    if (pendingCount > 0) setNavBadge('navBadgeOrders', true);
    setNavBadge('navBadgeInventory', lowStockItems.length > 0);
    lowStockMetaEl.innerText = lowStockItems.length > 0 ? lowStockItems.length + ' product' + (lowStockItems.length === 1 ? '' : 's') + ' needed to restock' : 'All products well stocked';
    dailySalesValueEl.innerText = fmtCurrency(dailySales);
    monthlySalesValueEl.innerText = fmtCurrency(monthlySales);

    // Dashboard charts
    if (typeof window.Chart !== 'undefined') {
      Chart.defaults.font.family = 'Inter, sans-serif';
      Chart.defaults.font.size = 12;
      const dark = isDarkTheme();
      Chart.defaults.color = dark ? '#9aa6b8' : '#7d8597';
      const chartEdge = dark ? '#1f2631' : '#ffffff';
      window.__charts = window.__charts || [];
      window.__chartThemeUpdate = (theme) => {
        if (typeof window.Chart === 'undefined') return;
        Chart.defaults.color = theme === 'dark' ? '#9aa6b8' : '#7d8597';
        (window.__charts || []).forEach(ch => {
          try {
            if (ch.options && ch.options.scales) {
              Object.keys(ch.options.scales).forEach(k => {
                if (ch.options.scales[k] && ch.options.scales[k].grid) ch.options.scales[k].grid.color = theme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
              });
            }
            if (ch.data && ch.data.datasets && ch.data.datasets.length) {
              ch.data.datasets.forEach(ds => { if (ds.borderColor && !Array.isArray(ds.borderColor)) ds.borderColor = theme === 'dark' ? '#1f2631' : '#ffffff'; });
            }
            ch.update();
          } catch (e) {}
        });
      };
      const C = { blue: '#315fb3', blueLight: '#8aa8e0', green: '#2e9e5b', purple: '#6b7aff', amber: '#f2a20c', red: '#e74c3c', gray: '#c3c8d2' };

      const moneyTicks = (v) => '₱' + (v >= 1000 ? (v / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : v);
      const moneyLabel = (ctx) => ' ' + fmtCurrency(ctx.parsed.y ?? ctx.parsed);

      // 1. Sales trend — last 7 days
      const salesLabels = [], salesValues = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const iso = d.toISOString().split('T')[0];
        salesLabels.push(d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
        salesValues.push(recentOrders.filter(o => o.date === iso).reduce((s, o) => s + o.amount, 0));
      }
      window.__charts.push(new Chart(document.getElementById('salesTrendChart'), {
        type: 'bar',
        data: {
          labels: salesLabels,
          datasets: [{
            label: 'Sales',
            data: salesValues,
            backgroundColor: salesValues.map((v, i) => (i === salesValues.length - 1 ? C.blue : C.blueLight)),
            borderRadius: 6,
            maxBarThickness: 40
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: moneyLabel } } },
          scales: { x: { grid: { display: false } }, y: { beginAtZero: true, ticks: { callback: moneyTicks } } }
        }
      }));

      // 2. Sales by channel — this month
      const monthOrders = recentOrders.filter(o => o.date >= monthStart);
      const channelOnline = monthOrders.filter(o => /online/i.test(o.type)).reduce((s, o) => s + o.amount, 0);
      const channelWalkin = monthOrders.filter(o => !/online/i.test(o.type)).reduce((s, o) => s + o.amount, 0);
      const channelHasData = channelOnline + channelWalkin > 0;
      window.__charts.push(new Chart(document.getElementById('channelChart'), {
        type: 'doughnut',
        data: {
          labels: ['Online', 'Walk-in'],
          datasets: [{
            data: channelHasData ? [channelOnline, channelWalkin] : [1],
            backgroundColor: channelHasData ? [C.blue, C.blueLight] : [C.gray],
            borderColor: chartEdge, borderWidth: 3, hoverOffset: 8
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false, cutout: '68%',
          plugins: {
            legend: { display: channelHasData, position: 'bottom', labels: { usePointStyle: true, pointStyle: 'circle', padding: 16 } },
            tooltip: { enabled: channelHasData, callbacks: { label: (ctx) => ' ' + ctx.label + ': ' + fmtCurrency(ctx.parsed) } }
          }
        }
      }));

      // 3. Order status distribution
      const statusColors = { pending: C.amber, completed: C.green, shipped: C.blue, delivered: C.purple, cancelled: C.red, declined: C.red };
      const statusMap = {};
      recentOrders.forEach(o => {
        const k = String(o.status || 'unknown').toLowerCase();
        statusMap[k] = (statusMap[k] || 0) + 1;
      });
      const statusKeys = Object.keys(statusMap);
      const statusHasData = statusKeys.length > 0;
      window.__charts.push(new Chart(document.getElementById('statusChart'), {
        type: 'doughnut',
        data: {
          labels: statusHasData ? statusKeys.map(k => k.charAt(0).toUpperCase() + k.slice(1)) : ['No data'],
          datasets: [{
            data: statusHasData ? Object.values(statusMap) : [1],
            backgroundColor: statusHasData ? statusKeys.map(k => statusColors[k] || C.gray) : [C.gray],
            borderColor: chartEdge, borderWidth: 3, hoverOffset: 8
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false, cutout: '68%',
          plugins: {
            legend: { display: statusHasData, position: 'bottom', labels: { usePointStyle: true, pointStyle: 'circle', padding: 16 } },
            tooltip: { enabled: statusHasData }
          }
        }
      }));

      // 4. Low-stock watch
      const lowProducts = [...lowStockItems].sort((a, b) => (a.stock || 0) - (b.stock || 0)).slice(0, 8).reverse();
      if (lowProducts.length) {
        window.__charts.push(new Chart(document.getElementById('lowStockChart'), {
          type: 'bar',
          data: {
            labels: lowProducts.map(p => p.name),
            datasets: [{
              label: 'Stock',
              data: lowProducts.map(p => p.stock || 0),
              backgroundColor: lowProducts.map(p => (p.stock === 0 ? C.red : (p.stock || 0) <= 2 ? C.blue : C.blueLight)),
              borderRadius: 6,
              maxBarThickness: 16
            }]
          },
          options: {
            indexAxis: 'y', responsive: true, maintainAspectRatio: false,
            plugins: {
              legend: { display: false },
              tooltip: { callbacks: { label: (ctx) => ' ' + ctx.parsed.x + ' in stock' } }
            },
            scales: { x: { beginAtZero: true, grid: { drawBorder: false } }, y: { grid: { display: false }, ticks: { font: { size: 11 } } } }
          }
        }));
      } else {
        const emptyEl = document.getElementById('lowStockEmpty');
        if (emptyEl) emptyEl.style.display = 'block';
      }
    }
  })();
}

// ==========================================
// 4. INVENTORY (includes imported products)
// ==========================================
const inventoryTableBody = document.getElementById('inventoryTableBody');
if (inventoryTableBody) {
  async function fetchInv() { return await fetchAll('inventory'); }
  async function saveInv(p) { await upsertAll('inventory', p); }

  let _invSource = 'all';
  window.filterInventory = (source) => {
    _invSource = source;
    _invPage = 1;
    document.querySelectorAll('.sub-nav-item').forEach(b => b.classList.toggle('active', b.dataset.source === source));
    renderInv();
  };

  let _invPage = 1;
  const INV_PER_PAGE = 10;

  function invLowRank(p) {
    return p.enabled && (p.stock || 0) <= (p.threshold || 5) ? 0 : 1;
  }

  function invStatusPill(p) {
    if (!p.enabled) return '<span class="status-pill paused">Disabled</span>';
    const st = p.stock || 0;
    if (st <= 0) return '<span class="status-pill danger">Out of Stock</span>';
    if (st <= (p.threshold || 5)) return '<span class="status-pill warn">Low Stock</span>';
    return '<span class="status-pill active">In Stock</span>';
  }

  function renderInvPagination(total, totalPages, start) {
    const el = document.getElementById('inventoryPagination');
    if (!el) return;
    if (total === 0) { el.innerHTML = ''; return; }
    const end = Math.min(start + INV_PER_PAGE, total);
    let html = '<span class="page-info">Showing ' + (start + 1) + '&#8211;' + end + ' of ' + total + '</span>';
    html += '<button class="page-btn" ' + (_invPage <= 1 ? 'disabled' : 'onclick="invGoToPage(' + (_invPage - 1) + ')"') + '>Prev</button>';
    let pages = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages = [1, _invPage - 1, _invPage, _invPage + 1, totalPages].filter((v, i, a) => v >= 1 && v <= totalPages && a.indexOf(v) === i).sort((x, y) => x - y);
    }
    let last = 0;
    pages.forEach(n => {
      if (last && n - last > 1) html += '<span class="page-ellipsis">&#8230;</span>';
      html += '<button class="page-btn' + (n === _invPage ? ' active' : '') + '" onclick="invGoToPage(' + n + ')">' + n + '</button>';
      last = n;
    });
    html += '<button class="page-btn" ' + (_invPage >= totalPages ? 'disabled' : 'onclick="invGoToPage(' + (_invPage + 1) + ')"') + '>Next</button>';
    el.innerHTML = html;
  }

  async function renderInv() {
    await getRules();
    const inv = await fetchInv();
    const imp = await fetchAll('imported_products');
    const fmt = (a) => '₱' + a.toLocaleString('en-US', { minimumFractionDigits: 2 });
    let all = [...inv.map(p => ({ ...p, _src: 'inventory' })), ...imp.map(p => ({ ...p, _src: 'imported' }))];
    setNavBadge('navBadgeInventory', all.some(p => p.enabled && (p.stock || 0) <= (p.threshold || 5)));
    if (_invSource !== 'all') all = all.filter(p => p._src === _invSource);

    const qEl = document.getElementById('inventorySearch');
    const q = qEl ? String(qEl.value || '').trim().toLowerCase() : '';
    if (q) all = all.filter(p => String(p.name || '').toLowerCase().includes(q) || String(p.category || '').toLowerCase().includes(q));

    all.sort((a, b) => (invLowRank(a) - invLowRank(b)) || ((a.stock || 0) - (b.stock || 0)));

    const total = all.length;
    const totalPages = Math.max(1, Math.ceil(total / INV_PER_PAGE));
    if (_invPage > totalPages) _invPage = totalPages;
    const start = (_invPage - 1) * INV_PER_PAGE;
    const pageItems = all.slice(start, start + INV_PER_PAGE);

    inventoryTableBody.innerHTML = pageItems.length ? pageItems.map(p => {
      let toggleHtml;
      if (p._src === 'imported') {
        toggleHtml = '<button class="btn-toggle ' + (p.enabled ? 'active' : 'inactive') + '" onclick="toggleImportProduct(' + p.id + ')">' + (p.enabled ? 'Active' : 'Disabled') + '</button>';
      } else {
        toggleHtml = '<button class="btn-toggle ' + (p.enabled ? 'active' : 'inactive') + '" onclick="toggleProduct(' + p.id + ')">' + (p.enabled ? 'Active' : 'Disabled') + '</button>';
      }
const imgHtml = '<img src="' + productImage(p, 200) + '" class="inv-thumb" alt="' + esc(p.name) + '" loading="lazy">';
      return '<tr>' +
        '<td>' + imgHtml + '</td>' +
        '<td><strong>' + esc(p.name) + '</strong>' + (p._src === 'imported' ? ' <span style="font-size:11px;color:#999;">(imported)</span>' : '') + '</td>' +
        '<td>' + esc(p.category || guessCategory(p.name)) + '</td>' +
        '<td>' + (isRuleAdjusted(p) ? '<span class="price-rule" title="Price automation is active for this product">' + fmt(ruleAdjustedPrice(p)) + '</span><div class="price-base">' + fmt(p.price) + '</div>' : fmt(p.price)) + '</td>' +
        '<td>' + p.stock + '</td>' +
        '<td>' + invStatusPill(p) + '</td>' +
        '<td style="white-space:nowrap;text-align:center;">' +
          (p._src === 'imported'
            ? '<button class="btn-icon" onclick="editImportProduct(' + p.id + ')" title="Edit">Edit</button>'
            : '<button class="btn-icon" onclick="editProduct(' + p.id + ')" title="Edit">Edit</button>') +
          toggleHtml +
'</td>' +
      '</tr>';
    }).join('') : '<tr><td colspan="7" style="text-align:center;color:#999;padding:30px 0;">There\'s nothing here.</td></tr>';
    renderInvPagination(total, totalPages, start);
  }

  window.invGoToPage = (n) => { _invPage = n; renderInv(); }; 

  const inventorySearchInput = document.getElementById('inventorySearch');
  if (inventorySearchInput) {
    inventorySearchInput.addEventListener('input', () => { _invPage = 1; renderInv(); });
  }

window.toggleProduct = async (id) => {
    const p = await fetchInv();
    const r = p.find(x => x.id === id);
    if (r) { r.enabled = !r.enabled; await saveInv(p); renderInv(); showToast(r.enabled ? 'Product enabled.' : 'Product disabled.', 'success'); }
  };

  window.deleteProduct = async () => {
    const id = document.getElementById('editProductId').value;
    if (!id) return;
    showConfirm('Delete this product permanently?', () => void (async () => {
      try {
        let products = await fetchInv();
        products = products.filter(p => p.id !== parseInt(id));
        await saveInv(products);
        renderInv();
        closeProductModal();
        showToast('Product deleted.', 'success');
      } catch(e) { showToast('Failed to delete: ' + (e.message || 'Unknown error'), 'error'); }
    })());
  };

  window.openAddProductModal = () => {
    document.getElementById('productModalTitle').textContent = 'Add Product';
    document.getElementById('editProductId').value = '';
    document.getElementById('productName').value = '';
    document.getElementById('productPrice').value = '';
    document.getElementById('productStock').value = '';
    document.getElementById('productThreshold').value = '5';
    document.getElementById('productEnabled').value = 'checked';
    document.getElementById('productImage').value = '';
    document.getElementById('imagePreview').style.display = 'none';
    document.getElementById('imagePreview').innerHTML = '';
    document.getElementById('deleteProductBtn').style.display = 'none';
    document.getElementById('productModal').style.display = 'flex';
  };
  window.closeProductModal = () => { document.getElementById('productModal').style.display = 'none'; };
  window.previewImage = (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const p = document.getElementById('imagePreview');
      p.style.display = 'block'; p.innerHTML = '<img src="' + e.target.result + '">';
    };
    reader.readAsDataURL(file);
  };
window.saveProduct = () => {
    const id = document.getElementById('editProductId').value;
    const name = document.getElementById('productName').value.trim();
    const description = document.getElementById('productDescription').value.trim();
    const price = parseFloat(document.getElementById('productPrice').value);
    const stock = parseInt(document.getElementById('productStock').value);
    const threshold = parseInt(document.getElementById('productThreshold').value);
    const enabled = document.getElementById('productEnabled').value === 'checked';
    const preview = document.getElementById('imagePreview');
    const imgSrc = preview.querySelector('img') ? preview.querySelector('img').src : '';
    if (!name || isNaN(price) || isNaN(stock) || isNaN(threshold)) { showToast('Please fill all fields.', 'error'); return; }
    const isEdit = !!id;
    showConfirm(isEdit ? 'Save changes to "' + name + '"?' : 'Add "' + name + '" to inventory?', () => void (async () => {
      try {
        const products = await fetchInv();
        if (id) {
          const p = products.find(x => x.id === parseInt(id));
          if (p) { p.name = name; p.description = description; p.price = price; p.stock = stock; p.threshold = threshold; p.enabled = enabled; p.category = guessCategory(name); if (imgSrc) p.image = imgSrc; }
        } else {
          const newId = products.length > 0 ? Math.max(...products.map(x => x.id)) + 1 : 1;
          products.push({ id: newId, name, description, price, stock, threshold, enabled, image: imgSrc, category: guessCategory(name) });
        }
        await saveInv(products);
        renderInv();
        closeProductModal();
        showToast(isEdit ? 'Product updated.' : 'Product added.', 'success');
      } catch(e) { showToast('Failed to save: ' + (e.message || 'Unknown error'), 'error'); }
    })());
  };
  window.editProduct = async (id) => {
    const products = await fetchInv();
    const p = products.find(x => x.id === id);
    if (!p) return;
    document.getElementById('productModalTitle').textContent = 'Edit Product';
    document.getElementById('editProductId').value = p.id;
    document.getElementById('productName').value = p.name;
    document.getElementById('productDescription').value = p.description || '';
    document.getElementById('productPrice').value = p.price;
    document.getElementById('productStock').value = p.stock;
    document.getElementById('productThreshold').value = p.threshold || 5;
    document.getElementById('productEnabled').value = p.enabled ? 'checked' : '';
    document.getElementById('deleteProductBtn').style.display = 'inline-block';
    const preview = document.getElementById('imagePreview');
    if (p.image) { preview.style.display = 'block'; preview.innerHTML = '<img src="' + p.image + '">'; }
    else { preview.style.display = 'none'; preview.innerHTML = ''; }
    document.getElementById('productImage').value = '';
    document.getElementById('productModal').style.display = 'flex';
  };

  // Import Excel directly into inventory
  window.inventoryImportExcel = (event) => {
    const file = event.target.files[0];
    if (!file) return;
    if (typeof XLSX === 'undefined') { showToast('Excel library failed to load.', 'error'); return; }
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json(sheet, { header: 1 });
        if (json.length < 2) { showToast('Excel file has no data rows.', 'error'); return; }
        const hr = json[0].map(h => String(h || '').toLowerCase().trim());
        const ni = hr.findIndex(h => h.includes('product') || h.includes('name') || h.includes('item'));
        const pi = hr.findIndex(h => h.includes('price') || h.includes('amount') || h.includes('cost'));
        const si = hr.findIndex(h => h.includes('stock') || h.includes('qty') || h.includes('quantity'));
        const products = await fetchAll('imported_products');
        const existingNames = new Set(products.map(p => p.name.toLowerCase()));
        let nextId = products.length > 0 ? Math.max(...products.map(x => x.id)) + 1 : 1;
        let count = 0, skipped = 0;
        for (let i = 1; i < json.length; i++) {
          const row = json[i];
          if (!row || row.length === 0) continue;
          const name = ni >= 0 ? String(row[ni] || '').trim() : (String(row[0] || '').trim());
          if (!name) continue;
          if (existingNames.has(name.toLowerCase())) { skipped++; continue; }
          const price = parseFloat(pi >= 0 ? row[pi] : row[1]) || 0;
          const stock = parseInt(si >= 0 ? row[si] : row[2]) || 0;
          products.push({ id: nextId++, name, price, stock, threshold: 5, enabled: true, image: '', category: guessCategory(name) });
          existingNames.add(name.toLowerCase());
          count++;
        }
        await upsertAll('imported_products', products);
        renderInv();
        const msg = 'Imported ' + count + ' product' + (count !== 1 ? 's' : '') + '.';
showToast(skipped ? msg + ' (' + skipped + ' duplicate' + (skipped > 1 ? 's' : '') + ' skipped)' : msg, 'success');
      } catch (err) { showToast('Error reading file: ' + err.message, 'error'); }
    };
    reader.readAsArrayBuffer(file);
    event.target.value = '';
  };

  // Imported product inline edit
  window.editImportProduct = async (id) => {
    const products = await fetchAll('imported_products');
    const p = products.find(x => x.id === id);
    if (!p) return;
    document.getElementById('importProductModalTitle').textContent = 'Edit Imported Product';
    document.getElementById('editImportProductId').value = p.id;
    document.getElementById('importProductName').value = p.name;
    document.getElementById('importProductDescription').value = p.description || '';
    document.getElementById('importProductPrice').value = p.price;
    document.getElementById('importProductStock').value = p.stock;
    document.getElementById('importProductEnabled').value = p.enabled ? 'checked' : '';
    document.getElementById('importProductModal').style.display = 'flex';
  };
window.closeImportProductModal = () => { document.getElementById('importProductModal').style.display = 'none'; };
  window.saveImportProduct = () => {
    const id = document.getElementById('editImportProductId').value;
    const name = document.getElementById('importProductName').value.trim();
    const description = document.getElementById('importProductDescription').value.trim();
    const price = parseFloat(document.getElementById('importProductPrice').value);
    const stock = parseInt(document.getElementById('importProductStock').value);
    const enabled = document.getElementById('importProductEnabled').value === 'checked';
    if (!name || isNaN(price) || isNaN(stock)) { showToast('Please fill all fields.', 'error'); return; }
    const isEdit = !!id;
    showConfirm(isEdit ? 'Save changes to "' + name + '"?' : 'Add "' + name + '" to inventory?', () => void (async () => {
      try {
        const products = await fetchAll('imported_products');
        if (id) { const p = products.find(x => x.id === parseInt(id));       if (p) { p.name = name; p.description = description; p.price = price; p.stock = stock; p.enabled = enabled; p.category = guessCategory(name); } }
        else { const newId = products.length > 0 ? Math.max(...products.map(x => x.id)) + 1 : 1; products.push({ id: newId, name, description, price, stock, enabled: enabled, threshold: 5, image: '', category: guessCategory(name) }); }
        await upsertAll('imported_products', products);
        renderInv();
        closeImportProductModal();
        showToast(isEdit ? 'Product updated.' : 'Product added.', 'success');
      } catch(e) { showToast('Failed to save: ' + (e.message || 'Unknown error'), 'error'); }
    })());
  };
  window.toggleImportProduct = async (id) => {
    const products = await fetchAll('imported_products');
    const p = products.find(x => x.id === id);
    if (p) { p.enabled = !p.enabled; await upsertAll('imported_products', products); renderInv(); showToast(p.enabled ? 'Product enabled.' : 'Product disabled.', 'success'); }
  };

  renderInv();
}

// One-time cleanup: remove legacy sample inventory products from cache + backend
(function removeSampleInventory() {
  const samples = [
    'Wireless Mouse', 'Gaming Chair', 'Monitor Arm', 'RGB Strip', 'External HDD 2TB',
    'Mechanical Numpad', 'USB Microphone', 'LED Desk Lamp', 'Cable Mgmt Kit', 'Cooling Pad',
    'Wireless Charger', 'Stream Deck'
  ];
  const lower = samples.map(s => s.toLowerCase());
  try {
    const raw = localStorage.getItem('inventory');
    if (raw) {
      const rows = JSON.parse(raw);
      const kept = rows.filter(p => !lower.includes(String(p.name || '').trim().toLowerCase()));
      if (kept.length !== rows.length) {
        localStorage.setItem('inventory', JSON.stringify(kept));
        if (sbClient) {
          sb('inventory').delete().in('name', samples).then(() => {}).catch(() => {});
        }
      }
    }
  } catch (e) {}
})();

// One-time cleanup: remove legacy sample imported products from cache + backend
(function removeSampleImportedProducts() {
  const samples = ['Ergonomic Keyboard', 'Portable Monitor 15.6"', 'Desk Mount Dual Arm', 'Noise Canceling Earbuds'];
  const lower = samples.map(s => s.toLowerCase());
  try {
    const raw = localStorage.getItem('imported_products');
    if (raw) {
      const rows = JSON.parse(raw);
      const kept = rows.filter(p => !lower.includes(String(p.name || '').trim().toLowerCase()));
      if (kept.length !== rows.length) {
        localStorage.setItem('imported_products', JSON.stringify(kept));
        if (sbClient) {
          sb('imported_products').delete().in('name', samples).then(() => {}).catch(() => {});
        }
      }
    }
  } catch (e) {}
})();
// ==========================================
// 5. ONLINE ORDERS
// ==========================================
const ordersContainer = document.getElementById('ordersContainer');
const filterTabs = document.querySelectorAll('.sub-nav-item');

if (ordersContainer && filterTabs.length > 0) {
  let onlineOrders = [];

  function toNum(v) { return parseFloat(String(v ?? '').replace(/[^0-9.\-]/g, '')) || 0; }

  function pickName(v) {
    if (!v) return '';
    if (typeof v === 'string') return v.trim();
    if (Array.isArray(v)) return v.length ? String(v[0]) : '';
    if (typeof v === 'object') return v.name || v.full_name || v.username || '';
    return String(v);
  }

  function parseOrderItems(raw) {
    if (!raw) return [];
    if (Array.isArray(raw)) {
      return raw.map(i => ({ name: i.name || i.item || 'Item', qty: i.qty || 1, price: toNum(i.price) || toNum(i.value) || 0 }));
    }
    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parseOrderItems(parsed);
      } catch (e) {}
      return raw.split(',').filter(Boolean).map(i => ({ name: i.trim(), qty: 1, price: 0 }));
    }
    return [];
  }

  function persistOnlineOrders() {
    localStorage.setItem('onlineOrders', JSON.stringify(onlineOrders));
  }

  async function deductStockByName(items) {
    const inv = await fetchAll('inventory');
    const imp = await fetchAll('imported_products');
    let changedInv = false, changedImp = false;
    (items || []).forEach(it => {
      const qty = it.qty || 1;
      const nm = String(it.name || '').trim().toLowerCase();
      if (!nm) return;
      const p = inv.find(x => x.name && String(x.name).toLowerCase() === nm);
      if (p) { p.stock = Math.max(0, (p.stock || 0) - qty); changedInv = true; return; }
      const pi = imp.find(x => x.name && String(x.name).toLowerCase() === nm);
      if (pi) { pi.stock = Math.max(0, (pi.stock || 0) - qty); changedImp = true; }
    });
    if (changedInv) await upsertAll('inventory', inv);
    if (changedImp) await upsertAll('imported_products', imp);
  }

  async function callOrdersFn(action, order_id, extra) {
    if (!sbClient || !sbClient.functions) return { ok: false, error: 'Supabase client not ready' };
    try {
      const { error } = await sbClient.functions.invoke('admin-orders', {
        method: action ? 'POST' : 'GET',
        body: action ? { action, order_id, ...(extra || {}) } : undefined
      });
      if (error) throw error;
      return { ok: true };
    } catch (e) {
      const msg = (e && (e.message || (e.context && e.context.message))) || String(e);
      console.error('admin-orders call failed:', msg);
      return { ok: false, error: msg };
    }
  }

  function orderDateTime(iso) {
    if (!iso) return { date: getTodayStr(), time: '12:00 PM' };
    const d = new Date(iso);
    if (isNaN(d.getTime())) return { date: String(iso).slice(0, 10), time: '12:00 PM' };
    return {
      date: d.toLocaleDateString('en-CA'),
      time: d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    };
  }

  async function fetchOnlineOrders() {
    const raw = localStorage.getItem('onlineOrders');
    const local = raw ? JSON.parse(raw) : [];
    if (!sbClient || !sbClient.functions) return local;
    try {
      console.log('Fetching orders from edge function...');
      const { data, error } = await sbClient.functions.invoke('admin-orders', { method: 'GET' });
      if (error) throw error;
      console.log('Orders fetched:', data);
      const orders = (data && data.orders) || [];
      const mapped = orders.map(o => {
        const dt = orderDateTime(o.created_at);
        return {
          id: o.id, code: String(o.id || '').toUpperCase().slice(0, 8),
          customer: pickName(o.customer_name) || 'Customer', address: o.address || '',
          phone: o.phone || '', email: o.email || '',
          payment_method: o.payment_method || '',
          amount: o.total || 0,
          status: String(o.status || 'pending').toLowerCase(),
          date: dt.date, time: dt.time,
          createdAt: o.created_at || '',
          cancel_reason: o.cancel_reason || '',
          cancelled_by: o.cancelled_by || '',
          cancelled_reason: o.cancelled_reason || '',
          refunded_at: o.refunded_at || '',
          items: parseOrderItems(o.items)
        };
      });
      if (mapped.length) localStorage.setItem('onlineOrders', JSON.stringify(mapped));
      else localStorage.removeItem('onlineOrders');
      return mapped;
    } catch (e) { return local; }
  }

  (async () => {
    onlineOrders = await fetchOnlineOrders();
    renderOrders('pending');
  })();

function cancelInfo(o) {
    const byRaw = String(o.cancelled_by || '').trim().toLowerCase();
    const adminReason = String(o.cancelled_reason || '').trim();
    const custReason = String(o.cancel_reason || '').trim();
    const isAdmin = byRaw === 'admin' || byRaw === 'seller' || (byRaw === '' && !!adminReason && !custReason);
    return {
      who: isAdmin ? 'Admin' : 'Customer',
      isAdmin,
      adminReason,
      custReason,
      reason: isAdmin ? adminReason : custReason
    };
  }

  const PCROVER_STORE_ADDRESS = '770 Sitio 4 Laot, Bahay Pare, Candaba, 2013 Pampanga';

  async function resolveOrderEmail(order) {
    const cached = String((order && order.email) || '').trim();
    if (cached) return cached;
    if (!order || !order.id || !sbClient || !sbClient.functions) return '';
    try {
      const { data, error } = await sbClient.functions.invoke('admin-orders', { method: 'GET' });
      if (error) return '';
      const fresh = ((data && data.orders) || []).find(o => o.id === order.id);
      return String((fresh && fresh.email) || '').trim();
    } catch (e) { return ''; }
  }

  async function composeOrderEmail(order, type) {
    try {
      const email = await resolveOrderEmail(order);
      if (!email) { showToast('This order has no email address to notify.', 'error'); return; }
      const code = String((order && (order.code || order.id)) || '');
      let subject, body;
      if (type === 'accepted') {
        subject = 'PC Rover – Your order #' + code + ' has been accepted';
        body = 'Hello ' + (order.customer || 'there') + ',\n\n'
          + 'Your order no. "' + code + '" has been accepted.\n\n'
          + '-PC Rover team';
      } else if (type === 'declined') {
        subject = 'PC Rover – Your order #' + code + ' has been declined';
        body = 'Hello ' + (order.customer || 'there') + ',\n\n'
          + 'Your order no. "' + code + '" has been declined.\n'
          + 'Copy the order code and contact us for the full payment process.\n\n'
          + '-PC Rover team';
      } else if (type === 'ready') {
        subject = 'PC Rover – Your order #' + code + ' is ready for delivery';
        body = 'Hello ' + (order.customer || 'there') + ',\n\n'
          + 'Your order no. "' + code + '" is now ready for delivery.\n';
        const pm = String(order.payment_method || '').toLowerCase();
        if (pm === 'pickup') {
          body += 'Go to our physical store ' + PCROVER_STORE_ADDRESS + ' to claim your item.\n';
        }
        body += '\n-PC Rover team';
      } else {
        return;
      }
      const gmailUrl = 'https://mail.google.com/mail/?view=cm&fs=1&to=' + encodeURIComponent(email)
        + '&su=' + encodeURIComponent(subject)
        + '&body=' + encodeURIComponent(body);
      const win = window.open(gmailUrl, '_blank');
      if (!win) window.location.href = gmailUrl;
    } catch (e) {
      console.error('composeOrderEmail failed:', e);
      showToast('Could not open the email app for this order.', 'error');
    }
  }

  function orderTs(o) {
    if (o.createdAt) {
      const t = new Date(o.createdAt).getTime();
      if (!isNaN(t)) return t;
    }
    const parts = String(o.time || '').match(/(\d+):(\d+)\s*(AM|PM)/i);
    if (!parts || !o.date) return 0;
    let h = parseInt(parts[1], 10) % 12;
    if (/pm/i.test(parts[3])) h += 12;
    return new Date(o.date + 'T' + String(h).padStart(2, '0') + ':' + parts[2] + ':00').getTime();
  }

  function refundLabel(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function renderOrders(filterStatus) {
    const isCancelTab = filterStatus === 'cancelled';
    const searchInput = document.getElementById('cancelledSearch');
    const q = isCancelTab && searchInput ? String(searchInput.value || '').trim().toLowerCase() : '';
    const filtered = onlineOrders
      .filter(o => {
        const st = isCancelTab ? (o.status === 'cancelled' || o.status === 'declined') : o.status === filterStatus;
        if (!st) return false;
        if (q) {
          const code = String(o.code || o.id || '').toLowerCase();
          if (!code.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => (isCancelTab ? (a.refunded_at ? 1 : 0) - (b.refunded_at ? 1 : 0) : 0) || orderTs(a) - orderTs(b));
    ordersContainer.innerHTML = filtered.length
      ? filtered.map(order => {
          const cancelMeta = isCancelTab
            ? '<div class="cancel-meta">Cancelled by ' + esc(cancelInfo(order).who) + ' &middot; ' + esc(cancelInfo(order).reason || 'No reason given') + (order.refunded_at ? ' <span class="refunded-chip">Refunded</span>' : '') + '</div>'
            : '';
          return '<div class="order-card' + (isCancelTab ? ' order-card-cancelled' : '') + '"><div class="order-card-top"><div><span class="order-id">#' + esc(order.code || order.id) + '</span><span class="order-time">' + esc(order.date) + ' ' + esc(order.time) + '</span></div><button class="btn-view" onclick="viewOrder(\'' + esc(order.id) + '\')">View</button></div><div class="order-card-body"><div class="order-customer">' + esc(order.customer) + '</div><div class="order-address">' + esc(order.address) + '</div>' + cancelMeta + '</div></div>';
        }).join('')
      : '<div style="text-align:center;color:var(--text-faint);padding:60px 0;">There\'s nothing here.</div>';
  }

  window.viewOrder = (id) => {
    const order = onlineOrders.find(o => o.id === id);
    if (!order) return;
    const modal = document.getElementById('orderModal'), body = document.getElementById('modalBody'), footer = document.getElementById('modalFooter');
const itemsHtml = order.items.map(item => '<tr><td>' + esc(item.name) + '</td><td>' + item.qty + '</td><td>' + fmtCurrency(item.price) + '</td><td>' + fmtCurrency(item.qty * item.price) + '</td></tr>').join('');
    const isCancelled = order.status === 'cancelled' || order.status === 'declined';
    const cInfo = cancelInfo(order);
    const cancelRows = isCancelled
      ? '<div class="modal-info-row"><span class="modal-label">Cancelled by</span><span>' + esc(cInfo.who) + '</span></div><div class="modal-info-row"><span class="modal-label">Customer reason</span><span>' + esc(cInfo.custReason || '—') + '</span></div><div class="modal-info-row"><span class="modal-label">Admin reason</span><span>' + esc(cInfo.adminReason || '—') + '</span></div>'
      : '';
    body.innerHTML = '<div class="modal-info-row"><span class="modal-label">Order Code</span><span>#' + esc(order.code || order.id) + '</span></div><div class="modal-info-row"><span class="modal-label">Date & Time</span><span>' + esc(order.date) + ' ' + esc(order.time) + '</span></div><div class="modal-info-row"><span class="modal-label">Customer</span><span>' + esc(order.customer) + '</span></div><div class="modal-info-row"><span class="modal-label">Address</span><span>' + esc(order.address) + '</span></div><div class="modal-info-row"><span class="modal-label">Phone</span><span>' + esc(order.phone) + '</span></div><div class="modal-info-row"><span class="modal-label">Email</span><span>' + esc(order.email) + '</span></div>' + cancelRows + '<h4 style="margin:16px 0 8px;color:var(--pc-blue);">Products Ordered</h4><table class="modal-items-table"><thead><tr><th>Item</th><th>Qty</th><th>Price</th><th>Subtotal</th></tr></thead><tbody>' + itemsHtml + '</tbody><tfoot><tr><td colspan="3"><strong>Total Amount</strong></td><td><strong>' + fmtCurrency(order.amount) + '</strong></td></tr></tfoot></table>';
    const closeBtn = '<button class="btn btn-secondary" onclick="closeOrderModal()" style="color:var(--text-muted);border:1px solid var(--border-strong);background:transparent;padding:10px 24px;border-radius:6px;font-size:14px;font-weight:600;cursor:pointer;">Close</button>';
    if (isCancelled) footer.innerHTML = closeBtn + (order.refunded_at
      ? '<span class="refunded-badge">Refunded ' + esc(refundLabel(order.refunded_at)) + '</span>'
      : '<button class="btn btn-refund" onclick="refundOrder(\'' + order.id + '\')">Mark as Refunded</button>');
    else if (order.status === 'pending') footer.innerHTML = '<button class="btn btn-decline" onclick="openCancelModal(\'' + order.id + '\')">Cancel Order</button><button class="btn btn-primary" onclick="acceptOrder(\'' + order.id + '\')">Accept</button>';
    else if (order.status === 'shipped') footer.innerHTML = closeBtn + '<button class="btn btn-decline" onclick="openCancelModal(\'' + order.id + '\')">Cancel Order</button><button class="btn btn-primary" onclick="deliverOrder(\'' + order.id + '\')">Mark as to be deliver</button>';
    else if (order.status === 'delivered') footer.innerHTML = closeBtn + '<button class="btn btn-decline" onclick="openCancelModal(\'' + order.id + '\')">Cancel Order</button><button class="btn btn-primary" onclick="finishOrder(\'' + order.id + '\')">Order Finished</button>';
    else footer.innerHTML = closeBtn;
    modal.style.display = 'flex';
  };

  window.closeOrderModal = () => { document.getElementById('orderModal').style.display = 'none'; };
  window.refundOrder = async (id) => {
    const r = await callOrdersFn('refund', id);
    if (!r.ok) { showToast('Failed to mark as refunded: ' + r.error, 'error'); return; }
    const o = onlineOrders.find(x => x.id === id);
    if (o) { o.refunded_at = new Date().toISOString(); persistOnlineOrders(); }
    renderOrders(document.querySelector('.sub-nav-item.active').dataset.status);
    closeOrderModal();
    showToast('Order marked as refunded.', 'success');
  };
  window.acceptOrder = async (id) => {
    const r = await callOrdersFn('accept', id);
    if (!r.ok) { showToast('Failed to accept order: ' + r.error, 'error'); return; }
    const o = onlineOrders.find(x => x.id === id);
    if (o) {
      await deductStockByName(o.items);
      o.status = 'shipped'; persistOnlineOrders();
    }
    renderOrders(document.querySelector('.sub-nav-item.active').dataset.status);
    closeOrderModal();
    refreshNavNotifications();
    showToast('Order accepted.', 'success');
    if (o) composeOrderEmail(o, 'accepted');
  };
  window.declineOrder = async (id) => {
    const r = await callOrdersFn('decline', id);
    if (!r.ok) { showToast('Failed to decline order: ' + r.error, 'error'); return; }
    const o = onlineOrders.find(x => x.id === id);
    if (o) { o.status = 'cancelled'; o.cancelled_by = 'seller'; persistOnlineOrders(); }
    renderOrders(document.querySelector('.sub-nav-item.active').dataset.status);
    closeOrderModal();
    refreshNavNotifications();
    showToast('Order declined.', 'success');
    if (o) composeOrderEmail(o, 'declined');
  };
  window.deliverOrder = async (id) => {
    const r = await callOrdersFn('deliver', id);
    if (!r.ok) { showToast('Failed to update order: ' + r.error, 'error'); return; }
    const o = onlineOrders.find(x => x.id === id);
    if (o) { o.status = 'delivered'; persistOnlineOrders(); }
    renderOrders(document.querySelector('.sub-nav-item.active').dataset.status);
    closeOrderModal();
    showToast('Order marked as to be delivered.', 'success');
    if (o) composeOrderEmail(o, 'ready');
  };
  window.finishOrder = async (id) => {
    const r = await callOrdersFn('finish', id);
    if (!r.ok) { showToast('Failed to finish order: ' + r.error, 'error'); return; }
    const o = onlineOrders.find(x => x.id === id);
    if (o) { o.status = 'completed'; persistOnlineOrders(); }
    renderOrders(document.querySelector('.sub-nav-item.active').dataset.status);
    closeOrderModal();
    refreshNavNotifications();
    showToast('Order marked as finished.', 'success');
  };

  let _cancelTargetId = null;
  window.openCancelModal = (id) => {
    const o = onlineOrders.find(x => x.id === id);
    _cancelTargetId = id;
    const note = document.getElementById('cancelModalNote');
    if (note) note.textContent = 'Order #' + esc((o && (o.code || o.id)) || id) + ' will be cancelled and moved to the Cancelled tab.';
    document.getElementById('cancelReasonSelect').value = 'inventory issue';
    document.getElementById('cancelModal').style.display = 'flex';
  };
  window.closeCancelModal = () => { document.getElementById('cancelModal').style.display = 'none'; _cancelTargetId = null; };
  window.confirmCancelOrder = async () => {
    const id = _cancelTargetId;
    if (!id) return;
    const reason = document.getElementById('cancelReasonSelect').value;
    const r = await callOrdersFn('cancel', id, { reason });
    if (!r.ok) { showToast('Failed to cancel order: ' + r.error + ' (The order was NOT changed.)', 'error'); return; }
    const o = onlineOrders.find(x => x.id === id);
    if (o) { o.status = 'cancelled'; o.cancelled_by = 'seller'; o.cancelled_reason = reason; persistOnlineOrders(); }
    closeCancelModal();
    closeOrderModal();
    renderOrders(document.querySelector('.sub-nav-item.active').dataset.status);
    refreshNavNotifications();
    showToast('Order cancelled.', 'success');
    if (o) composeOrderEmail(o, 'declined');
  };

  window.__refreshOrders = async () => {
    onlineOrders = await fetchOnlineOrders();
    renderOrders(document.querySelector('.sub-nav-item.active').dataset.status);
  };

  filterTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      filterTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const searchRow = document.getElementById('cancelledSearchRow');
      if (searchRow) searchRow.style.display = tab.dataset.status === 'cancelled' ? 'block' : 'none';
      renderOrders(tab.dataset.status);
    });
  });

  const cancelledSearchInput = document.getElementById('cancelledSearch');
  if (cancelledSearchInput) {
    cancelledSearchInput.addEventListener('input', () => {
      if (document.querySelector('.sub-nav-item.active').dataset.status === 'cancelled') renderOrders('cancelled');
    });
  }
}

// ==========================================
// 6. PRICE AUTOMATION (rules only, no imported section)
// ==========================================
const rulesTableBody = document.getElementById('rulesTableBody');
if (rulesTableBody) {
  const opLabels = { greater: 'Greater than', less: 'Less than', equal: 'Equal to' };
  const fieldLabels = { stock: 'Stock', sales: 'Sales' };

  (async () => {
    await getRules();
    syncRulesToBackend();
    renderRules();
  })();

function ruleSign(r) { return (r && r.direction === 'subtract') ? '-' : '+'; }

  function renderRules() {
    const rules = _rulesCache || [];
    rulesTableBody.innerHTML = rules.length ? rules.map((r, i) => {
      const s = r.enabled ? '<span class="status-pill active">Live</span>' : '<span class="status-pill paused">Disabled</span>';
      const sign = ruleSign(r);
      const adj = r.adjustType === 'percent' ? sign + ' ' + esc(r.adjustValue) + '%' : sign + ' ₱' + esc(r.adjustValue);
      const trigger = esc((fieldLabels[r.field] || r.field) + ' ' + (opLabels[r.operator] || r.operator) + ' ' + r.value);
      return '<tr><td>' + (i + 1) + '</td><td><strong>Rule #' + (i + 1) + '</strong></td><td>' + trigger + '</td><td>' + adj + '</td><td>' + s + '</td><td style="text-align:center;white-space:nowrap;"><button class="btn-icon" onclick="editRule(' + r.id + ')" title="Edit">Edit</button><button class="btn-icon" onclick="toggleRule(' + r.id + ')" title="Toggle">' + (r.enabled ? 'Disable' : 'Enable') + '</button><button class="btn-icon danger" onclick="deleteRule(' + r.id + ')" title="Delete">X</button></td></tr>';
    }).join('') : '<tr><td colspan="6" style="text-align:center;color:#999;padding:30px 0;">There\'s nothing here.</td></tr>';
  }

  window.openAddRuleModal = () => {
    document.getElementById('ruleModalTitle').textContent = 'Add Rule';
    document.getElementById('editRuleId').value = '';
    document.getElementById('ruleField').value = 'stock';
    document.getElementById('ruleOperator').value = 'less';
    document.getElementById('ruleValue').value = '';
    document.getElementById('ruleAdjustValue').value = '';
    document.getElementById('ruleAdjustType').value = 'percent';
    document.getElementById('ruleDirection').value = 'add';
    document.getElementById('ruleModal').style.display = 'flex';
  };
  window.closeRuleModal = () => { document.getElementById('ruleModal').style.display = 'none'; };

window.saveRule = () => {
    const id = document.getElementById('editRuleId').value;
    const direction = document.getElementById('ruleDirection').value;
    const field = document.getElementById('ruleField').value;
    const operator = document.getElementById('ruleOperator').value;
    const value = parseInt(document.getElementById('ruleValue').value);
    const adjustValue = parseFloat(document.getElementById('ruleAdjustValue').value);
    const adjustType = document.getElementById('ruleAdjustType').value;
    const enabled = true;
    if (isNaN(value) || isNaN(adjustValue) || adjustValue <= 0) { showToast('Please fill all fields.', 'error'); return; }
    const isEdit = !!id;
    showConfirm(isEdit ? 'Save changes to this price rule?' : 'Create this price automation rule?', () => void (async () => {
      try {
        const rules = _rulesCache || [];
        if (id) { const r = rules.find(x => x.id === parseInt(id)); if (r) { r.direction = direction; r.field = field; r.operator = operator; r.value = value; r.adjustValue = adjustValue; r.adjustType = adjustType; r.enabled = enabled; } }
        else { const nid = rules.length > 0 ? Math.max(...rules.map(x => x.id)) + 1 : 1; rules.push({ id: nid, direction, field, operator, value, adjustValue, adjustType, enabled }); }
        saveRules(rules); await syncRulesToBackend(); renderRules(); closeRuleModal();
        showToast(isEdit ? 'Rule updated.' : 'Rule created.', 'success');
      } catch(e) { showToast('Failed to save rule: ' + (e.message || 'Unknown error'), 'error'); }
    })());
  };

  window.editRule = (id) => {
    const rules = _rulesCache || []; const r = rules.find(x => x.id === id); if (!r) return;
    document.getElementById('ruleModalTitle').textContent = 'Edit Rule';
    document.getElementById('editRuleId').value = r.id;
    document.getElementById('ruleField').value = r.field;
    document.getElementById('ruleOperator').value = r.operator;
    document.getElementById('ruleValue').value = r.value;
    document.getElementById('ruleAdjustValue').value = r.adjustValue;
    document.getElementById('ruleAdjustType').value = r.adjustType;
    document.getElementById('ruleDirection').value = r.direction || 'add';
    document.getElementById('ruleModal').style.display = 'flex';
  };

window.toggleRule = async (id) => {
    const rules = _rulesCache || []; const r = rules.find(x => x.id === id);
    if (r) { r.enabled = !r.enabled; saveRules(rules); await syncRulesToBackend(); renderRules(); showToast(r.enabled ? 'Rule enabled.' : 'Rule disabled.', 'success'); }
  };

  window.deleteRule = (id) => {
    showConfirm('Delete this rule permanently?', () => void (async () => {
      try {
        let rules = _rulesCache || [];
        rules = rules.filter(x => x.id !== id);
        saveRules(rules); await syncRulesToBackend(); renderRules();
        showToast('Rule deleted.', 'success');
      } catch(e) { showToast('Failed to delete rule: ' + (e.message || 'Unknown error'), 'error'); }
    })());
  };
}

// Global: refresh sidebar notification dots once the client is ready
setTimeout(function () { refreshNavNotifications(); }, 1600);
setTimeout(function () { refreshNavNotifications(); }, 4000);
setInterval(function () { refreshNavNotifications(); }, 12 * 60 * 1000);








