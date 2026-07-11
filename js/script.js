// ==========================================
// 1. LOGIN PAGE LOGIC
// ==========================================
const loginForm = document.getElementById('loginForm');

// Only run this code if the login form exists on the screen
if (loginForm) {
  loginForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value.trim();
    
    if (username === 'admin' && password === 'pcrover123') {
      window.location.href = 'dashboard.html';
      return;
    }
    
    alert('Invalid credentials. Please use admin / pcrover123');
  });
}

// ==========================================
// GLOBAL HELPERS (shared by POS & Automation)
// ==========================================
function getRules() { return JSON.parse(localStorage.getItem('autoRules') || '[]'); }

function applyRulesToProduct(product) {
  const rules = getRules().filter(r => r.enabled);
  let price = product.price;
  rules.forEach(r => {
    let match = false;
    const val = r.field === 'stock' ? product.stock : 0;
    if (r.operator === 'greater' && val > r.value) match = true;
    if (r.operator === 'less' && val < r.value) match = true;
    if (r.operator === 'equal' && val === r.value) match = true;
    if (match) {
      const change = r.adjustType === 'percent'
        ? price * r.adjustValue / 100
        : r.adjustValue;
      price = r.direction === 'subtract' ? price - change : price + change;
    }
  });
  return price;
}

// ==========================================
// 2. POS TERMINAL LOGIC
// ==========================================
const cartList = document.querySelector('.pos-cart-list');

if (cartList) {
  if (!localStorage.getItem('inventoryProducts')) {
    const defaults = [
      { id: 1, name: 'Mechanical Keyboard', price: 2350, stock: 15, threshold: 5, enabled: true, image: '' },
      { id: 2, name: 'Gaming Mouse', price: 1650, stock: 20, threshold: 8, enabled: true, image: '' },
      { id: 3, name: '27" Monitor', price: 8500, stock: 8, threshold: 3, enabled: true, image: '' },
      { id: 4, name: 'Laptop Stand', price: 1200, stock: 12, threshold: 5, enabled: true, image: '' },
      { id: 5, name: 'Gaming Headset', price: 2800, stock: 6, threshold: 4, enabled: true, image: '' },
      { id: 6, name: 'Webcam HD', price: 1800, stock: 10, threshold: 5, enabled: true, image: '' },
      { id: 7, name: 'Bluetooth Speaker', price: 1450, stock: 14, threshold: 6, enabled: true, image: '' },
      { id: 8, name: 'SSD 1TB', price: 3200, stock: 18, threshold: 5, enabled: true, image: '' },
      { id: 9, name: 'USB-C Hub', price: 850, stock: 25, threshold: 10, enabled: true, image: '' },
      { id: 10, name: 'Printer', price: 4500, stock: 5, threshold: 3, enabled: true, image: '' },
      { id: 11, name: 'Mouse Pad', price: 250, stock: 30, threshold: 15, enabled: true, image: '' },
      { id: 12, name: 'Extension Cord', price: 350, stock: 22, threshold: 10, enabled: true, image: '' }
    ];
    localStorage.setItem('inventoryProducts', JSON.stringify(defaults));
  }

  let cart = [];
  const subtotalEl = document.querySelector('.pos-summary-row span:nth-child(2)');
  const totalEl = document.querySelector('.pos-summary-total span:nth-child(2)');
  const checkoutBtn = document.querySelector('.btn-checkout');
  const searchInput = document.getElementById('posSearchInput');
  const posGrid = document.querySelector('.pos-grid');

  const formatCurrency = (amount) => `₱${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const productEmojis = {
    'Mechanical Keyboard': '⌨️', 'Gaming Mouse': '🖱️', '27" Monitor': '🖥️',
    'Laptop Stand': '💻', 'Gaming Headset': '🎧', 'Webcam HD': '📷',
    'Bluetooth Speaker': '🔊', 'SSD 1TB': '💾', 'USB-C Hub': '🧮',
    'Printer': '🖨️', 'Mouse Pad': '📦', 'Extension Cord': '🔌'
  };

  function renderPOSProducts() {
    const inventory = JSON.parse(localStorage.getItem('inventoryProducts') || '[]');
    const imported = JSON.parse(localStorage.getItem('importedProducts') || '[]');

    // show enabled inventory products + enabled imported products (use adjusted price)
    const invCards = inventory.filter(p => p.enabled).map(p => ({
      name: p.name, price: p.price, source: 'inventory', dataId: p.id
    }));
    const impCards = imported.filter(p => p.enabled).map(p => ({
      name: p.name, price: applyRulesToProduct(p), source: 'imported', dataId: p.id
    }));

    const allCards = [...invCards, ...impCards];

    posGrid.innerHTML = allCards.map(c =>
      '<div class="pos-item-card" data-name="' + c.name + '" data-price="' + c.price + '" data-source="' + c.source + '" data-id="' + c.dataId + '">' +
        '<div class="pos-item-img">' + (productEmojis[c.name] || '📦') + '</div>' +
        '<div class="pos-item-name">' + c.name + '</div>' +
        '<div class="pos-item-price">₱' + c.price.toLocaleString() + '</div>' +
      '</div>'
    ).join('');

    if (searchInput && searchInput.value.trim()) filterProducts();
  }

  function filterProducts() {
    const term = searchInput.value.trim().toLowerCase();
    document.querySelectorAll('.pos-item-card').forEach(card => {
      card.style.display = !term || card.dataset.name.toLowerCase().includes(term) ? '' : 'none';
    });
  }

  posGrid.addEventListener('click', (e) => {
    const card = e.target.closest('.pos-item-card');
    if (!card || card.style.display === 'none') return;

    const name = card.dataset.name;
    const price = parseFloat(card.dataset.price);
    const source = card.dataset.source || 'inventory';
    const dataId = parseInt(card.dataset.id);

    const key = source + '-' + dataId;
    const existingItem = cart.find(item => item._key === key);
    if (existingItem) {
      existingItem.qty += 1;
    } else {
      cart.push({ _key: key, name, price, qty: 1, source, dataId });
    }
    updateCartUI();
  });

  if (searchInput) {
    searchInput.addEventListener('input', filterProducts);
  }

  function updateCartUI() {
    cartList.innerHTML = '';
    let subtotal = 0;

    cart.forEach((item, index) => {
      subtotal += item.price * item.qty;
      const div = document.createElement('div');
      div.className = 'pos-cart-item';
      div.innerHTML =
        '<div class="pos-cart-item-details">' +
          '<span class="pos-cart-item-name">' + item.name + '</span>' +
          '<span class="pos-cart-item-price">' + formatCurrency(item.price) + '</span>' +
        '</div>' +
        '<div class="pos-cart-qty">' +
          '<button class="pos-qty-btn" onclick="changeQty(' + index + ', -1)">-</button>' +
          '<span>' + item.qty + '</span>' +
          '<button class="pos-qty-btn" onclick="changeQty(' + index + ', 1)">+</button>' +
        '</div>';
      cartList.appendChild(div);
    });

    const total = subtotal;
    subtotalEl.innerText = formatCurrency(subtotal);
    totalEl.innerText = formatCurrency(total);
    checkoutBtn.innerText = 'Pay Out ' + formatCurrency(total);

    checkoutBtn.onclick = () => {
      if (cart.length === 0) { alert('Your cart is empty!'); return; }

      const inv = JSON.parse(localStorage.getItem('inventoryProducts') || '[]');
      const imp = JSON.parse(localStorage.getItem('importedProducts') || '[]');
      cart.forEach(item => {
        if (item.source === 'imported') {
          const prod = imp.find(p => p.id === item.dataId);
          if (prod) prod.stock = Math.max(0, prod.stock - item.qty);
        } else {
          const prod = inv.find(p => p.id === item.dataId);
          if (prod) prod.stock = Math.max(0, prod.stock - item.qty);
        }
      });
      localStorage.setItem('inventoryProducts', JSON.stringify(inv));
      localStorage.setItem('importedProducts', JSON.stringify(imp));

      const order = {
        id: '#' + String(Date.now()).slice(-4),
        customer: 'Walk-in Customer', type: 'Walk-in',
        amount: total, status: 'Completed',
        date: new Date().toISOString().split('T')[0]
      };
      const stored = JSON.parse(localStorage.getItem('posOrders') || '[]');
      stored.unshift(order);
      localStorage.setItem('posOrders', JSON.stringify(stored));
      alert('Transaction Completed! Total paid: ' + formatCurrency(total));
      cart = [];
      updateCartUI();
    };
  }

  window.changeQty = (index, delta) => {
    cart[index].qty += delta;
    if (cart[index].qty <= 0) cart.splice(index, 1);
    updateCartUI();
  };

  renderPOSProducts();
  updateCartUI();
}

// ==========================================
// 3. DASHBOARD SUMMARY LOGIC
// ==========================================
const recentOrdersBody = document.getElementById('recentOrdersBody');
const recentOrdersCountEl = document.getElementById('recentOrdersCount');
const ordersToAcceptCountEl = document.getElementById('ordersToAcceptCount');
const ordersToAcceptMetaEl = document.getElementById('ordersToAcceptMeta');
const lowStockCountEl = document.getElementById('lowStockCount');
const lowStockMetaEl = document.getElementById('lowStockMeta');
const dailySalesValueEl = document.getElementById('dailySalesValue');
const monthlySalesValueEl = document.getElementById('monthlySalesValue');

if (recentOrdersBody) {
  const storedPosOrders = JSON.parse(localStorage.getItem('posOrders') || '[]');
  const completedOrders = JSON.parse(localStorage.getItem('completedOrders') || '[]');

  const recentOrders = [
    ...storedPosOrders,
    ...completedOrders,
    { id: '#0090', customer: 'Jose J.', type: 'Online', amount: 8750, status: 'Completed', date: '2026-07-06' },
    { id: '#0087', customer: 'Arielle M.', type: 'Online', amount: 5420, status: 'Completed', date: '2026-01-15' },
    { id: '#0086', customer: 'PC Hub', type: 'Walk-in', amount: 3210, status: 'Completed', date: '2026-01-14' },
    { id: '#0085', customer: 'Nina R.', type: 'Online', amount: 1850, status: 'Processing', date: '2026-01-13' },
    { id: '#0084', customer: 'Mark D.', type: 'Walk-in', amount: 2760, status: 'Completed', date: '2026-01-12' }
  ];

  const pendingOrders = []

  const invProducts = JSON.parse(localStorage.getItem('inventoryProducts') || '[]');
  const lowStockItems = invProducts.filter(p => p.enabled && p.stock <= p.threshold);

  const formatCurrency = (amount) => `₱${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const getStatusClass = (status) => {
    if (status === 'Completed') return 'completed';
    if (status === 'Pending') return 'pending';
    if (status === 'Processing') return 'active';
    return 'paused';
  };

  recentOrdersBody.innerHTML = recentOrders.map(order => `
    <tr>
      <td>${order.date}</td>
      <td>${order.id}</td>
      <td>${formatCurrency(order.amount)}</td>
    </tr>
  `).join('');

  const dailySales = recentOrders.reduce((sum, order) => sum + order.amount, 0);
  const monthlySales = dailySales * 6;

  recentOrdersCountEl.innerText = recentOrders.length;
  ordersToAcceptCountEl.innerText = pendingOrders.length;
  ordersToAcceptMetaEl.innerText = `${pendingOrders.length} pending confirmations`;
  lowStockCountEl.innerText = lowStockItems.length;
  lowStockMetaEl.innerText = lowStockItems.length > 0
    ? lowStockItems.map(p => p.name).join(', ')
    : 'All products well stocked';
  dailySalesValueEl.innerText = formatCurrency(dailySales);
  monthlySalesValueEl.innerText = formatCurrency(monthlySales);
}

// ==========================================
// 4. INVENTORY LOGIC
// ==========================================
const inventoryTableBody = document.getElementById('inventoryTableBody');

if (inventoryTableBody) {
  const defaultProducts = [
    { id: 1, name: 'Mechanical Keyboard', price: 2350, stock: 15, threshold: 5, enabled: true, image: '' },
    { id: 2, name: 'Gaming Mouse', price: 1650, stock: 20, threshold: 8, enabled: true, image: '' },
    { id: 3, name: '27" Monitor', price: 8500, stock: 8, threshold: 3, enabled: true, image: '' },
    { id: 4, name: 'Laptop Stand', price: 1200, stock: 12, threshold: 5, enabled: true, image: '' },
    { id: 5, name: 'Gaming Headset', price: 2800, stock: 6, threshold: 4, enabled: true, image: '' },
    { id: 6, name: 'Webcam HD', price: 1800, stock: 10, threshold: 5, enabled: true, image: '' },
    { id: 7, name: 'Bluetooth Speaker', price: 1450, stock: 14, threshold: 6, enabled: true, image: '' },
    { id: 8, name: 'SSD 1TB', price: 3200, stock: 18, threshold: 5, enabled: true, image: '' },
    { id: 9, name: 'USB-C Hub', price: 850, stock: 25, threshold: 10, enabled: true, image: '' },
    { id: 10, name: 'Printer', price: 4500, stock: 5, threshold: 3, enabled: true, image: '' },
    { id: 11, name: 'Mouse Pad', price: 250, stock: 30, threshold: 15, enabled: true, image: '' },
    { id: 12, name: 'Extension Cord', price: 350, stock: 22, threshold: 10, enabled: true, image: '' }
  ];

  if (!localStorage.getItem('inventoryProducts')) {
    localStorage.setItem('inventoryProducts', JSON.stringify(defaultProducts));
  }

  function getProducts() {
    return JSON.parse(localStorage.getItem('inventoryProducts') || '[]');
  }

  function saveProducts(products) {
    localStorage.setItem('inventoryProducts', JSON.stringify(products));
  }

  function renderInventory() {
    const products = getProducts();
    const fmt = (a) => `₱${a.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

    inventoryTableBody.innerHTML = products.map(p => {
      let statusHtml, toggleHtml;

      if (!p.enabled) {
        statusHtml = '<span class="status-pill paused">Disabled</span>';
        toggleHtml = '<button class="btn-toggle inactive" onclick="toggleProduct(' + p.id + ')">Disabled</button>';
      } else if (p.stock <= p.threshold) {
        statusHtml = '<span class="status-pill low">Low Stock</span>';
        toggleHtml = '<button class="btn-toggle active" onclick="toggleProduct(' + p.id + ')">Active</button>';
      } else {
        statusHtml = '<span class="status-pill active">In Stock</span>';
        toggleHtml = '<button class="btn-toggle active" onclick="toggleProduct(' + p.id + ')">Active</button>';
      }

      const imgHtml = p.image
        ? '<img src="' + p.image + '" class="inv-thumb" alt="' + p.name + '">'
        : '<div class="inv-thumb" style="background:#f5f5f5;display:flex;align-items:center;justify-content:center;color:#ccc;font-size:16px;">📷</div>';

      return '<tr>' +
        '<td>' + imgHtml + '</td>' +
        '<td><strong>' + p.name + '</strong></td>' +
        '<td>' + fmt(p.price) + '</td>' +
        '<td>' + p.stock + '</td>' +
        '<td>' + statusHtml + '</td>' +
        '<td style="white-space:nowrap;text-align:center;">' +
          '<button class="btn-icon" onclick="editProduct(' + p.id + ')" title="Edit">✏️</button>' +
          toggleHtml +
        '</td>' +
      '</tr>';
    }).join('');
  }

  window.toggleProduct = (id) => {
    const products = getProducts();
    const p = products.find(x => x.id === id);
    if (p) { p.enabled = !p.enabled; saveProducts(products); renderInventory(); }
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

  window.closeProductModal = () => {
    document.getElementById('productModal').style.display = 'none';
  };

  window.previewImage = (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const preview = document.getElementById('imagePreview');
      preview.style.display = 'block';
      preview.innerHTML = '<img src="' + e.target.result + '">';
    };
    reader.readAsDataURL(file);
  };

  window.saveProduct = () => {
    const id = document.getElementById('editProductId').value;
    const name = document.getElementById('productName').value.trim();
    const price = parseFloat(document.getElementById('productPrice').value);
    const stock = parseInt(document.getElementById('productStock').value);
    const threshold = parseInt(document.getElementById('productThreshold').value);
    const enabled = document.getElementById('productEnabled').checked;
    const preview = document.getElementById('imagePreview');
    const imgSrc = preview.querySelector('img') ? preview.querySelector('img').src : '';

    if (!name || isNaN(price) || isNaN(stock) || isNaN(threshold)) { alert('Please fill all fields.'); return; }

    const products = getProducts();

    if (id) {
      const p = products.find(x => x.id === parseInt(id));
      if (p) {
        p.name = name; p.price = price; p.stock = stock;
        p.threshold = threshold; p.enabled = enabled;
        if (imgSrc) p.image = imgSrc;
      }
    } else {
      const newId = products.length > 0 ? Math.max(...products.map(x => x.id)) + 1 : 1;
      products.push({ id: newId, name, price, stock, threshold, enabled, image: imgSrc });
    }

    saveProducts(products);
    renderInventory();
    closeProductModal();
  };

  window.editProduct = (id) => {
    const products = getProducts();
    const p = products.find(x => x.id === id);
    if (!p) return;

    document.getElementById('productModalTitle').textContent = 'Edit Product';
    document.getElementById('editProductId').value = p.id;
    document.getElementById('productName').value = p.name;
    document.getElementById('productPrice').value = p.price;
    document.getElementById('productStock').value = p.stock;
    document.getElementById('productThreshold').value = p.threshold;
    document.getElementById('productEnabled').checked = p.enabled;

    const preview = document.getElementById('imagePreview');
    if (p.image) {
      preview.style.display = 'block';
      preview.innerHTML = '<img src="' + p.image + '">';
    } else {
      preview.style.display = 'none';
      preview.innerHTML = '';
    }

    document.getElementById('productImage').value = '';
    document.getElementById('productModal').style.display = 'flex';
  };

  renderInventory();
}

// ==========================================
// 5. ONLINE ORDERS LOGIC
// ==========================================
const ordersContainer = document.getElementById('ordersContainer');
const filterTabs = document.querySelectorAll('.sub-nav-item');

if (ordersContainer && filterTabs.length > 0) {
  const onlineOrders = [
    {
      id: '#2001', customer: 'Arielle M.', address: '123 Rizal St, Baliuag, Bulacan',
      phone: '0917-123-4567', email: 'arielle.m@email.com',
      amount: 5420, status: 'pending', date: '2026-07-06', time: '08:30 AM',
      items: [
        { name: 'Mechanical Keyboard', qty: 1, price: 2350 },
        { name: 'Gaming Mouse', qty: 2, price: 1535 }
      ]
    },
    {
      id: '#2002', customer: 'Nina R.', address: '456 Mabini Ave, Malolos, Bulacan',
      phone: '0928-234-5678', email: 'nina.r@email.com',
      amount: 1850, status: 'pending', date: '2026-07-06', time: '09:15 AM',
      items: [
        { name: 'USB-C Hub', qty: 1, price: 850 },
        { name: 'Mouse Pad', qty: 2, price: 500 }
      ]
    },
    {
      id: '#2003', customer: 'Ben T.', address: '789 Del Pilar St, Baliuag, Bulacan',
      phone: '0939-345-6789', email: 'ben.t@email.com',
      amount: 2480, status: 'shipped', date: '2026-07-05', time: '10:00 AM',
      items: [
        { name: 'Webcam HD', qty: 1, price: 1800 },
        { name: 'Microphone', qty: 1, price: 680 }
      ]
    },
    {
      id: '#2004', customer: 'Rina C.', address: '321 Luna St, Plaridel, Bulacan',
      phone: '0940-456-7890', email: 'rina.c@email.com',
      amount: 3210, status: 'shipped', date: '2026-07-04', time: '02:30 PM',
      items: [
        { name: '27" Monitor', qty: 1, price: 3210 }
      ]
    },
    {
      id: '#2005', customer: 'Mark D.', address: '654 Bonifacio St, Baliuag, Bulacan',
      phone: '0951-567-8901', email: 'mark.d@email.com',
      amount: 1320, status: 'delivered', date: '2026-07-03', time: '11:00 AM',
      items: [
        { name: 'Wireless Mouse', qty: 1, price: 750 },
        { name: 'Headset Stand', qty: 1, price: 570 }
      ]
    }
  ];

  const formatCurrency = (amount) => `₱${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const getStatusBadge = (status) => {
    if (status === 'pending') return '<span class="status-pill pending">To Accept</span>';
    if (status === 'shipped') return '<span class="status-pill active">To Deliver</span>';
    if (status === 'delivered') return '<span class="status-pill completed">To Finish</span>';
    return '<span class="status-pill paused">Unknown</span>';
  };

  function renderOrders(filterStatus) {
    const filtered = onlineOrders
      .filter(order => order.status === filterStatus)
      .sort((a, b) => {
        const da = new Date(a.date + ' ' + a.time);
        const db = new Date(b.date + ' ' + b.time);
        return da - db;
      });

    ordersContainer.innerHTML = filtered.map(order => `
      <div class="order-card">
        <div class="order-card-top">
          <div>
            <span class="order-id">${order.id}</span>
            <span class="order-time">${order.date} ${order.time}</span>
          </div>
          <button class="btn-view" onclick="viewOrder('${order.id}')">View</button>
        </div>
        <div class="order-card-body">
          <div class="order-customer">${order.customer}</div>
          <div class="order-address">${order.address}</div>
        </div>
      </div>
    `).join('');
  }

  window.viewOrder = (id) => {
    const order = onlineOrders.find(o => o.id === id);
    if (!order) return;

    const modal = document.getElementById('orderModal');
    const modalBody = document.getElementById('modalBody');
    const modalFooter = document.getElementById('modalFooter');

    const itemsHtml = order.items.map(item => `
      <tr>
        <td>${item.name}</td>
        <td>${item.qty}</td>
        <td>${formatCurrency(item.price)}</td>
        <td>${formatCurrency(item.qty * item.price)}</td>
      </tr>
    `).join('');

    modalBody.innerHTML = `
      <div class="modal-info-row"><span class="modal-label">Order Code</span><span>${order.id}</span></div>
      <div class="modal-info-row"><span class="modal-label">Date & Time</span><span>${order.date} ${order.time}</span></div>
      <div class="modal-info-row"><span class="modal-label">Customer</span><span>${order.customer}</span></div>
      <div class="modal-info-row"><span class="modal-label">Address</span><span>${order.address}</span></div>
      <div class="modal-info-row"><span class="modal-label">Phone</span><span>${order.phone}</span></div>
      <div class="modal-info-row"><span class="modal-label">Email</span><span>${order.email}</span></div>
      <h4 style="margin:16px 0 8px;color:var(--pc-blue);">Products Ordered</h4>
      <table class="modal-items-table">
        <thead><tr><th>Item</th><th>Qty</th><th>Price</th><th>Subtotal</th></tr></thead>
        <tbody>${itemsHtml}</tbody>
        <tfoot><tr><td colspan="3"><strong>Total Amount</strong></td><td><strong>${formatCurrency(order.amount)}</strong></td></tr></tfoot>
      </table>
    `;

    if (order.status === 'pending') {
      modalFooter.innerHTML = `
        <button class="btn btn-decline" onclick="declineOrder('${order.id}')">Decline</button>
        <button class="btn btn-primary" onclick="acceptOrder('${order.id}')">Accept</button>
      `;
    } else if (order.status === 'shipped') {
      modalFooter.innerHTML = `
        <button class="btn btn-secondary" onclick="closeOrderModal()" style="color:#555;border:1px solid #ccc;background:transparent;padding:10px 24px;border-radius:6px;font-size:14px;font-weight:600;cursor:pointer;">Close</button>
        <button class="btn btn-primary" onclick="deliverOrder('${order.id}')">Mark as to be deliver</button>
      `;
    } else if (order.status === 'delivered') {
      modalFooter.innerHTML = `
        <button class="btn btn-secondary" onclick="closeOrderModal()" style="color:#555;border:1px solid #ccc;background:transparent;padding:10px 24px;border-radius:6px;font-size:14px;font-weight:600;cursor:pointer;">Close</button>
        <button class="btn btn-primary" onclick="finishOrder('${order.id}')">Order Finished</button>
      `;
    }

    modal.style.display = 'flex';
  };

  window.closeOrderModal = () => {
    document.getElementById('orderModal').style.display = 'none';
  };

  window.acceptOrder = (id) => {
    const order = onlineOrders.find(o => o.id === id);
    if (order) {
      order.status = 'shipped';
      const activeTab = document.querySelector('.sub-nav-item.active');
      renderOrders(activeTab.dataset.status);
    }
    closeOrderModal();
  };

  window.declineOrder = (id) => {
    const idx = onlineOrders.findIndex(o => o.id === id);
    if (idx !== -1) {
      onlineOrders.splice(idx, 1);
      const activeTab = document.querySelector('.sub-nav-item.active');
      renderOrders(activeTab.dataset.status);
    }
    closeOrderModal();
  };

  window.deliverOrder = (id) => {
    const order = onlineOrders.find(o => o.id === id);
    if (order) {
      order.status = 'delivered';
      const activeTab = document.querySelector('.sub-nav-item.active');
      renderOrders(activeTab.dataset.status);
    }
    closeOrderModal();
  };

  window.finishOrder = (id) => {
    const idx = onlineOrders.findIndex(o => o.id === id);
    if (idx === -1) return;

    const order = onlineOrders[idx];
    onlineOrders.splice(idx, 1);

    const completed = JSON.parse(localStorage.getItem('completedOrders') || '[]');
    completed.unshift({
      id: order.id,
      customer: order.customer,
      type: 'Online',
      amount: order.amount,
      status: 'Completed',
      date: new Date().toISOString().split('T')[0]
    });
    localStorage.setItem('completedOrders', JSON.stringify(completed));

    const activeTab = document.querySelector('.sub-nav-item.active');
    renderOrders(activeTab.dataset.status);
    closeOrderModal();
  };

  // Set up filter tab event listeners
  filterTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      filterTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const status = tab.dataset.status;
      renderOrders(status);
    });
  });

  // Initialize with first tab active
  renderOrders('pending');
}

// ==========================================
// 6. PRICE AUTOMATION LOGIC
// ==========================================
const rulesTableBody = document.getElementById('rulesTableBody');

if (rulesTableBody) {
  const operatorLabels = { greater: 'Greater than', less: 'Less than', equal: 'Equal to' };
  const fieldLabels = { stock: 'Stock', sales: 'Sales' };

  if (!localStorage.getItem('autoRules')) {
    localStorage.setItem('autoRules', JSON.stringify([]));
  }

  function saveRules(r) { localStorage.setItem('autoRules', JSON.stringify(r)); }

  function ruleSign(r) { return r.direction === 'subtract' ? '−' : '+'; }

  function renderRules() {
    const rules = getRules();
    rulesTableBody.innerHTML = rules.map((r, i) => {
      const statusHtml = r.enabled
        ? '<span class="status-pill active">Live</span>'
        : '<span class="status-pill paused">Disabled</span>';
      const sign = ruleSign(r);
      const adjStr = r.adjustType === 'percent' ? sign + ' ' + r.adjustValue + '%' : sign + ' ₱' + r.adjustValue;
      return '<tr>' +
        '<td>' + (i + 1) + '</td>' +
        '<td><strong>Rule #' + (i + 1) + '</strong></td>' +
        '<td>' + fieldLabels[r.field] + ' ' + operatorLabels[r.operator] + ' ' + r.value + '</td>' +
        '<td>' + adjStr + '</td>' +
        '<td>' + statusHtml + '</td>' +
        '<td style="text-align:center;white-space:nowrap;">' +
          '<button class="btn-icon" onclick="editRule(' + r.id + ')" title="Edit">✏️</button>' +
          '<button class="btn-icon" onclick="toggleRule(' + r.id + ')" title="Toggle">' + (r.enabled ? '⏸️' : '▶️') + '</button>' +
          '<button class="btn-icon danger" onclick="deleteRule(' + r.id + ')" title="Delete">🗑️</button>' +
        '</td>' +
      '</tr>';
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

  window.saveRule = () => {
    const id = document.getElementById('editRuleId').value;
    const direction = document.getElementById('ruleDirection').value;
    const field = document.getElementById('ruleField').value;
    const operator = document.getElementById('ruleOperator').value;
    const value = parseInt(document.getElementById('ruleValue').value);
    const adjustValue = parseFloat(document.getElementById('ruleAdjustValue').value);
    const adjustType = document.getElementById('ruleAdjustType').value;
    const enabled = document.getElementById('ruleEnabled').checked;

    if (isNaN(value) || isNaN(adjustValue) || adjustValue <= 0) { alert('Please fill all fields with valid numbers.'); return; }

    const rules = getRules();

    if (id) {
      const r = rules.find(x => x.id === parseInt(id));
      if (r) { r.direction = direction; r.field = field; r.operator = operator; r.value = value; r.adjustValue = adjustValue; r.adjustType = adjustType; r.enabled = enabled; }
    } else {
      const newId = rules.length > 0 ? Math.max(...rules.map(x => x.id)) + 1 : 1;
      rules.push({ id: newId, direction, field, operator, value, adjustValue, adjustType, enabled });
    }

    saveRules(rules);
    renderRules();
    renderImportedProducts();
    closeRuleModal();
  };

  window.editRule = (id) => {
    const rules = getRules();
    const r = rules.find(x => x.id === id);
    if (!r) return;

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

  window.toggleRule = (id) => {
    const rules = getRules();
    const r = rules.find(x => x.id === id);
    if (r) { r.enabled = !r.enabled; saveRules(rules); renderRules(); renderImportedProducts(); }
  };

  window.deleteRule = (id) => {
    let rules = getRules();
    rules = rules.filter(x => x.id !== id);
    saveRules(rules);
    renderRules();
    renderImportedProducts();
  };

  // --- Imported Products ---
  const importedProductsBody = document.getElementById('importedProductsBody');

  function getImported() { return JSON.parse(localStorage.getItem('importedProducts') || '[]'); }
  function saveImported(p) { localStorage.setItem('importedProducts', JSON.stringify(p)); }

  function renderImportedProducts() {
    const products = getImported();
    const section = document.getElementById('importedProductsSection');

    if (products.length === 0) { section.style.display = 'none'; return; }
    section.style.display = 'block';

    const fmt = (a) => '₱' + a.toLocaleString('en-US', { minimumFractionDigits: 2 });

    importedProductsBody.innerHTML = products.map(p => {
      const adjusted = applyRulesToProduct(p);
      const statusHtml = p.enabled
        ? '<span class="status-pill active">Active</span>'
        : '<span class="status-pill paused">Disabled</span>';
      const priceDiff = adjusted !== p.price;
      return '<tr>' +
        '<td><strong>' + p.name + '</strong></td>' +
        '<td>' + fmt(p.price) + '</td>' +
        '<td>' + (priceDiff ? '<span style="color:var(--pc-orange);font-weight:700;">' + fmt(adjusted) + '</span>' : fmt(p.price)) + '</td>' +
        '<td>' + p.stock + '</td>' +
        '<td>' + statusHtml + '</td>' +
        '<td style="text-align:center;white-space:nowrap;">' +
          '<button class="btn-icon" onclick="editImportProduct(' + p.id + ')" title="Edit">✏️</button>' +
          '<button class="btn-icon" onclick="toggleImportProduct(' + p.id + ')" title="Toggle">' + (p.enabled ? '⏸️' : '▶️') + '</button>' +
        '</td>' +
      '</tr>';
    }).join('');
  }

  window.importExcel = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    if (typeof XLSX === 'undefined') {
      alert('Excel library failed to load. Check your internet connection and refresh.');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json(sheet, { header: 1 });

        if (json.length < 2) {
          alert('Excel file has no data rows.');
          return;
        }

        const headerRow = json[0].map(h => String(h || '').toLowerCase().trim());
        const nameIdx = headerRow.findIndex(h => h.includes('product') || h.includes('name') || h.includes('item'));
        const priceIdx = headerRow.findIndex(h => h.includes('price') || h.includes('amount') || h.includes('cost'));
        const stockIdx = headerRow.findIndex(h => h.includes('stock') || h.includes('qty') || h.includes('quantity'));

        const products = getImported();
        let nextId = products.length > 0 ? Math.max(...products.map(x => x.id)) + 1 : 1;
        let count = 0;

        for (let i = 1; i < json.length; i++) {
          const row = json[i];
          if (!row || row.length === 0) continue;
          const name = nameIdx >= 0 ? String(row[nameIdx] || '').trim() : (String(row[0] || '').trim());
          const price = parseFloat(priceIdx >= 0 ? row[priceIdx] : row[1]) || 0;
          const stock = parseInt(stockIdx >= 0 ? row[stockIdx] : row[2]) || 0;
          if (name) {
            products.push({ id: nextId++, name, price, stock, enabled: true });
            count++;
          }
        }

        saveImported(products);
        renderImportedProducts();
        alert('Imported ' + count + ' products.');
      } catch (err) {
        alert('Error reading file: ' + err.message);
      }
    };
    reader.readAsArrayBuffer(file);
    event.target.value = '';
  };

  window.clearImportedProducts = () => {
    if (confirm('Clear all imported products?')) {
      saveImported([]);
      renderImportedProducts();
    }
  };

  window.editImportProduct = (id) => {
    const products = getImported();
    const p = products.find(x => x.id === id);
    if (!p) return;

    document.getElementById('importProductModalTitle').textContent = 'Edit Product';
    document.getElementById('editImportProductId').value = p.id;
    document.getElementById('importProductName').value = p.name;
    document.getElementById('importProductPrice').value = p.price;
    document.getElementById('importProductStock').value = p.stock;
    document.getElementById('importProductEnabled').checked = p.enabled;
    document.getElementById('importProductModal').style.display = 'flex';
  };

  window.closeImportProductModal = () => {
    document.getElementById('importProductModal').style.display = 'none';
  };

  window.saveImportProduct = () => {
    const id = document.getElementById('editImportProductId').value;
    const name = document.getElementById('importProductName').value.trim();
    const price = parseFloat(document.getElementById('importProductPrice').value);
    const stock = parseInt(document.getElementById('importProductStock').value);
    const enabled = document.getElementById('importProductEnabled').checked;

    if (!name || isNaN(price) || isNaN(stock)) { alert('Please fill all fields.'); return; }

    const products = getImported();
    if (id) {
      const p = products.find(x => x.id === parseInt(id));
      if (p) { p.name = name; p.price = price; p.stock = stock; p.enabled = enabled; }
    }
    saveImported(products);
    renderImportedProducts();
    closeImportProductModal();
  };

  window.toggleImportProduct = (id) => {
    const products = getImported();
    const p = products.find(x => x.id === id);
    if (p) { p.enabled = !p.enabled; saveImported(products); renderImportedProducts(); }
  };

  renderRules();
  renderImportedProducts();
}