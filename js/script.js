// ==========================================
// SUPABASE CLIENT INIT (with fallback)
// ==========================================
const SUPABASE_URL = 'https://bpleimrxzigbhpofavec.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwbGVpbXJ4emlnYmhwb2ZhdmVjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM3Njg5NjIsImV4cCI6MjA5OTM0NDk2Mn0.bElPIF6WLAqWUD9WQLea8pMsPeO3IZr4K-1kjeim5Gw';

let sbClient = null;
try {
  if (typeof window.supabase !== 'undefined' && window.supabase && window.supabase.createClient) {
    sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
} catch (e) { console.warn('Supabase init failed, using localStorage fallback:', e); }

function sb(table) { return sbClient ? sbClient.from(table) : null; }
setTimeout(() => {
  if (!sbClient && typeof window.supabase !== 'undefined' && window.supabase && window.supabase.createClient) {
    try { sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY); } catch (e) {}
  }
}, 1500);

// ==========================================
// HELPERS: backend / localStorage
// ==========================================
async function fetchAll(table) {
  if (!sbClient) return JSON.parse(localStorage.getItem(table) || '[]');
  const { data } = await sb(table).select('*').order('id');
  return data || [];
}
async function upsertAll(table, rows) {
  if (!sbClient) { localStorage.setItem(table, JSON.stringify(rows)); return; }
  if (!rows.length) { await sb(table).delete().neq('id', 0); return; }
  await sb(table).upsert(rows, { onConflict: 'id' });
}
async function deleteAll(table) {
  if (!sbClient) { localStorage.setItem(table, '[]'); return; }
  await sb(table).delete().neq('id', 0);
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

  const emojis = {
    'Mechanical Keyboard': '⌨️', 'Gaming Mouse': '🖱️', '27" Monitor': '🖥️',
    'Laptop Stand': '💻', 'Gaming Headset': '🎧', 'Webcam HD': '📷',
    'Bluetooth Speaker': '🔊', 'SSD 1TB': '💾', 'USB-C Hub': '🧮',
    'Printer': '🖨️', 'Mouse Pad': '📦', 'Extension Cord': '🔌'
  };

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
        '<div class="pos-item-img">' + (emojis[c.name] || '📦') + '</div>' +
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
    let posOrders = [], completedOrders = [];
    if (!sbClient) {
      posOrders = JSON.parse(localStorage.getItem('posOrders') || '[]');
      completedOrders = JSON.parse(localStorage.getItem('completedOrders') || '[]');
    } else {
      const { data: p } = await sb('pos_orders').select('*').order('date', { ascending: false });
      const { data: c } = await sb('online_orders').select('*').eq('status', 'Completed').order('date', { ascending: false });
      posOrders = p || [];
      completedOrders = (c || []).map(o => ({ id: o.id, customer: o.customer, type: 'Online', amount: o.amount, status: 'Completed', date: o.date }));
    }

    // pending count from persisted onlineOrders
    let pendingCount = 0;
    if (!sbClient) {
      const stored = JSON.parse(localStorage.getItem('onlineOrders') || '[]');
      pendingCount = stored.filter(o => o.status === 'pending' || o.status === 'Pending').length;
    } else {
      const { data: pend } = await sb('online_orders').select('*').eq('status', 'Pending');
      pendingCount = (pend || []).length;
    }
    // if no real data, show 2 demo pending (but only if not already accepted)
    if (pendingCount === 0) pendingCount = 2;

    const recentOrders = [...posOrders, ...completedOrders];

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
      ? recentOrders.slice(0, 20).map(o => '<tr><td>' + o.date + '</td><td>' + o.id + '</td><td>' + fmtCurrency(o.amount) + '</td></tr>').join('')
      : '<tr><td colspan="3" style="text-align:center;color:#999;">No orders yet</td></tr>';

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

  async function renderInv() {
    const inv = await fetchInv();
    const imp = await fetchAll('imported_products');
    const fmt = (a) => '₱' + a.toLocaleString('en-US', { minimumFractionDigits: 2 });
    const all = [...inv.map(p => ({ ...p, _src: 'inventory' })), ...imp.map(p => ({ ...p, _src: 'imported' }))];

    inventoryTableBody.innerHTML = all.map(p => {
      let toggleHtml;
      if (p._src === 'imported') {
        toggleHtml = '<button class="btn-toggle ' + (p.enabled ? 'active' : 'inactive') + '" onclick="toggleImportProduct(' + p.id + ')">' + (p.enabled ? 'Active' : 'Disabled') + '</button>';
      } else {
        toggleHtml = '<button class="btn-toggle ' + (p.enabled ? 'active' : 'inactive') + '" onclick="toggleProduct(' + p.id + ')">' + (p.enabled ? 'Active' : 'Disabled') + '</button>';
      }
      const imgHtml = p.image
        ? '<img src="' + p.image + '" class="inv-thumb" alt="' + p.name + '">'
        : '<div class="inv-thumb" style="background:#f5f5f5;display:flex;align-items:center;justify-content:center;color:#ccc;font-size:16px;">📷</div>';
      return '<tr>' +
        '<td>' + imgHtml + '</td>' +
        '<td><strong>' + p.name + '</strong>' + (p._src === 'imported' ? ' <span style="font-size:11px;color:#999;">(imported)</span>' : '') + '</td>' +
        '<td>' + fmt(p.price) + '</td>' +
        '<td>' + p.stock + '</td>' +
        '<td>' + (p.enabled ? '<span class="status-pill active">In Stock</span>' : '<span class="status-pill paused">Disabled</span>') + '</td>' +
        '<td style="white-space:nowrap;text-align:center;">' +
          (p._src === 'imported'
            ? '<button class="btn-icon" onclick="editImportProduct(' + p.id + ')" title="Edit">✏️</button>'
            : '<button class="btn-icon" onclick="editProduct(' + p.id + ')" title="Edit">✏️</button>') +
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

  window.openAddProductModal = () => {
    document.getElementById('productModalTitle').textContent = 'Add Product';
    document.getElementById('editProductId').value = '';
    document.getElementById('productName').value = '';
    document.getElementById('productPrice').value = '';
    document.getElementById('productStock').value = '';
    document.getElementById('productThreshold').value = '5';
    document.getElementById('productEnabled').checked = true;
    document.getElementById('productImage').value = '';
    document.getElementById('imagePreview').style.display = 'none';
    document.getElementById('imagePreview').innerHTML = '';
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
    const price = parseFloat(document.getElementById('productPrice').value);
    const stock = parseInt(document.getElementById('productStock').value);
    const threshold = parseInt(document.getElementById('productThreshold').value);
    const enabled = document.getElementById('productEnabled').checked;
    const preview = document.getElementById('imagePreview');
    const imgSrc = preview.querySelector('img') ? preview.querySelector('img').src : '';
    if (!name || isNaN(price) || isNaN(stock) || isNaN(threshold)) { alert('Please fill all fields.'); return; }
    const products = await fetchInv();
    if (id) {
      const p = products.find(x => x.id === parseInt(id));
      if (p) { p.name = name; p.price = price; p.stock = stock; p.threshold = threshold; p.enabled = enabled; if (imgSrc) p.image = imgSrc; }
    } else {
      const newId = products.length > 0 ? Math.max(...products.map(x => x.id)) + 1 : 1;
      products.push({ id: newId, name, price, stock, threshold, enabled, image: imgSrc });
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
    document.getElementById('productPrice').value = p.price;
    document.getElementById('productStock').value = p.stock;
    document.getElementById('productThreshold').value = p.threshold || 5;
    document.getElementById('productEnabled').checked = p.enabled;
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
        const products = await fetchInv();
        let nextId = products.length > 0 ? Math.max(...products.map(x => x.id)) + 1 : 1;
        let count = 0;
        for (let i = 1; i < json.length; i++) {
          const row = json[i];
          if (!row || row.length === 0) continue;
          const name = ni >= 0 ? String(row[ni] || '').trim() : (String(row[0] || '').trim());
          const price = parseFloat(pi >= 0 ? row[pi] : row[1]) || 0;
          const stock = parseInt(si >= 0 ? row[si] : row[2]) || 0;
          if (name) { products.push({ id: nextId++, name, price, stock, threshold: 5, enabled: true, image: '' }); count++; }
        }
        await saveInv(products);
        renderInv();
        alert('Imported ' + count + ' products.');
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
    document.getElementById('importProductPrice').value = p.price;
    document.getElementById('importProductStock').value = p.stock;
    document.getElementById('importProductEnabled').checked = p.enabled;
    document.getElementById('importProductModal').style.display = 'flex';
  };
  window.closeImportProductModal = () => { document.getElementById('importProductModal').style.display = 'none'; };
  window.saveImportProduct = async () => {
    const id = document.getElementById('editImportProductId').value;
    const name = document.getElementById('importProductName').value.trim();
    const price = parseFloat(document.getElementById('importProductPrice').value);
    const stock = parseInt(document.getElementById('importProductStock').value);
    const enabled = document.getElementById('importProductEnabled').checked;
    if (!name || isNaN(price) || isNaN(stock)) { alert('Please fill all fields.'); return; }
    const products = await fetchAll('imported_products');
    if (id) { const p = products.find(x => x.id === parseInt(id)); if (p) { p.name = name; p.price = price; p.stock = stock; p.enabled = enabled; } }
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

// ==========================================
// 5. ONLINE ORDERS
// ==========================================
const ordersContainer = document.getElementById('ordersContainer');
const filterTabs = document.querySelectorAll('.sub-nav-item');

if (ordersContainer && filterTabs.length > 0) {
  let onlineOrders = [];

  function persistOnlineOrders() {
    if (!sbClient) {
      localStorage.setItem('onlineOrders', JSON.stringify(onlineOrders));
    } else {
      // upsert all online orders back to supabase
      onlineOrders.forEach(o => {
        const statusMap = { pending: 'Pending', shipped: 'Shipped', delivered: 'Delivered' };
        sb('online_orders').upsert({
          id: o.id, customer: o.customer, amount: o.amount,
          status: statusMap[o.status] || o.status,
          date: o.date, items: o.items.map(i => i.name).join(', '),
          address: o.address, contact: o.phone
        }, { onConflict: 'id' });
      });
    }
  }

  (async () => {
    if (!sbClient) {
      onlineOrders = JSON.parse(localStorage.getItem('onlineOrders') || '[]');
    } else {
      const { data } = await sb('online_orders').select('*').order('date', { ascending: false });
      onlineOrders = (data || []).map(o => ({
        id: o.id, customer: o.customer, address: o.address || '',
        phone: o.contact || '', email: '',
        amount: o.amount, status: o.status === 'Completed' ? 'delivered' : o.status.toLowerCase(),
        date: o.date, time: '12:00 PM',
        items: (o.items || '').split(',').filter(Boolean).map(i => ({ name: i.trim(), qty: 1, price: 0 }))
      }));
    }
    if (!onlineOrders.length) onlineOrders = getDefaultOrders();
    persistOnlineOrders();
    renderOrders('pending');
  })();

  function getDefaultOrders() {
    return [
      { id: '#2001', customer: 'Arielle M.', address: '123 Rizal St, Baliuag, Bulacan', phone: '0917-123-4567', email: 'arielle.m@email.com', amount: 5420, status: 'pending', date: '2026-07-06', time: '08:30 AM', items: [{ name: 'Mechanical Keyboard', qty: 1, price: 2350 }, { name: 'Gaming Mouse', qty: 2, price: 1535 }] },
      { id: '#2002', customer: 'Nina R.', address: '456 Mabini Ave, Malolos, Bulacan', phone: '0928-234-5678', email: 'nina.r@email.com', amount: 1850, status: 'pending', date: '2026-07-06', time: '09:15 AM', items: [{ name: 'USB-C Hub', qty: 1, price: 850 }, { name: 'Mouse Pad', qty: 2, price: 500 }] },
      { id: '#2003', customer: 'Ben T.', address: '789 Del Pilar St, Baliuag, Bulacan', phone: '0939-345-6789', email: 'ben.t@email.com', amount: 2480, status: 'shipped', date: '2026-07-05', time: '10:00 AM', items: [{ name: 'Webcam HD', qty: 1, price: 1800 }, { name: 'Microphone', qty: 1, price: 680 }] },
      { id: '#2004', customer: 'Rina C.', address: '321 Luna St, Plaridel, Bulacan', phone: '0940-456-7890', email: 'rina.c@email.com', amount: 3210, status: 'shipped', date: '2026-07-04', time: '02:30 PM', items: [{ name: '27" Monitor', qty: 1, price: 3210 }] },
      { id: '#2005', customer: 'Mark D.', address: '654 Bonifacio St, Baliuag, Bulacan', phone: '0951-567-8901', email: 'mark.d@email.com', amount: 1320, status: 'delivered', date: '2026-07-03', time: '11:00 AM', items: [{ name: 'Wireless Mouse', qty: 1, price: 750 }, { name: 'Headset Stand', qty: 1, price: 570 }] }
    ];
  }

  function renderOrders(filterStatus) {
    const filtered = onlineOrders.filter(o => o.status === filterStatus).sort((a, b) => new Date(a.date + ' ' + a.time) - new Date(b.date + ' ' + b.time));
    ordersContainer.innerHTML = filtered.map(order => '<div class="order-card"><div class="order-card-top"><div><span class="order-id">' + order.id + '</span><span class="order-time">' + order.date + ' ' + order.time + '</span></div><button class="btn-view" onclick="viewOrder(\'' + order.id + '\')">View</button></div><div class="order-card-body"><div class="order-customer">' + order.customer + '</div><div class="order-address">' + order.address + '</div></div></div>').join('');
  }

  window.viewOrder = (id) => {
    const order = onlineOrders.find(o => o.id === id);
    if (!order) return;
    const modal = document.getElementById('orderModal'), body = document.getElementById('modalBody'), footer = document.getElementById('modalFooter');
    const itemsHtml = order.items.map(item => '<tr><td>' + item.name + '</td><td>' + item.qty + '</td><td>' + fmtCurrency(item.price) + '</td><td>' + fmtCurrency(item.qty * item.price) + '</td></tr>').join('');
    body.innerHTML = '<div class="modal-info-row"><span class="modal-label">Order Code</span><span>' + order.id + '</span></div><div class="modal-info-row"><span class="modal-label">Date & Time</span><span>' + order.date + ' ' + order.time + '</span></div><div class="modal-info-row"><span class="modal-label">Customer</span><span>' + order.customer + '</span></div><div class="modal-info-row"><span class="modal-label">Address</span><span>' + order.address + '</span></div><div class="modal-info-row"><span class="modal-label">Phone</span><span>' + order.phone + '</span></div><div class="modal-info-row"><span class="modal-label">Email</span><span>' + order.email + '</span></div><h4 style="margin:16px 0 8px;color:var(--pc-blue);">Products Ordered</h4><table class="modal-items-table"><thead><tr><th>Item</th><th>Qty</th><th>Price</th><th>Subtotal</th></tr></thead><tbody>' + itemsHtml + '</tbody><tfoot><tr><td colspan="3"><strong>Total Amount</strong></td><td><strong>' + fmtCurrency(order.amount) + '</strong></td></tr></tfoot></table>';
    if (order.status === 'pending') footer.innerHTML = '<button class="btn btn-decline" onclick="declineOrder(\'' + order.id + '\')">Decline</button><button class="btn btn-primary" onclick="acceptOrder(\'' + order.id + '\')">Accept</button>';
    else if (order.status === 'shipped') footer.innerHTML = '<button class="btn btn-secondary" onclick="closeOrderModal()" style="color:#555;border:1px solid #ccc;background:transparent;padding:10px 24px;border-radius:6px;font-size:14px;font-weight:600;cursor:pointer;">Close</button><button class="btn btn-primary" onclick="deliverOrder(\'' + order.id + '\')">Mark as to be deliver</button>';
    else if (order.status === 'delivered') footer.innerHTML = '<button class="btn btn-secondary" onclick="closeOrderModal()" style="color:#555;border:1px solid #ccc;background:transparent;padding:10px 24px;border-radius:6px;font-size:14px;font-weight:600;cursor:pointer;">Close</button><button class="btn btn-primary" onclick="finishOrder(\'' + order.id + '\')">Order Finished</button>';
    modal.style.display = 'flex';
  };

  window.closeOrderModal = () => { document.getElementById('orderModal').style.display = 'none'; };
  window.acceptOrder = (id) => {
    const o = onlineOrders.find(x => x.id === id);
    if (o) { o.status = 'shipped'; persistOnlineOrders(); renderOrders(document.querySelector('.sub-nav-item.active').dataset.status); }
    closeOrderModal();
  };
  window.declineOrder = (id) => {
    const idx = onlineOrders.findIndex(o => o.id === id);
    if (idx !== -1) { onlineOrders.splice(idx, 1); persistOnlineOrders(); renderOrders(document.querySelector('.sub-nav-item.active').dataset.status); }
    closeOrderModal();
  };
  window.deliverOrder = (id) => {
    const o = onlineOrders.find(x => x.id === id);
    if (o) { o.status = 'delivered'; persistOnlineOrders(); renderOrders(document.querySelector('.sub-nav-item.active').dataset.status); }
    closeOrderModal();
  };
  window.finishOrder = (id) => {
    const idx = onlineOrders.findIndex(o => o.id === id);
    if (idx === -1) return;
    const order = onlineOrders[idx];
    onlineOrders.splice(idx, 1);
    persistOnlineOrders();
    if (!sbClient) {
      const c = JSON.parse(localStorage.getItem('completedOrders') || '[]');
      c.unshift({ id: order.id, customer: order.customer, type: 'Online', amount: order.amount, status: 'Completed', date: getTodayStr() });
      localStorage.setItem('completedOrders', JSON.stringify(c));
    } else {
      sb('online_orders').upsert({ id: order.id, customer: order.customer, amount: order.amount, status: 'Completed', date: getTodayStr() }, { onConflict: 'id' });
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

  function ruleSign(r) { return r.direction === 'subtract' ? '−' : '+'; }

  function renderRules() {
    const rules = _rulesCache || [];
    rulesTableBody.innerHTML = rules.map((r, i) => {
      const s = r.enabled ? '<span class="status-pill active">Live</span>' : '<span class="status-pill paused">Disabled</span>';
      const sign = ruleSign(r);
      const adj = r.adjustType === 'percent' ? sign + ' ' + r.adjustValue + '%' : sign + ' ₱' + r.adjustValue;
      return '<tr><td>' + (i + 1) + '</td><td><strong>Rule #' + (i + 1) + '</strong></td><td>' + fieldLabels[r.field] + ' ' + opLabels[r.operator] + ' ' + r.value + '</td><td>' + adj + '</td><td>' + s + '</td><td style="text-align:center;white-space:nowrap;"><button class="btn-icon" onclick="editRule(' + r.id + ')" title="Edit">✏️</button><button class="btn-icon" onclick="toggleRule(' + r.id + ')" title="Toggle">' + (r.enabled ? '⏸️' : '▶️') + '</button><button class="btn-icon danger" onclick="deleteRule(' + r.id + ')" title="Delete">🗑️</button></td></tr>';
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
