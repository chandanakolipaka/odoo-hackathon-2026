/**
 * StockSense - Inventory Management System (IMS)
 * Frontend Application Controller
 */

// Application Global State
const state = {
  currentUser: {
    id: 1,
    name: 'Sarah Connor',
    email: 'manager@stocksense.com',
    role: 'inventory_manager',
    warehouse_id: 1
  },
  currentView: 'dashboard',
  products: [],
  categories: [],
  warehouses: [],
  locations: [],
  filters: {
    type: 'all',
    status: 'all',
    warehouse_id: 'all',
    category_id: 'all',
    search: ''
  },
  ledgerFilter: {
    operation_type: 'all',
    search: ''
  }
};

// Toast Notifications Helper
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// Modal Control Helpers
function openModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.add('active');
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.remove('active');
}

// Global click to close modal on backdrop
window.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-overlay')) {
    e.target.classList.remove('active');
  }
});

// Escape key closes open modals
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay.active').forEach(m => m.classList.remove('active'));
  }
});

// Switch Active View
function switchView(viewName) {
  state.currentView = viewName;

  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.view === viewName);
  });

  document.querySelectorAll('.view-section').forEach(section => {
    section.classList.toggle('active', section.id === `view-${viewName}`);
  });

  const pageTitleMap = {
    dashboard: 'Operations Dashboard',
    products: 'Product Management & Stock Availability',
    receipts: 'Receipts (Incoming Stock)',
    deliveries: 'Delivery Orders (Outgoing Stock)',
    transfers: 'Internal Stock Transfers',
    adjustments: 'Stock Adjustments & Physical Count',
    ledger: 'Stock Move History & Audit Ledger',
    settings: 'Warehouses & Locations Configuration',
    profile: 'User Profile & Security'
  };
  document.getElementById('current-page-title').textContent = pageTitleMap[viewName] || 'Inventory Dashboard';

  // Load view-specific data
  if (viewName === 'dashboard') loadDashboardData();
  else if (viewName === 'products') loadProducts();
  else if (viewName === 'receipts') loadOperationsByType('receipt');
  else if (viewName === 'deliveries') loadOperationsByType('delivery');
  else if (viewName === 'transfers') loadOperationsByType('internal');
  else if (viewName === 'adjustments') loadAdjustmentsView();
  else if (viewName === 'ledger') loadLedger();
  else if (viewName === 'settings') loadSettings();
  else if (viewName === 'profile') renderProfile();
}

// Fast Role Switcher (Inventory Manager vs Warehouse Staff)
function setRole(role) {
  if (role === 'inventory_manager') {
    state.currentUser = {
      id: 1,
      name: 'Sarah Connor',
      email: 'manager@stocksense.com',
      role: 'inventory_manager',
      warehouse_id: 1
    };
  } else {
    state.currentUser = {
      id: 2,
      name: 'Alex Mercer',
      email: 'staff@stocksense.com',
      role: 'warehouse_staff',
      warehouse_id: 1
    };
  }

  document.getElementById('role-manager-btn').classList.toggle('active', role === 'inventory_manager');
  document.getElementById('role-staff-btn').classList.toggle('active', role === 'warehouse_staff');

  document.getElementById('sidebar-user-name').textContent = state.currentUser.name;
  document.getElementById('sidebar-user-role').textContent = role === 'inventory_manager' ? 'Inventory Manager' : 'Warehouse Staff';

  showToast(`Switched active perspective to: ${role === 'inventory_manager' ? 'Inventory Manager' : 'Warehouse Staff'}`, 'info');
  if (state.currentView === 'profile') renderProfile();
}

// ==========================================
// 1. DASHBOARD LOAD & RENDER
// ==========================================

async function loadDashboardData() {
  try {
    // Fetch KPIs
    const kpiRes = await fetch('/api/dashboard/kpis');
    const kpis = await kpiRes.json();

    document.getElementById('kpi-total-val').textContent = kpis.totalProductsInStock || 0;
    document.getElementById('kpi-total-sub').textContent = `${kpis.totalStockUnits || 0} total units recorded`;

    document.getElementById('kpi-low-val').textContent = kpis.lowStockItemsCount || 0;
    document.getElementById('kpi-low-sub').textContent = kpis.lowStockItemsCount > 0 ? 'Requires immediate restock' : 'Stock levels optimal';

    document.getElementById('kpi-receipts-val').textContent = kpis.pendingReceipts || 0;
    document.getElementById('kpi-deliveries-val').textContent = kpis.pendingDeliveries || 0;
    document.getElementById('kpi-transfers-val').textContent = kpis.scheduledTransfers || 0;

    // Fetch Filtered Operations Table
    loadDashboardOperations();

    // Fetch Stats & Category Distribution
    const statsRes = await fetch('/api/dashboard/stats');
    const stats = await statsRes.json();
    renderStatsSummary(stats, kpis.lowStockItems);
  } catch (err) {
    showToast('Failed to load dashboard metrics: ' + err.message, 'danger');
  }
}

async function loadDashboardOperations() {
  try {
    const { type, status, warehouse_id, search } = state.filters;
    const params = new URLSearchParams({ type, status, warehouse_id, search });

    const res = await fetch(`/api/dashboard/operations?${params.toString()}`);
    const operations = await res.json();

    const tbody = document.getElementById('dashboard-ops-tbody');
    if (!operations.length) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding: 24px; color: var(--text-dim);">No operations match the selected criteria.</td></tr>`;
      return;
    }

    tbody.innerHTML = operations.map(op => `
      <tr>
        <td><strong>${op.reference}</strong></td>
        <td><span class="badge badge-${op.type}">${op.type}</span></td>
        <td><span class="badge badge-${op.status}">${op.status}</span></td>
        <td>${escapeHtml(op.partner_name || '-')}</td>
        <td>
          <small style="color:var(--text-muted)">From: ${escapeHtml(op.src_location_name || 'N/A')}</small><br>
          <small style="color:#818cf8">To: ${escapeHtml(op.dest_location_name || 'N/A')}</small>
        </td>
        <td><small>${escapeHtml(op.items_summary || '1 item')}</small></td>
        <td>
          ${renderOperationActionButtons(op)}
        </td>
      </tr>
    `).join('');
  } catch (err) {
    showToast('Failed to load operations: ' + err.message, 'danger');
  }
}

function renderOperationActionButtons(op) {
  if (op.status === 'done') {
    return `<span style="color: var(--success); font-size: 0.8rem; font-weight:600;">✓ Validated</span>`;
  }
  if (op.status === 'canceled') {
    return `<span style="color: var(--danger); font-size: 0.8rem;">Canceled</span>`;
  }

  let actions = '';
  // If delivery order in waiting state: Allow Pick & Pack
  if (op.type === 'delivery') {
    if (op.status === 'waiting') {
      actions += `<button class="btn btn-secondary btn-sm" onclick="pickDelivery(${op.id})">Pick</button> `;
    } else if (op.status === 'ready') {
      actions += `<button class="btn btn-secondary btn-sm" onclick="packDelivery(${op.id})">Pack</button> `;
    }
  }

  // Validate Button
  actions += `<button class="btn btn-success btn-sm" onclick="validateOperation(${op.id}, '${op.reference}')">Validate</button>`;
  return actions;
}

function renderStatsSummary(stats, lowStockItems = []) {
  const catContainer = document.getElementById('category-distribution-list');
  if (catContainer && stats.categoriesStats) {
    catContainer.innerHTML = stats.categoriesStats.map(c => `
      <div style="display:flex; justify-content:space-between; align-items:center; padding: 8px 0; border-bottom: 1px solid var(--border-color);">
        <span style="font-size:0.85rem; font-weight:600;">${escapeHtml(c.category)}</span>
        <span style="font-size:0.85rem; color: #818cf8; font-weight:700;">${c.total_quantity} units</span>
      </div>
    `).join('');
  }

  const alertContainer = document.getElementById('low-stock-alert-list');
  if (alertContainer) {
    if (!lowStockItems.length) {
      alertContainer.innerHTML = `<div style="color: var(--success); font-size: 0.85rem; padding: 10px 0;">✓ All items are above safe reorder thresholds.</div>`;
    } else {
      alertContainer.innerHTML = lowStockItems.map(item => `
        <div style="display:flex; justify-content:space-between; align-items:center; padding: 8px 0; border-bottom: 1px solid var(--border-color);">
          <div>
            <div style="font-size:0.85rem; font-weight:600; color:#f87171;">${escapeHtml(item.name)} (${item.sku})</div>
            <div style="font-size:0.75rem; color:var(--text-dim)">Current: ${item.current_stock} ${item.uom} | Min Threshold: ${item.min_qty} ${item.uom}</div>
          </div>
          <button class="btn btn-primary btn-sm" onclick="quickCreateReceiptForProduct(${item.id}, '${escapeHtml(item.name)}')">Restock</button>
        </div>
      `).join('');
    }
  }
}

// ==========================================
// 2. OPERATIONS ACTION WORKFLOWS
// ==========================================

async function validateOperation(id, reference) {
  try {
    const res = await fetch(`/api/operations/${id}/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_name: state.currentUser.name })
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to validate operation');
    }

    showToast(`✓ Operation ${reference} successfully validated! Stock ledger updated.`, 'success');
    if (state.currentView === 'dashboard') loadDashboardData();
    else if (state.currentView === 'receipts') loadOperationsByType('receipt');
    else if (state.currentView === 'deliveries') loadOperationsByType('delivery');
    else if (state.currentView === 'transfers') loadOperationsByType('internal');
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

async function pickDelivery(id) {
  try {
    const res = await fetch(`/api/operations/${id}/pick`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    showToast('Items picked from shelves and staged for packing.', 'info');
    if (state.currentView === 'dashboard') loadDashboardOperations();
    else loadOperationsByType('delivery');
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

async function packDelivery(id) {
  try {
    const res = await fetch(`/api/operations/${id}/pack`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    showToast('Items packed and labeled. Ready for final validation.', 'info');
    if (state.currentView === 'dashboard') loadDashboardOperations();
    else loadOperationsByType('delivery');
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

// Generic Operations View Loader (Receipts, Deliveries, Transfers)
async function loadOperationsByType(type) {
  try {
    const res = await fetch(`/api/operations?type=${type}`);
    const operations = await res.json();

    const tbodyId = `${type}s-tbody`;
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;

    if (!operations.length) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding: 24px; color: var(--text-dim);">No ${type} operations found.</td></tr>`;
      return;
    }

    tbody.innerHTML = operations.map(op => `
      <tr>
        <td><strong>${op.reference}</strong></td>
        <td><span class="badge badge-${op.status}">${op.status}</span></td>
        <td>${escapeHtml(op.partner_name || '-')}</td>
        <td>${escapeHtml(op.src_location_name || 'N/A')}</td>
        <td>${escapeHtml(op.dest_location_name || 'N/A')}</td>
        <td><small>${new Date(op.scheduled_date).toLocaleDateString()}</small></td>
        <td>${renderOperationActionButtons(op)}</td>
      </tr>
    `).join('');
  } catch (err) {
    showToast('Failed to load operations: ' + err.message, 'danger');
  }
}

// ==========================================
// 3. PRODUCTS MODULE & LOCATION AVAILABILITY
// ==========================================

async function loadProducts() {
  try {
    const res = await fetch('/api/products');
    state.products = await res.json();

    const tbody = document.getElementById('products-tbody');
    if (!tbody) return;

    if (!state.products.length) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding: 24px; color: var(--text-dim);">No products found.</td></tr>`;
      return;
    }

    tbody.innerHTML = state.products.map(p => `
      <tr>
        <td><strong>${escapeHtml(p.name)}</strong></td>
        <td><code>${escapeHtml(p.sku)}</code></td>
        <td>${escapeHtml(p.category_name || 'General')}</td>
        <td>${p.uom}</td>
        <td>
          <span style="font-weight:700; font-size:0.95rem; color: ${p.is_low_stock ? '#f87171' : '#34d399'}">
            ${p.total_stock} ${p.uom}
          </span>
          ${p.is_low_stock ? `<span class="badge badge-low-stock" style="margin-left:6px;">Low Stock (Min: ${p.min_qty})</span>` : ''}
        </td>
        <td>$${p.unit_price.toFixed(2)}</td>
        <td>
          <button class="btn btn-secondary btn-sm" onclick="viewProductLocations(${p.id})">Stock per Location</button>
          <button class="btn btn-secondary btn-sm" onclick="openEditProductModal(${p.id})">Edit</button>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    showToast('Failed to load products: ' + err.message, 'danger');
  }
}

async function viewProductLocations(productId) {
  try {
    const res = await fetch(`/api/products/${productId}/locations`);
    const data = await res.json();

    document.getElementById('modal-loc-prod-name').textContent = `${data.product.name} (${data.product.sku})`;
    const tbody = document.getElementById('modal-loc-tbody');

    if (!data.locations.length) {
      tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding: 20px;">No internal storage locations defined.</td></tr>`;
    } else {
      tbody.innerHTML = data.locations.map(loc => `
        <tr>
          <td><strong>${escapeHtml(loc.warehouse_name || 'Central')}</strong></td>
          <td>${escapeHtml(loc.location_name)}</td>
          <td><code>${loc.barcode || '-'}</code></td>
          <td style="font-weight:700; color: ${loc.quantity > 0 ? '#34d399' : 'var(--text-dim)'}">
            ${loc.quantity} ${loc.uom}
          </td>
        </tr>
      `).join('');
    }

    openModal('modal-product-locations');
  } catch (err) {
    showToast('Failed to fetch location breakdown: ' + err.message, 'danger');
  }
}

// Add New Product Form Submission
async function handleCreateProduct(e) {
  e.preventDefault();
  const form = e.target;
  const payload = {
    name: form.name.value.trim(),
    sku: form.sku.value.trim(),
    category_id: form.category_id.value ? Number(form.category_id.value) : null,
    uom: form.uom.value,
    min_qty: Number(form.min_qty.value || 10),
    max_qty: Number(form.max_qty.value || 100),
    unit_price: Number(form.unit_price.value || 0),
    initial_stock: Number(form.initial_stock.value || 0),
    initial_location_id: form.initial_location_id.value ? Number(form.initial_location_id.value) : 4
  };

  try {
    const res = await fetch('/api/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    showToast(`✓ Product "${payload.name}" created successfully!`, 'success');
    closeModal('modal-add-product');
    form.reset();
    loadProducts();
    loadDashboardData();
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

// ==========================================
// 4. STOCK ADJUSTMENTS WORKFLOW
// ==========================================

async function loadAdjustmentsView() {
  populateProductSelects();
  populateLocationSelects();

  // Load adjustment history
  try {
    const res = await fetch('/api/operations?type=adjustment');
    const adjs = await res.json();
    const tbody = document.getElementById('adjustments-tbody');
    if (!tbody) return;

    if (!adjs.length) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 20px; color: var(--text-dim);">No stock adjustments logged yet.</td></tr>`;
      return;
    }

    tbody.innerHTML = adjs.map(a => `
      <tr>
        <td><strong>${a.reference}</strong></td>
        <td>${escapeHtml(a.partner_name || 'Count Audit')}</td>
        <td>${escapeHtml(a.src_location_name || 'N/A')}</td>
        <td><small>${escapeHtml(a.notes || '-')}</small></td>
        <td><small>${new Date(a.validated_at || a.created_at).toLocaleString()}</small></td>
        <td><span class="badge badge-done">Done</span></td>
      </tr>
    `).join('');
  } catch (err) {
    showToast('Failed to load adjustments: ' + err.message, 'danger');
  }
}

// When user selects product & location in Adjustment Form, auto-fetch current recorded stock
async function handleAdjustmentSelectionChange() {
  const prodSelect = document.getElementById('adj-product-select');
  const locSelect = document.getElementById('adj-location-select');
  const recInput = document.getElementById('adj-recorded-qty');
  const countInput = document.getElementById('adj-counted-qty');
  const deltaBadge = document.getElementById('adj-delta-badge');

  const productId = prodSelect.value;
  const locationId = locSelect.value;

  if (!productId || !locationId) {
    recInput.value = '0';
    return;
  }

  try {
    const res = await fetch(`/api/adjustments/recorded-stock?product_id=${productId}&location_id=${locationId}`);
    const data = await res.json();
    recInput.value = data.recorded_qty || 0;
    calculateAdjustmentDelta();
  } catch (err) {
    console.error(err);
  }
}

function calculateAdjustmentDelta() {
  const rec = Number(document.getElementById('adj-recorded-qty').value || 0);
  const counted = Number(document.getElementById('adj-counted-qty').value || 0);
  const delta = counted - rec;

  const badge = document.getElementById('adj-delta-badge');
  if (delta === 0) {
    badge.textContent = 'Delta: 0 (No difference)';
    badge.style.color = 'var(--text-muted)';
  } else if (delta < 0) {
    badge.textContent = `Delta: ${delta} (Shortage / Scrap)`;
    badge.style.color = '#f87171';
  } else {
    badge.textContent = `Delta: +${delta} (Surplus)`;
    badge.style.color = '#34d399';
  }
}

async function handleApplyAdjustment(e) {
  e.preventDefault();
  const form = e.target;
  const payload = {
    product_id: Number(form.product_id.value),
    location_id: Number(form.location_id.value),
    counted_qty: Number(form.counted_qty.value),
    reason: form.reason.value,
    notes: form.notes.value.trim(),
    user_name: state.currentUser.name
  };

  try {
    const res = await fetch('/api/adjustments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    showToast(`✓ ${data.message}`, 'success');
    closeModal('modal-adjustment');
    form.reset();
    loadAdjustmentsView();
    loadDashboardData();
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

// ==========================================
// 5. STOCK LEDGER / MOVE HISTORY
// ==========================================

async function loadLedger() {
  try {
    const { operation_type, search } = state.ledgerFilter;
    const params = new URLSearchParams({ operation_type, search, limit: 100 });

    const res = await fetch(`/api/ledger?${params.toString()}`);
    const moves = await res.json();

    const tbody = document.getElementById('ledger-tbody');
    if (!tbody) return;

    if (!moves.length) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding: 24px; color: var(--text-dim);">No stock moves recorded.</td></tr>`;
      return;
    }

    tbody.innerHTML = moves.map(m => `
      <tr>
        <td><small>${new Date(m.timestamp).toLocaleString()}</small></td>
        <td><strong>${m.reference}</strong></td>
        <td><span class="badge badge-${m.operation_type}">${m.operation_type}</span></td>
        <td>${escapeHtml(m.product_name)} <small style="color:var(--text-dim)">(${m.product_sku})</small></td>
        <td><small style="color:var(--text-muted)">${escapeHtml(m.src_location_name || 'Vendor/External')}</small></td>
        <td><small style="color:#818cf8">${escapeHtml(m.dest_location_name || 'Customer/External')}</small></td>
        <td style="font-weight:700; color: ${m.quantity > 0 ? '#34d399' : '#f87171'}">
          ${m.quantity > 0 ? '+' : ''}${m.quantity} ${m.uom}
        </td>
        <td><small>${escapeHtml(m.user_name || 'Staff')}</small></td>
      </tr>
    `).join('');
  } catch (err) {
    showToast('Failed to load ledger: ' + err.message, 'danger');
  }
}

// ==========================================
// 6. CREATION MODALS & HELPERS
// ==========================================

function openNewOperationModal(type) {
  document.getElementById('op-modal-type').value = type;
  document.getElementById('op-modal-title').textContent = 
    type === 'receipt' ? 'New Incoming Receipt (from Vendor)' :
    type === 'delivery' ? 'New Outgoing Delivery (to Customer)' :
    'New Internal Transfer (Location to Location)';

  document.getElementById('op-partner-label').textContent = 
    type === 'receipt' ? 'Vendor / Supplier Name:' :
    type === 'delivery' ? 'Customer / Recipient Name:' :
    'Transfer Reason / Note:';

  populateProductSelects();
  populateLocationSelects();

  // Preset smart defaults for source & destination
  const srcSelect = document.getElementById('op-src-loc');
  const destSelect = document.getElementById('op-dest-loc');

  if (type === 'receipt') {
    srcSelect.value = '1'; // Vendors (Inbound)
    destSelect.value = '4'; // WH1 Main Store
  } else if (type === 'delivery') {
    srcSelect.value = '4'; // WH1 Main Store
    destSelect.value = '2'; // Customers (Outbound)
  } else if (type === 'internal') {
    srcSelect.value = '4'; // Main Store
    destSelect.value = '7'; // Production Rack
  }

  // Clear items table to 1 row
  const itemsContainer = document.getElementById('op-items-rows');
  itemsContainer.innerHTML = '';
  addOperationItemRow();

  openModal('modal-create-operation');
}

function addOperationItemRow() {
  const container = document.getElementById('op-items-rows');
  const rowId = `item-row-${Date.now()}`;
  const row = document.createElement('div');
  row.className = 'form-row';
  row.id = rowId;
  row.style.marginBottom = '8px';

  let productOptions = state.products.map(p => 
    `<option value="${p.id}">${escapeHtml(p.name)} (${p.sku}) [${p.uom}]</option>`
  ).join('');

  row.innerHTML = `
    <div>
      <select class="form-control op-product-item" required>
        ${productOptions}
      </select>
    </div>
    <div style="display:flex; gap:8px;">
      <input type="number" class="form-control op-qty-item" placeholder="Quantity" min="1" step="any" required>
      <button type="button" class="btn btn-secondary btn-sm" onclick="document.getElementById('${rowId}').remove()">✕</button>
    </div>
  `;
  container.appendChild(row);
}

async function handleCreateOperation(e) {
  e.preventDefault();
  const type = document.getElementById('op-modal-type').value;
  const partner_name = document.getElementById('op-partner-name').value.trim();
  const src_location_id = Number(document.getElementById('op-src-loc').value);
  const dest_location_id = Number(document.getElementById('op-dest-loc').value);
  const notes = document.getElementById('op-notes').value.trim();

  const prodElements = document.querySelectorAll('.op-product-item');
  const qtyElements = document.querySelectorAll('.op-qty-item');
  const items = [];

  for (let i = 0; i < prodElements.length; i++) {
    const pId = Number(prodElements[i].value);
    const qty = Number(qtyElements[i].value);
    if (pId && qty > 0) {
      items.push({ product_id: pId, qty_demanded: qty });
    }
  }

  if (!items.length) {
    showToast('Please add at least one item with valid quantity.', 'warning');
    return;
  }

  try {
    const res = await fetch('/api/operations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type,
        partner_name,
        src_location_id,
        dest_location_id,
        notes,
        created_by: state.currentUser.name,
        items
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    showToast(`✓ ${data.message}`, 'success');
    closeModal('modal-create-operation');

    if (state.currentView === 'dashboard') loadDashboardData();
    else if (state.currentView === 'receipts') loadOperationsByType('receipt');
    else if (state.currentView === 'deliveries') loadOperationsByType('delivery');
    else if (state.currentView === 'transfers') loadOperationsByType('internal');
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

// Quick Restock shortcut from low-stock card
function quickCreateReceiptForProduct(productId, productName) {
  openNewOperationModal('receipt');
  document.getElementById('op-partner-name').value = 'Primary Vendor Supplier';
  const prodSelect = document.querySelector('.op-product-item');
  if (prodSelect) prodSelect.value = productId;
  const qtyInput = document.querySelector('.op-qty-item');
  if (qtyInput) qtyInput.value = 50;
}

// Reset Demo Data
async function resetDemoData() {
  if (!confirm('Reset database back to the exact initial 4-step problem statement demonstration state?')) {
    return;
  }
  try {
    const res = await fetch('/api/system/reset-demo', { method: 'POST' });
    const data = await res.json();
    showToast('✓ ' + data.message, 'success');
    loadDashboardData();
    loadProducts();
    if (state.currentView === 'ledger') loadLedger();
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

// Populate product and location dropdowns
function populateProductSelects() {
  const options = state.products.map(p => 
    `<option value="${p.id}">${escapeHtml(p.name)} (${p.sku})</option>`
  ).join('');

  const prodSelect = document.getElementById('adj-product-select');
  if (prodSelect) prodSelect.innerHTML = `<option value="">-- Select Product --</option>` + options;
}

function populateLocationSelects() {
  fetch('/api/locations').then(r => r.json()).then(locs => {
    state.locations = locs;
    const locOptions = locs.map(l => 
      `<option value="${l.id}">${escapeHtml(l.name)} (${l.type})</option>`
    ).join('');

    const srcLoc = document.getElementById('op-src-loc');
    const destLoc = document.getElementById('op-dest-loc');
    const adjLoc = document.getElementById('adj-location-select');

    if (srcLoc) srcLoc.innerHTML = locOptions;
    if (destLoc) destLoc.innerHTML = locOptions;
    if (adjLoc) {
      const internalLocs = locs.filter(l => l.type === 'internal').map(l => 
        `<option value="${l.id}">${escapeHtml(l.name)}</option>`
      ).join('');
      adjLoc.innerHTML = `<option value="">-- Select Location --</option>` + internalLocs;
    }
  });
}

// User Profile Render
function renderProfile() {
  document.getElementById('prof-name').textContent = state.currentUser.name;
  document.getElementById('prof-email').textContent = state.currentUser.email;
  document.getElementById('prof-role').textContent = state.currentUser.role === 'inventory_manager' ? 'Inventory Manager' : 'Warehouse Staff';
  document.getElementById('prof-avatar').textContent = state.currentUser.name.charAt(0);
}

// ==========================================
// 7. AUTHENTICATION & PASSWORD RESET MODAL
// ==========================================

function openAuthModal(mode = 'login') {
  document.getElementById('auth-mode-login').style.display = mode === 'login' ? 'block' : 'none';
  document.getElementById('auth-mode-signup').style.display = mode === 'signup' ? 'block' : 'none';
  document.getElementById('auth-mode-reset').style.display = mode === 'reset' ? 'block' : 'none';
  openModal('modal-auth');
}

async function handleRequestOtp() {
  const email = document.getElementById('reset-email').value.trim();
  if (!email) {
    showToast('Please enter your email address.', 'warning');
    return;
  }
  try {
    const res = await fetch('/api/auth/request-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    showToast(`✓ OTP code generated: ${data.demoOtp}`, 'success');
    document.getElementById('reset-otp').value = data.demoOtp;
    document.getElementById('reset-step-otp').style.display = 'block';
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

async function handleResetPassword(e) {
  e.preventDefault();
  const email = document.getElementById('reset-email').value.trim();
  const otp = document.getElementById('reset-otp').value.trim();
  const newPassword = document.getElementById('reset-new-password').value;

  try {
    const res = await fetch('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, otp, newPassword })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    showToast('✓ ' + data.message, 'success');
    openAuthModal('login');
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

// Utilities
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Initial Boot
document.addEventListener('DOMContentLoaded', async () => {
  // Load Categories & Warehouses
  const [catRes, whRes] = await Promise.all([
    fetch('/api/categories'),
    fetch('/api/warehouses')
  ]);
  state.categories = await catRes.json();
  state.warehouses = await whRes.json();

  // Populate dynamic category & warehouse filter dropdowns
  const catFilter = document.getElementById('filter-category');
  if (catFilter) {
    state.categories.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.name;
      catFilter.appendChild(opt);
    });
  }

  const whFilter = document.getElementById('filter-warehouse');
  if (whFilter) {
    state.warehouses.forEach(w => {
      const opt = document.createElement('option');
      opt.value = w.id;
      opt.textContent = `${w.name} (${w.code})`;
      whFilter.appendChild(opt);
    });
  }

  // Hook dynamic filter event listeners
  document.getElementById('filter-type')?.addEventListener('change', (e) => {
    state.filters.type = e.target.value;
    loadDashboardOperations();
  });
  document.getElementById('filter-status')?.addEventListener('change', (e) => {
    state.filters.status = e.target.value;
    loadDashboardOperations();
  });
  document.getElementById('filter-warehouse')?.addEventListener('change', (e) => {
    state.filters.warehouse_id = e.target.value;
    loadDashboardOperations();
  });
  document.getElementById('filter-search')?.addEventListener('input', (e) => {
    state.filters.search = e.target.value;
    loadDashboardOperations();
  });

  // Hook Ledger filters
  document.getElementById('ledger-type-filter')?.addEventListener('change', (e) => {
    state.ledgerFilter.operation_type = e.target.value;
    loadLedger();
  });
  document.getElementById('ledger-search')?.addEventListener('input', (e) => {
    state.ledgerFilter.search = e.target.value;
    loadLedger();
  });

  // Load Initial Dashboard
  await loadProducts();
  await loadDashboardData();
  populateLocationSelects();
});
