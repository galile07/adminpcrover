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
  if (!sbClient) { localStorage.setItem(table, JSON.stringify(rows)); return; }
  if (!rows.length) { try { const r = await sb(table).delete().neq('id', 0); if (r.error) throw r.error; } catch(e) {} return; }
  try {
    const r = await sb(table).upsert(rows, { onConflict: 'id' });
    if (r.error) throw r.error;
  } catch(e) {
    localStorage.setItem(table, JSON.stringify(rows));
  }
}
async function deleteAll(table) {
  if (!sbClient) { localStorage.setItem(table, '[]'); return; }
  try { const r = await sb(table).delete().neq('id', 0); if (r.error) throw r.error; }
  catch(e) { localStorage.setItem(table, '[]'); }
}

// ==========================================
// HELPERS: price rules cache
// ==========================================
let _rulesCache = null;
async function getRules() {
  if (_rulesCache) return _rulesCache;
  if (!sbClient) return JSON.parse(localStorage.getItem('autoRules') || '[]');
  const { data } = await sb('auto_rules').select('*').order('id');
  _rulesCache = data || [];
  return _rulesCache;
}
function saveRules(r) {
  _rulesCache = r;
  localStorage.setItem('autoRules', JSON.stringify(r));
}
async function syncRulesToBackend() {
  if (!sbClient) return;
  const r = await getRules();
  await sb('auto_rules').delete().neq('id', 0);
  if (r.length) await sb('auto_rules').insert(r);
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

// ==========================================
// HELPERS: currency / date
// ==========================================
const fmtCurrency = (a) => '₱' + a.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function getTodayStr() { return new Date().toISOString().split('T')[0]; }
function getMonthStart() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-01';
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

  async function loadAndRenderPOS() {
    await getRules();
    const inv = await fetchAll('inventory');
    const imp = await fetchAll('imported_products');
    const invCards = inv.filter(p => p.enabled).map(p => ({ name: p.name, price: p.price, source: 'inventory', dataId: p.id }));
    const impCards = imp.filter(p => p.enabled).map(p => ({ name: p.name, price: applyRulesToProduct(p), source: 'imported', dataId: p.id }));
    const all = [...invCards, ...impCards];
    posGrid.innerHTML = all.map(c =>
      '<div class="pos-item-card" data-name="' + c.name + '" data-price="' + c.price + '" data-source="' + c.source + '" data-id="' + c.dataId + '">' +
        '<div class="pos-item-img"></div>' +
        '<div class="pos-item-name">' + c.name + '</div>' +
        '<div class="pos-item-price">₱' + c.price.toLocaleString() + '</div>' +
      '</div>'
    ).join('');
    if (searchInput && searchInput.value.trim()) filterPOS();
  }

  function filterPOS() {
    const t = searchInput.value.trim().toLowerCase();
    document.querySelectorAll('.pos-item-card').forEach(c => {
      c.style.display = !t || c.dataset.name.toLowerCase().includes(t) ? '' : 'none';
    });
  }

  posGrid.addEventListener('click', (e) => {
    const card = e.target.closest('.pos-item-card');
    if (!card || card.style.display === 'none') return;
    const name = card.dataset.name, price = parseFloat(card.dataset.price);
    const source = card.dataset.source || 'inventory', dataId = parseInt(card.dataset.id);
    const key = source + '-' + dataId;
    const ex = cart.find(i => i._key === key);
    if (ex) ex.qty += 1;
    else cart.push({ _key: key, name, price, qty: 1, source, dataId });
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
      d.innerHTML = '<div class="pos-cart-item-details"><span class="pos-cart-item-name">' + item.name + '</span><span class="pos-cart-item-price">' + fmtCurrency(item.price) + '</span></div><div class="pos-cart-qty"><button class="pos-qty-btn" onclick="changeQty(' + i + ',-1)">-</button><span>' + item.qty + '</span><button class="pos-qty-btn" onclick="changeQty(' + i + ',1)">+</button></div>';
      cartList.appendChild(d);
    });
    _pendingTotal = sub;
    subtotalEl.innerText = fmtCurrency(sub);
    totalEl.innerText = fmtCurrency(sub);
    checkoutBtn.innerText = 'Pay Out ' + fmtCurrency(sub);
    checkoutBtn.onclick = () => {
      if (cart.length === 0) { alert('Cart is empty!'); return; }
      openCashModal(sub);
    };
  }

  window.changeQty = (i, d) => {
    cart[i].qty += d;
    if (cart[i].qty <= 0) cart.splice(i, 1);
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
    document.getElementById('cashConfirmBtn').onclick = async () => {
      const rec = parseFloat(document.getElementById('cashReceived').value) || 0;
      if (rec < total) { alert('Amount received is less than total.'); return; }
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
        date: getTodayStr()
      };
      if (!sbClient) {
        const s = JSON.parse(localStorage.getItem('posOrders') || '[]');
        s.unshift(order); localStorage.setItem('posOrders', JSON.stringify(s));
      } else {
        await sb('pos_orders').insert(order);
      }
      alert('Transaction Completed!\nTotal: ' + fmtCurrency(total) + '\nCash: ' + fmtCurrency(rec) + '\nChange: ' + fmtCurrency(rec - total));
      closeCashModal();
      cart = [];
      updateCartUI();
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
    if (!sbClient || !sbClient.functions) {
      posOrders = JSON.parse(localStorage.getItem('posOrders') || '[]');
      const stored = JSON.parse(localStorage.getItem('onlineOrders') || '[]');
      onlineOrdersList = stored.filter(o => String(o.status).toLowerCase() !== 'pending').map(o => ({ id: o.code || o.id, customer: o.customer, type: 'Online', amount: o.amount, status: o.status, date: o.date }));
      pendingCount = stored.filter(o => o.status === 'pending' || o.status === 'Pending').length;
    } else {
      const { data: p } = await sb('pos_orders').select('*').order('date', { ascending: false });
      posOrders = p || [];
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
        const stored = JSON.parse(localStorage.getItem('onlineOrders') || '[]');
        pendingCount = stored.filter(o => o.status === 'pending' || o.status === 'Pending').length;
        onlineOrdersList = stored.filter(o => String(o.status).toLowerCase() !== 'pending').map(o => ({ id: o.code || o.id, customer: o.customer, type: 'Online', amount: o.amount, status: o.status, date: o.date }));
      }
    }

    const recentOrders = [...posOrders.map(o => ({ ...o, type: o.type || 'Walk-in' })), ...onlineOrdersList];

    const invProducts = await fetchAll('inventory');
    const lowStockItems = invProducts.filter(p => p.enabled && p.stock <= (p.threshold || 5));

    // Daily sales: filter today
    const today = getTodayStr();
    const todayOrders = recentOrders.filter(o => o.date === today);
    const dailySales = todayOrders.reduce((s, o) => s + o.amount, 0);

    // Monthly sales: filter this month
    const monthStart = getMonthStart();
    const monthOrders = recentOrders.filter(o => o.date >= monthStart);
    const monthlySales = monthOrders.reduce((s, o) => s + o.amount, 0);

    recentOrdersBody.innerHTML = recentOrders.length
      ? recentOrders.slice(0, 20).map(o => '<tr><td>' + o.date + '</td><td>#' + (o.id || '') + '</td><td>' + (o.customer || '-') + '</td><td>' + (o.type || '') + ' · ' + (o.status || '') + '</td><td>' + fmtCurrency(o.amount) + '</td></tr>').join('')
      : '<tr><td colspan="5" style="text-align:center;color:#999;">No orders yet</td></tr>';

    recentOrdersCountEl.innerText = recentOrders.length;
    ordersToAcceptCountEl.innerText = pendingCount;
    ordersToAcceptMetaEl.innerText = pendingCount + ' pending confirmations';
    lowStockCountEl.innerText = lowStockItems.length;
    lowStockMetaEl.innerText = lowStockItems.length > 0 ? lowStockItems.map(p => p.name).join(', ') : 'All products well stocked';
    dailySalesValueEl.innerText = fmtCurrency(dailySales);
    monthlySalesValueEl.innerText = fmtCurrency(monthlySales);
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
    document.querySelectorAll('.sub-nav-item').forEach(b => b.classList.toggle('active', b.dataset.source === source));
    renderInv();
  };

  async function renderInv() {
    const inv = await fetchInv();
    const imp = await fetchAll('imported_products');
    const fmt = (a) => '₱' + a.toLocaleString('en-US', { minimumFractionDigits: 2 });
    let all = [...inv.map(p => ({ ...p, _src: 'inventory' })), ...imp.map(p => ({ ...p, _src: 'imported' }))];
    if (_invSource !== 'all') all = all.filter(p => p._src === _invSource);

    inventoryTableBody.innerHTML = all.map(p => {
      let toggleHtml;
      if (p._src === 'imported') {
        toggleHtml = '<button class="btn-toggle ' + (p.enabled ? 'active' : 'inactive') + '" onclick="toggleImportProduct(' + p.id + ')">' + (p.enabled ? 'Active' : 'Disabled') + '</button>';
      } else {
        toggleHtml = '<button class="btn-toggle ' + (p.enabled ? 'active' : 'inactive') + '" onclick="toggleProduct(' + p.id + ')">' + (p.enabled ? 'Active' : 'Disabled') + '</button>';
      }
      const imgHtml = p.image
        ? '<img src="' + p.image + '" class="inv-thumb" alt="' + p.name + '">'
        : '<div class="inv-thumb" style="background:#f5f5f5;display:flex;align-items:center;justify-content:center;"></div>';
      return '<tr>' +
        '<td>' + imgHtml + '</td>' +
        '<td><strong>' + p.name + '</strong>' + (p._src === 'imported' ? ' <span style="font-size:11px;color:#999;">(imported)</span>' : '') + '</td>' +
        '<td>' + fmt(p.price) + '</td>' +
        '<td>' + p.stock + '</td>' +
        '<td>' + (p.enabled ? '<span class="status-pill active">In Stock</span>' : '<span class="status-pill paused">Disabled</span>') + '</td>' +
        '<td style="white-space:nowrap;text-align:center;">' +
          (p._src === 'imported'
            ? '<button class="btn-icon" onclick="editImportProduct(' + p.id + ')" title="Edit">Edit</button>'
            : '<button class="btn-icon" onclick="editProduct(' + p.id + ')" title="Edit">Edit</button>') +
          toggleHtml +
        '</td>' +
      '</tr>';
    }).join('');
  }

  window.toggleProduct = async (id) => {
    const p = await fetchInv();
    const r = p.find(x => x.id === id);
    if (r) { r.enabled = !r.enabled; await saveInv(p); renderInv(); }
  };

  window.deleteProduct = async () => {
    const id = document.getElementById('editProductId').value;
    if (!id) return;
    if (!confirm('Delete this product permanently?')) return;
    let products = await fetchInv();
    products = products.filter(p => p.id !== parseInt(id));
    await saveInv(products);
    renderInv();
    closeProductModal();
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
  window.saveProduct = async () => {
    const id = document.getElementById('editProductId').value;
    const name = document.getElementById('productName').value.trim();
    const description = document.getElementById('productDescription').value.trim();
    const price = parseFloat(document.getElementById('productPrice').value);
    const stock = parseInt(document.getElementById('productStock').value);
    const threshold = parseInt(document.getElementById('productThreshold').value);
    const enabled = document.getElementById('productEnabled').value === 'checked';
    const preview = document.getElementById('imagePreview');
    const imgSrc = preview.querySelector('img') ? preview.querySelector('img').src : '';
    if (!name || isNaN(price) || isNaN(stock) || isNaN(threshold)) { alert('Please fill all fields.'); return; }
    const products = await fetchInv();
    if (id) {
      const p = products.find(x => x.id === parseInt(id));
      if (p) { p.name = name; p.description = description; p.price = price; p.stock = stock; p.threshold = threshold; p.enabled = enabled; if (imgSrc) p.image = imgSrc; }
    } else {
      const newId = products.length > 0 ? Math.max(...products.map(x => x.id)) + 1 : 1;
      products.push({ id: newId, name, description, price, stock, threshold, enabled, image: imgSrc });
    }
    await saveInv(products);
    renderInv();
    closeProductModal();
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
    if (typeof XLSX === 'undefined') { alert('Excel library failed to load.'); return; }
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json(sheet, { header: 1 });
        if (json.length < 2) { alert('Excel file has no data rows.'); return; }
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
          products.push({ id: nextId++, name, price, stock, threshold: 5, enabled: true, image: '' });
          existingNames.add(name.toLowerCase());
          count++;
        }
        await upsertAll('imported_products', products);
        renderInv();
        const msg = 'Imported ' + count + ' product' + (count !== 1 ? 's' : '') + '.';
        alert(skipped ? msg + ' (' + skipped + ' duplicate' + (skipped > 1 ? 's' : '') + ' skipped)' : msg);
      } catch (err) { alert('Error reading file: ' + err.message); }
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
  window.saveImportProduct = async () => {
    const id = document.getElementById('editImportProductId').value;
    const name = document.getElementById('importProductName').value.trim();
    const description = document.getElementById('importProductDescription').value.trim();
    const price = parseFloat(document.getElementById('importProductPrice').value);
    const stock = parseInt(document.getElementById('importProductStock').value);
    const enabled = document.getElementById('importProductEnabled').value === 'checked';
    if (!name || isNaN(price) || isNaN(stock)) { alert('Please fill all fields.'); return; }
    const products = await fetchAll('imported_products');
    if (id) { const p = products.find(x => x.id === parseInt(id));       if (p) { p.name = name; p.description = description; p.price = price; p.stock = stock; p.enabled = enabled; } }
    await upsertAll('imported_products', products);
    renderInv();
    closeImportProductModal();
  };
  window.toggleImportProduct = async (id) => {
    const products = await fetchAll('imported_products');
    const p = products.find(x => x.id === id);
    if (p) { p.enabled = !p.enabled; await upsertAll('imported_products', products); renderInv(); }
  };

  renderInv();
}

// Auto-seed inventory if empty
setTimeout(async () => {
  try {
    let items = await fetchAll('inventory');
    if (items && items.length === 0) {
      const d = [
        { name: 'Wireless Mouse', price: 750, stock: 18, threshold: 6, description: 'Reliable wireless mouse with ergonomic design, perfect for daily office use.' },
        { name: 'Gaming Chair', price: 12500, stock: 4, threshold: 2, description: 'High-back ergonomic gaming chair with lumbar support and adjustable armrests.' },
        { name: 'Monitor Arm', price: 2200, stock: 9, threshold: 4, description: 'Adjustable gas-spring monitor arm for a cleaner, more ergonomic desk setup.' },
        { name: 'RGB Strip', price: 550, stock: 40, threshold: 10, description: 'Colorful RGB LED strip with remote control, ideal for gaming ambiance.' },
        { name: 'External HDD 2TB', price: 2800, stock: 11, threshold: 4, description: 'Portable 2TB external hard drive for backups and extra storage on the go.' },
        { name: 'Mechanical Numpad', price: 950, stock: 14, threshold: 5, description: 'Compact mechanical numeric keypad with blue switches for fast data entry.' },
        { name: 'USB Microphone', price: 3200, stock: 7, threshold: 3, description: 'Plug-and-play condenser microphone with crystal-clear audio for streaming.' },
        { name: 'LED Desk Lamp', price: 1100, stock: 16, threshold: 5, description: 'Touch-controlled LED desk lamp with adjustable brightness and color temperature.' },
        { name: 'Cable Mgmt Kit', price: 350, stock: 35, threshold: 10, description: 'Complete cable management kit with clips, sleeves, and ties for a tidy workspace.' },
        { name: 'Cooling Pad', price: 1500, stock: 10, threshold: 4, description: 'Laptop cooling pad with dual silent fans to prevent overheating during long sessions.' },
        { name: 'Wireless Charger', price: 680, stock: 22, threshold: 8, description: 'Fast wireless charging pad compatible with all Qi-enabled devices.' },
        { name: 'Stream Deck', price: 5900, stock: 5, threshold: 2, description: 'Customizable macro keypad for streamers and content creators to control scenes and apps.' }
      ];
      for (let item of d) {
        items.push({id: items.length + 1, ...item, enabled: true, image: ''});
      }
      await upsertAll('inventory', items);
      if (document.getElementById('inventoryTableBody')) renderInv();
      if (document.querySelector('.pos-grid')) loadAndRenderPOS();
    }
  } catch (e) { console.warn('Seed failed:', e); }
}, 500);

// Auto-seed imported products if empty
setTimeout(async () => {
  try {
    let imp = await fetchAll('imported_products');
    if (imp && imp.length === 0) {
      const d = [
        { name: 'Ergonomic Keyboard', price: 3200, stock: 8, description: 'Split ergonomic keyboard with mechanical switches for comfortable typing.' },
        { name: 'Portable Monitor 15.6"', price: 7200, stock: 5, description: 'USB-C portable monitor perfect for dual-screen setups on the go.' },
        { name: 'Desk Mount Dual Arm', price: 3800, stock: 6, description: 'Heavy-duty dual monitor desk mount with gas spring adjustment.' },
        { name: 'Noise Canceling Earbuds', price: 4600, stock: 12, description: 'True wireless earbuds with active noise canceling and 24h battery.' }
      ];
      for (let item of d) {
        imp.push({ id: imp.length + 1, ...item, threshold: 5, enabled: true, image: '' });
      }
      await upsertAll('imported_products', imp);
      if (document.getElementById('inventoryTableBody')) renderInv();
    }
  } catch (e) { console.warn('Imported seed failed:', e); }
}, 600);
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

  async function callOrdersFn(action, order_id) {
    if (!sbClient || !sbClient.functions) return false;
    try {
      const { error } = await sbClient.functions.invoke('admin-orders', {
        method: action ? 'POST' : 'GET',
        body: action ? { action, order_id } : undefined
      });
      if (error) throw error;
      return true;
    } catch (e) { console.warn('admin-orders call failed:', e); return false; }
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
      const mapped = orders.map(o => ({
        id: o.id, code: String(o.id || '').toUpperCase().slice(0, 8),
        customer: pickName(o.customer_name) || 'Customer', address: o.address || '',
        phone: o.phone || '', email: o.email || '',
        amount: o.total || 0,
        status: String(o.status || 'pending').toLowerCase(),
        date: (o.created_at || getTodayStr()).slice(0, 10), time: '12:00 PM',
        items: parseOrderItems(o.items)
      }));
      if (mapped.length) localStorage.setItem('onlineOrders', JSON.stringify(mapped));
      else localStorage.removeItem('onlineOrders');
      return mapped;
    } catch (e) { return local; }
  }

  (async () => {
    onlineOrders = await fetchOnlineOrders();
    renderOrders('pending');
  })();

  function renderOrders(filterStatus) {
    const filtered = onlineOrders.filter(o => o.status === filterStatus).sort((a, b) => new Date(a.date + ' ' + a.time) - new Date(b.date + ' ' + b.time));
    ordersContainer.innerHTML = filtered.map(order => '<div class="order-card"><div class="order-card-top"><div><span class="order-id">#' + (order.code || order.id) + '</span><span class="order-time">' + order.date + ' ' + order.time + '</span></div><button class="btn-view" onclick="viewOrder(\'' + order.id + '\')">View</button></div><div class="order-card-body"><div class="order-customer">' + order.customer + '</div><div class="order-address">' + order.address + '</div></div></div>').join('');
  }

  window.viewOrder = (id) => {
    const order = onlineOrders.find(o => o.id === id);
    if (!order) return;
    const modal = document.getElementById('orderModal'), body = document.getElementById('modalBody'), footer = document.getElementById('modalFooter');
    const itemsHtml = order.items.map(item => '<tr><td>' + item.name + '</td><td>' + item.qty + '</td><td>' + fmtCurrency(item.price) + '</td><td>' + fmtCurrency(item.qty * item.price) + '</td></tr>').join('');
    body.innerHTML = '<div class="modal-info-row"><span class="modal-label">Order Code</span><span>#' + (order.code || order.id) + '</span></div><div class="modal-info-row"><span class="modal-label">Date & Time</span><span>' + order.date + ' ' + order.time + '</span></div><div class="modal-info-row"><span class="modal-label">Customer</span><span>' + order.customer + '</span></div><div class="modal-info-row"><span class="modal-label">Address</span><span>' + order.address + '</span></div><div class="modal-info-row"><span class="modal-label">Phone</span><span>' + order.phone + '</span></div><div class="modal-info-row"><span class="modal-label">Email</span><span>' + order.email + '</span></div><h4 style="margin:16px 0 8px;color:var(--pc-blue);">Products Ordered</h4><table class="modal-items-table"><thead><tr><th>Item</th><th>Qty</th><th>Price</th><th>Subtotal</th></tr></thead><tbody>' + itemsHtml + '</tbody><tfoot><tr><td colspan="3"><strong>Total Amount</strong></td><td><strong>' + fmtCurrency(order.amount) + '</strong></td></tr></tfoot></table>';
    if (order.status === 'pending') footer.innerHTML = '<button class="btn btn-decline" onclick="declineOrder(\'' + order.id + '\')">Decline</button><button class="btn btn-primary" onclick="acceptOrder(\'' + order.id + '\')">Accept</button>';
    else if (order.status === 'shipped') footer.innerHTML = '<button class="btn btn-secondary" onclick="closeOrderModal()" style="color:#555;border:1px solid #ccc;background:transparent;padding:10px 24px;border-radius:6px;font-size:14px;font-weight:600;cursor:pointer;">Close</button><button class="btn btn-primary" onclick="deliverOrder(\'' + order.id + '\')">Mark as to be deliver</button>';
    else if (order.status === 'delivered') footer.innerHTML = '<button class="btn btn-secondary" onclick="closeOrderModal()" style="color:#555;border:1px solid #ccc;background:transparent;padding:10px 24px;border-radius:6px;font-size:14px;font-weight:600;cursor:pointer;">Close</button><button class="btn btn-primary" onclick="finishOrder(\'' + order.id + '\')">Order Finished</button>';
    modal.style.display = 'flex';
  };

  window.closeOrderModal = () => { document.getElementById('orderModal').style.display = 'none'; };
  window.acceptOrder = async (id) => {
    await callOrdersFn('accept', id);
    const o = onlineOrders.find(x => x.id === id);
    if (o) { o.status = 'shipped'; persistOnlineOrders(); }
    renderOrders(document.querySelector('.sub-nav-item.active').dataset.status);
    closeOrderModal();
  };
  window.declineOrder = async (id) => {
    await callOrdersFn('decline', id);
    const idx = onlineOrders.findIndex(o => o.id === id);
    if (idx !== -1) { onlineOrders.splice(idx, 1); persistOnlineOrders(); }
    renderOrders(document.querySelector('.sub-nav-item.active').dataset.status);
    closeOrderModal();
  };
  window.deliverOrder = async (id) => {
    await callOrdersFn('deliver', id);
    const o = onlineOrders.find(x => x.id === id);
    if (o) { o.status = 'delivered'; persistOnlineOrders(); }
    renderOrders(document.querySelector('.sub-nav-item.active').dataset.status);
    closeOrderModal();
  };
  window.finishOrder = async (id) => {
    await callOrdersFn('finish', id);
    const idx = onlineOrders.findIndex(o => o.id === id);
    if (idx !== -1) {
      const order = onlineOrders[idx];
      const c = JSON.parse(localStorage.getItem('completedOrders') || '[]');
      c.unshift({ id: order.id, customer: order.customer, type: 'Online', amount: order.amount, status: 'Completed', date: getTodayStr() });
      localStorage.setItem('completedOrders', JSON.stringify(c));
      onlineOrders.splice(idx, 1);
      persistOnlineOrders();
    }
    renderOrders(document.querySelector('.sub-nav-item.active').dataset.status);
    closeOrderModal();
  };

  filterTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      filterTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      renderOrders(tab.dataset.status);
    });
  });
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
    renderRules();
  })();

  function ruleSign(r) { return r.direction === 'subtract' ? 'âˆ’' : '+'; }

  function renderRules() {
    const rules = _rulesCache || [];
    rulesTableBody.innerHTML = rules.map((r, i) => {
      const s = r.enabled ? '<span class="status-pill active">Live</span>' : '<span class="status-pill paused">Disabled</span>';
      const sign = ruleSign(r);
      const adj = r.adjustType === 'percent' ? sign + ' ' + r.adjustValue + '%' : sign + ' ₱' + r.adjustValue;
      return '<tr><td>' + (i + 1) + '</td><td><strong>Rule #' + (i + 1) + '</strong></td><td>' + fieldLabels[r.field] + ' ' + opLabels[r.operator] + ' ' + r.value + '</td><td>' + adj + '</td><td>' + s + '</td><td style="text-align:center;white-space:nowrap;"><button class="btn-icon" onclick="editRule(' + r.id + ')" title="Edit">Edit</button><button class="btn-icon" onclick="toggleRule(' + r.id + ')" title="Toggle">' + (r.enabled ? 'Active' : 'On') + '</button><button class="btn-icon danger" onclick="deleteRule(' + r.id + ')" title="Delete">X</button></td></tr>';
    }).join('');
  }

  window.openAddRuleModal = () => {
    document.getElementById('ruleModalTitle').textContent = 'Add Rule';
    document.getElementById('editRuleId').value = '';
    document.getElementById('ruleDirection').value = 'add';
    document.getElementById('ruleField').value = 'stock';
    document.getElementById('ruleOperator').value = 'less';
    document.getElementById('ruleValue').value = '';
    document.getElementById('ruleAdjustValue').value = '';
    document.getElementById('ruleAdjustType').value = 'percent';
    document.getElementById('ruleEnabled').checked = true;
    document.getElementById('ruleModal').style.display = 'flex';
  };
  window.closeRuleModal = () => { document.getElementById('ruleModal').style.display = 'none'; };

  window.saveRule = async () => {
    const id = document.getElementById('editRuleId').value;
    const direction = document.getElementById('ruleDirection').value;
    const field = document.getElementById('ruleField').value;
    const operator = document.getElementById('ruleOperator').value;
    const value = parseInt(document.getElementById('ruleValue').value);
    const adjustValue = parseFloat(document.getElementById('ruleAdjustValue').value);
    const adjustType = document.getElementById('ruleAdjustType').value;
    const enabled = document.getElementById('ruleEnabled').checked;
    if (isNaN(value) || isNaN(adjustValue) || adjustValue <= 0) { alert('Please fill all fields.'); return; }
    const rules = _rulesCache || [];
    if (id) { const r = rules.find(x => x.id === parseInt(id)); if (r) { r.direction = direction; r.field = field; r.operator = operator; r.value = value; r.adjustValue = adjustValue; r.adjustType = adjustType; r.enabled = enabled; } }
    else { const nid = rules.length > 0 ? Math.max(...rules.map(x => x.id)) + 1 : 1; rules.push({ id: nid, direction, field, operator, value, adjustValue, adjustType, enabled }); }
    saveRules(rules); await syncRulesToBackend(); renderRules(); closeRuleModal();
  };

  window.editRule = (id) => {
    const rules = _rulesCache || []; const r = rules.find(x => x.id === id); if (!r) return;
    document.getElementById('ruleModalTitle').textContent = 'Edit Rule';
    document.getElementById('editRuleId').value = r.id;
    document.getElementById('ruleDirection').value = r.direction || 'add';
    document.getElementById('ruleField').value = r.field;
    document.getElementById('ruleOperator').value = r.operator;
    document.getElementById('ruleValue').value = r.value;
    document.getElementById('ruleAdjustValue').value = r.adjustValue;
    document.getElementById('ruleAdjustType').value = r.adjustType;
    document.getElementById('ruleEnabled').checked = r.enabled;
    document.getElementById('ruleModal').style.display = 'flex';
  };

  window.toggleRule = async (id) => {
    const rules = _rulesCache || []; const r = rules.find(x => x.id === id);
    if (r) { r.enabled = !r.enabled; saveRules(rules); await syncRulesToBackend(); renderRules(); }
  };

  window.deleteRule = async (id) => {
    let rules = _rulesCache || [];
    rules = rules.filter(x => x.id !== id);
    saveRules(rules); await syncRulesToBackend(); renderRules();
  };
}








