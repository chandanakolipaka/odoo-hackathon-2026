const express = require('express');
const cors = require('cors');
const path = require('node:path');
const { db, seedInitialData } = require('./db.js');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Helper to generate reference numbers
function generateReference(type) {
  const year = new Date().getFullYear();
  let prefix = 'OP';
  if (type === 'receipt') prefix = 'REC';
  else if (type === 'delivery') prefix = 'DEL';
  else if (type === 'internal') prefix = 'INT';
  else if (type === 'adjustment') prefix = 'ADJ';

  const countRow = db.prepare('SELECT COUNT(*) as c FROM operations WHERE type = ?').get(type);
  const nextNum = (countRow.c + 1).toString().padStart(4, '0');
  return `${prefix}-${year}-${nextNum}`;
}

// ==========================================
// 1. AUTHENTICATION & PASSWORD RESET
// ==========================================

// Login
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || user.password_hash !== password) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  // Simulated JWT/session token
  const token = `token_${user.id}_${Date.now()}`;
  res.json({
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      warehouse_id: user.warehouse_id
    }
  });
});

// Signup
app.post('/api/auth/signup', (req, res) => {
  const { name, email, password, role = 'warehouse_staff', warehouse_id = 1 } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email, and password are required' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) {
    return res.status(400).json({ error: 'Email already registered' });
  }

  const insert = db.prepare(`
    INSERT INTO users (name, email, password_hash, role, warehouse_id)
    VALUES (?, ?, ?, ?, ?)
  `);
  const result = insert.run(name, email, password, role, warehouse_id);
  const userId = result.lastInsertRowid;

  const token = `token_${userId}_${Date.now()}`;
  res.json({
    token,
    user: { id: userId, name, email, role, warehouse_id }
  });
});

// Request OTP for Password Reset
app.post('/api/auth/request-otp', (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  const user = db.prepare('SELECT id, name FROM users WHERE email = ?').get(email);
  if (!user) {
    return res.status(404).json({ error: 'User with this email not found' });
  }

  // Generate 6-digit random OTP
  const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
  // Expires in 15 minutes
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  db.prepare(`
    INSERT INTO password_resets (email, otp_code, expires_at, used)
    VALUES (?, ?, ?, 0)
  `).run(email, otpCode, expiresAt);

  console.log(`[AUTH] Generated OTP for ${email}: ${otpCode}`);

  res.json({
    success: true,
    message: 'OTP has been dispatched. (In demo environment, see demoOtp below)',
    demoOtp: otpCode
  });
});

// Reset Password with OTP
app.post('/api/auth/reset-password', (req, res) => {
  const { email, otp, newPassword } = req.body;
  if (!email || !otp || !newPassword) {
    return res.status(400).json({ error: 'Email, OTP, and new password are required' });
  }

  const resetRecord = db.prepare(`
    SELECT * FROM password_resets 
    WHERE email = ? AND otp_code = ? AND used = 0 AND datetime(expires_at) >= datetime('now')
    ORDER BY id DESC LIMIT 1
  `).get(email, otp);

  if (!resetRecord) {
    return res.status(400).json({ error: 'Invalid or expired OTP code' });
  }

  // Mark OTP used and update user password
  db.prepare('UPDATE password_resets SET used = 1 WHERE id = ?').run(resetRecord.id);
  db.prepare('UPDATE users SET password_hash = ? WHERE email = ?').run(newPassword, email);

  res.json({ success: true, message: 'Password reset successfully. You can now login.' });
});

// ==========================================
// 2. DASHBOARD VIEW & DYNAMIC KPIS
// ==========================================

app.get('/api/dashboard/kpis', (req, res) => {
  try {
    // 1. Total Products in Stock (distinct products with positive quantity in internal locations)
    const totalProductsRow = db.prepare(`
      SELECT COUNT(DISTINCT q.product_id) as count, COALESCE(SUM(q.quantity), 0) as total_units
      FROM stock_quants q
      JOIN locations l ON q.location_id = l.id
      WHERE l.type = 'internal' AND q.quantity > 0
    `).get();

    // 2. Low Stock / Out of Stock Items
    const lowStockProducts = db.prepare(`
      SELECT p.id, p.name, p.sku, p.min_qty, p.uom,
             COALESCE(SUM(q.quantity), 0) as current_stock
      FROM products p
      LEFT JOIN stock_quants q ON p.id = q.product_id
      LEFT JOIN locations l ON q.location_id = l.id AND l.type = 'internal'
      GROUP BY p.id
      HAVING current_stock <= p.min_qty
    `).all();

    // 3. Pending Receipts (draft, waiting, ready)
    const pendingReceipts = db.prepare(`
      SELECT COUNT(*) as count FROM operations
      WHERE type = 'receipt' AND status IN ('draft', 'waiting', 'ready')
    `).get().count;

    // 4. Pending Deliveries (draft, waiting, ready)
    const pendingDeliveries = db.prepare(`
      SELECT COUNT(*) as count FROM operations
      WHERE type = 'delivery' AND status IN ('draft', 'waiting', 'ready')
    `).get().count;

    // 5. Internal Transfers Scheduled (draft, waiting, ready)
    const scheduledTransfers = db.prepare(`
      SELECT COUNT(*) as count FROM operations
      WHERE type = 'internal' AND status IN ('draft', 'waiting', 'ready')
    `).get().count;

    res.json({
      totalProductsInStock: totalProductsRow.count,
      totalStockUnits: totalProductsRow.total_units,
      lowStockItemsCount: lowStockProducts.length,
      lowStockItems: lowStockProducts,
      pendingReceipts,
      pendingDeliveries,
      scheduledTransfers
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Dynamic Operations Query for Dashboard Table & Filtering
app.get('/api/dashboard/operations', (req, res) => {
  try {
    const { type, status, warehouse_id, category_id, search } = req.query;

    let query = `
      SELECT o.*, 
             sl.name as src_location_name,
             dl.name as dest_location_name,
             w.name as warehouse_name,
             (SELECT COUNT(*) FROM operation_items WHERE operation_id = o.id) as item_count,
             (SELECT GROUP_CONCAT(p.name || ' (' || oi.qty_demanded || ' ' || p.uom || ')', ', ')
              FROM operation_items oi 
              JOIN products p ON oi.product_id = p.id 
              WHERE oi.operation_id = o.id) as items_summary
      FROM operations o
      LEFT JOIN locations sl ON o.src_location_id = sl.id
      LEFT JOIN locations dl ON o.dest_location_id = dl.id
      LEFT JOIN warehouses w ON o.warehouse_id = w.id
      WHERE 1=1
    `;
    const params = [];

    if (type && type !== 'all') {
      query += ` AND o.type = ?`;
      params.push(type);
    }
    if (status && status !== 'all') {
      query += ` AND o.status = ?`;
      params.push(status);
    }
    if (warehouse_id && warehouse_id !== 'all') {
      query += ` AND o.warehouse_id = ?`;
      params.push(warehouse_id);
    }
    if (search) {
      query += ` AND (o.reference LIKE ? OR o.partner_name LIKE ? OR o.notes LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    query += ` ORDER BY o.id DESC`;

    const operations = db.prepare(query).all(...params);
    res.json(operations);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Category Stock Distribution & Insights
app.get('/api/dashboard/stats', (req, res) => {
  try {
    const categoriesStats = db.prepare(`
      SELECT c.name as category, COUNT(DISTINCT p.id) as product_count,
             COALESCE(SUM(q.quantity), 0) as total_quantity
      FROM product_categories c
      LEFT JOIN products p ON c.id = p.category_id
      LEFT JOIN stock_quants q ON p.id = q.product_id
      LEFT JOIN locations l ON q.location_id = l.id AND l.type = 'internal'
      GROUP BY c.id
    `).all();

    const recentMoves = db.prepare(`
      SELECT * FROM stock_ledger 
      ORDER BY id DESC LIMIT 8
    `).all();

    res.json({
      categoriesStats,
      recentMoves
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 3. PRODUCTS MANAGEMENT & STOCK PER LOCATION
// ==========================================

// Get All Products with Stock Overview & Low Stock Flag
app.get('/api/products', (req, res) => {
  try {
    const { search, category_id, low_stock } = req.query;

    let query = `
      SELECT p.*, c.name as category_name,
             COALESCE(SUM(q.quantity), 0) as total_stock,
             CASE WHEN COALESCE(SUM(q.quantity), 0) <= p.min_qty THEN 1 ELSE 0 END as is_low_stock
      FROM products p
      LEFT JOIN product_categories c ON p.category_id = c.id
      LEFT JOIN stock_quants q ON p.id = q.product_id
      LEFT JOIN locations l ON q.location_id = l.id AND l.type = 'internal'
      WHERE 1=1
    `;
    const params = [];

    if (search) {
      query += ` AND (p.name LIKE ? OR p.sku LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`);
    }
    if (category_id && category_id !== 'all') {
      query += ` AND p.category_id = ?`;
      params.push(category_id);
    }

    query += ` GROUP BY p.id`;

    if (low_stock === 'true') {
      query += ` HAVING is_low_stock = 1`;
    }

    query += ` ORDER BY p.name ASC`;

    const products = db.prepare(query).all(...params);
    res.json(products);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create Product with Optional Initial Stock
app.post('/api/products', (req, res) => {
  try {
    const {
      name,
      sku,
      category_id,
      uom = 'Units',
      min_qty = 10,
      max_qty = 100,
      unit_price = 0.0,
      initial_stock = 0,
      initial_location_id = 4 // Default to WH1 Main Store
    } = req.body;

    if (!name || !sku) {
      return res.status(400).json({ error: 'Product name and SKU are required' });
    }

    const existingSku = db.prepare('SELECT id FROM products WHERE sku = ?').get(sku);
    if (existingSku) {
      return res.status(400).json({ error: `SKU "${sku}" is already in use.` });
    }

    const insert = db.prepare(`
      INSERT INTO products (name, sku, category_id, uom, min_qty, max_qty, unit_price)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const result = insert.run(name, sku, category_id, uom, min_qty, max_qty, unit_price);
    const productId = result.lastInsertRowid;

    // Handle initial stock if specified
    if (Number(initial_stock) > 0 && initial_location_id) {
      const loc = db.prepare('SELECT name FROM locations WHERE id = ?').get(initial_location_id);
      db.prepare(`
        INSERT OR REPLACE INTO stock_quants (product_id, location_id, quantity)
        VALUES (?, ?, ?)
      `).run(productId, initial_location_id, Number(initial_stock));

      db.prepare(`
        INSERT INTO stock_ledger (
          timestamp, operation_id, reference, operation_type,
          product_id, product_name, product_sku,
          src_location_id, src_location_name,
          dest_location_id, dest_location_name,
          quantity, uom, user_name, notes
        ) VALUES (
          datetime('now'), NULL, 'INIT-' || ?, 'initial',
          ?, ?, ?,
          1, 'Vendors (Inbound Partner)',
          ?, ?,
          ?, ?, 'System', 'Initial Stock on Product Creation'
        )
      `).run(productId, productId, name, sku, initial_location_id, loc ? loc.name : 'Store', Number(initial_stock), uom);
    }

    res.status(201).json({ id: productId, name, sku, message: 'Product created successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update Product
app.put('/api/products/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { name, sku, category_id, uom, min_qty, max_qty, unit_price } = req.body;

    const existing = db.prepare('SELECT id FROM products WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: 'Product not found' });
    }

    db.prepare(`
      UPDATE products
      SET name = ?, sku = ?, category_id = ?, uom = ?, min_qty = ?, max_qty = ?, unit_price = ?
      WHERE id = ?
    `).run(name, sku, category_id, uom, min_qty, max_qty, unit_price, id);

    res.json({ message: 'Product updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Stock Availability Per Location for a Product
app.get('/api/products/:id/locations', (req, res) => {
  try {
    const { id } = req.params;
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const locationsStock = db.prepare(`
      SELECT l.id as location_id, l.name as location_name, l.barcode, l.type as location_type,
             w.name as warehouse_name, w.code as warehouse_code,
             COALESCE(q.quantity, 0) as quantity,
             p.uom
      FROM locations l
      LEFT JOIN warehouses w ON l.warehouse_id = w.id
      LEFT JOIN stock_quants q ON l.id = q.location_id AND q.product_id = ?
      CROSS JOIN products p ON p.id = ?
      WHERE l.type = 'internal'
      ORDER BY w.name, l.name
    `).all(id, id);

    res.json({
      product,
      locations: locationsStock
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Categories list
app.get('/api/categories', (req, res) => {
  const categories = db.prepare('SELECT * FROM product_categories ORDER BY name ASC').all();
  res.json(categories);
});

// ==========================================
// 4. OPERATIONS MODULE (Receipts, Deliveries, Transfers, Adjustments)
// ==========================================

// Get All Operations
app.get('/api/operations', (req, res) => {
  try {
    const { type, status } = req.query;
    let query = `
      SELECT o.*,
             sl.name as src_location_name,
             dl.name as dest_location_name,
             w.name as warehouse_name
      FROM operations o
      LEFT JOIN locations sl ON o.src_location_id = sl.id
      LEFT JOIN locations dl ON o.dest_location_id = dl.id
      LEFT JOIN warehouses w ON o.warehouse_id = w.id
      WHERE 1=1
    `;
    const params = [];
    if (type) {
      query += ` AND o.type = ?`;
      params.push(type);
    }
    if (status) {
      query += ` AND o.status = ?`;
      params.push(status);
    }
    query += ` ORDER BY o.id DESC`;

    const operations = db.prepare(query).all(...params);
    res.json(operations);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get Single Operation Detail
app.get('/api/operations/:id', (req, res) => {
  try {
    const { id } = req.params;
    const operation = db.prepare(`
      SELECT o.*,
             sl.name as src_location_name,
             dl.name as dest_location_name,
             w.name as warehouse_name
      FROM operations o
      LEFT JOIN locations sl ON o.src_location_id = sl.id
      LEFT JOIN locations dl ON o.dest_location_id = dl.id
      LEFT JOIN warehouses w ON o.warehouse_id = w.id
      WHERE o.id = ?
    `).get(id);

    if (!operation) {
      return res.status(404).json({ error: 'Operation not found' });
    }

    const items = db.prepare(`
      SELECT oi.*, p.name as product_name, p.sku as product_sku, p.uom,
             COALESCE((SELECT quantity FROM stock_quants WHERE product_id = oi.product_id AND location_id = ?), 0) as available_at_source
      FROM operation_items oi
      JOIN products p ON oi.product_id = p.id
      WHERE oi.operation_id = ?
    `).all(operation.src_location_id, id);

    res.json({
      ...operation,
      items
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create New Operation (Receipt, Delivery, or Internal Transfer)
app.post('/api/operations', (req, res) => {
  try {
    const {
      type, // 'receipt', 'delivery', 'internal'
      partner_name,
      src_location_id,
      dest_location_id,
      warehouse_id = 1,
      notes = '',
      created_by = 'Inventory Manager',
      scheduled_date = new Date().toISOString(),
      items = [] // [{ product_id, qty_demanded }]
    } = req.body;

    if (!type || !src_location_id || !dest_location_id || !items.length) {
      return res.status(400).json({ error: 'Type, source location, destination location, and at least one item are required' });
    }

    const reference = generateReference(type);

    const insertOp = db.prepare(`
      INSERT INTO operations (
        reference, type, status, partner_name,
        src_location_id, dest_location_id, warehouse_id,
        notes, created_by, scheduled_date
      ) VALUES (?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?)
    `);

    const opResult = insertOp.run(
      reference, type, partner_name,
      src_location_id, dest_location_id, warehouse_id,
      notes, created_by, scheduled_date
    );
    const operationId = opResult.lastInsertRowid;

    const insertItem = db.prepare(`
      INSERT INTO operation_items (operation_id, product_id, qty_demanded, qty_done, picked, packed)
      VALUES (?, ?, ?, 0, 0, 0)
    `);

    for (const item of items) {
      insertItem.run(operationId, item.product_id, Number(item.qty_demanded));
    }

    res.status(201).json({
      id: operationId,
      reference,
      message: `${type.toUpperCase()} order ${reference} created in Draft status.`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delivery Multi-Step Workflow: Pick items
app.post('/api/operations/:id/pick', (req, res) => {
  try {
    const { id } = req.params;
    const op = db.prepare('SELECT * FROM operations WHERE id = ?').get(id);
    if (!op || op.type !== 'delivery') {
      return res.status(400).json({ error: 'Operation must be an active delivery order' });
    }

    db.prepare('UPDATE operation_items SET picked = 1 WHERE operation_id = ?').run(id);
    db.prepare("UPDATE operations SET status = 'ready' WHERE id = ? AND status = 'waiting'").run(id);

    res.json({ message: 'Items successfully picked from warehouse shelves.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delivery Multi-Step Workflow: Pack items
app.post('/api/operations/:id/pack', (req, res) => {
  try {
    const { id } = req.params;
    const op = db.prepare('SELECT * FROM operations WHERE id = ?').get(id);
    if (!op || op.type !== 'delivery') {
      return res.status(400).json({ error: 'Operation must be an active delivery order' });
    }

    db.prepare('UPDATE operation_items SET packed = 1 WHERE operation_id = ?').run(id);

    res.json({ message: 'Items packed and labeled for shipping.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Validate Operation (Stock Moves & Ledger Execution)
// Handles Receipts (+stock), Deliveries (-stock), and Internal Transfers (relocate stock)
app.post('/api/operations/:id/validate', (req, res) => {
  try {
    const { id } = req.params;
    const { user_name = 'Staff Member' } = req.body;

    const op = db.prepare(`
      SELECT o.*, 
             sl.name as src_name, sl.type as src_type,
             dl.name as dest_name, dl.type as dest_type
      FROM operations o
      JOIN locations sl ON o.src_location_id = sl.id
      JOIN locations dl ON o.dest_location_id = dl.id
      WHERE o.id = ?
    `).get(id);

    if (!op) {
      return res.status(404).json({ error: 'Operation not found' });
    }
    if (op.status === 'done') {
      return res.status(400).json({ error: 'Operation has already been validated and completed.' });
    }
    if (op.status === 'canceled') {
      return res.status(400).json({ error: 'Cannot validate a canceled operation.' });
    }

    const items = db.prepare(`
      SELECT oi.*, p.name as product_name, p.sku as product_sku, p.uom
      FROM operation_items oi
      JOIN products p ON oi.product_id = p.id
      WHERE oi.operation_id = ?
    `).all(id);

    // Validation Check: If source is an internal location, ensure sufficient stock exists!
    if (op.src_type === 'internal') {
      for (const item of items) {
        const quant = db.prepare(`
          SELECT quantity FROM stock_quants 
          WHERE product_id = ? AND location_id = ?
        `).get(item.product_id, op.src_location_id);

        const currentQty = quant ? quant.quantity : 0;
        if (currentQty < item.qty_demanded) {
          return res.status(400).json({
            error: `Insufficient stock for "${item.product_name}" at "${op.src_name}". Available: ${currentQty} ${item.uom}, Demanded: ${item.qty_demanded} ${item.uom}.`
          });
        }
      }
    }

    // Atomic Execution: Update Quants and write to Stock Ledger
    for (const item of items) {
      const qty = item.qty_demanded;

      // 1. Decrement Source Location (if internal)
      if (op.src_type === 'internal') {
        db.prepare(`
          INSERT INTO stock_quants (product_id, location_id, quantity)
          VALUES (?, ?, -?)
          ON CONFLICT(product_id, location_id) DO UPDATE SET
          quantity = quantity - ?,
          updated_at = CURRENT_TIMESTAMP
        `).run(item.product_id, op.src_location_id, qty, qty);
      }

      // 2. Increment Destination Location (if internal)
      if (op.dest_type === 'internal') {
        db.prepare(`
          INSERT INTO stock_quants (product_id, location_id, quantity)
          VALUES (?, ?, ?)
          ON CONFLICT(product_id, location_id) DO UPDATE SET
          quantity = quantity + ?,
          updated_at = CURRENT_TIMESTAMP
        `).run(item.product_id, op.dest_location_id, qty, qty);
      }

      // 3. Mark item done
      db.prepare(`
        UPDATE operation_items 
        SET qty_done = ?, picked = 1, packed = 1
        WHERE id = ?
      `).run(qty, item.id);

      // 4. Log in immutable Stock Ledger
      const deltaQty = (op.type === 'delivery') ? -qty : qty;
      db.prepare(`
        INSERT INTO stock_ledger (
          timestamp, operation_id, reference, operation_type,
          product_id, product_name, product_sku,
          src_location_id, src_location_name,
          dest_location_id, dest_location_name,
          quantity, uom, user_name, notes
        ) VALUES (
          datetime('now'), ?, ?, ?,
          ?, ?, ?,
          ?, ?,
          ?, ?,
          ?, ?, ?, ?
        )
      `).run(
        op.id, op.reference, op.type,
        item.product_id, item.product_name, item.product_sku,
        op.src_location_id, op.src_name,
        op.dest_location_id, op.dest_name,
        deltaQty, item.uom, user_name,
        op.notes || `Validated ${op.type} operation`
      );
    }

    // Mark Operation as Done
    db.prepare(`
      UPDATE operations
      SET status = 'done', validated_at = datetime('now')
      WHERE id = ?
    `).run(id);

    res.json({
      success: true,
      reference: op.reference,
      message: `${op.reference} successfully validated! Stock levels and ledger have been updated.`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update Status (e.g. advance to Ready, or Cancel)
app.post('/api/operations/:id/status', (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    if (!['draft', 'waiting', 'ready', 'canceled'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    db.prepare('UPDATE operations SET status = ? WHERE id = ?').run(status, id);
    res.json({ message: `Status updated to ${status}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 5. STOCK ADJUSTMENTS (Physical Count Mismatch)
// ==========================================

// Get recorded stock for product at location
app.get('/api/adjustments/recorded-stock', (req, res) => {
  try {
    const { product_id, location_id } = req.query;
    if (!product_id || !location_id) {
      return res.status(400).json({ error: 'product_id and location_id are required' });
    }

    const quant = db.prepare(`
      SELECT quantity FROM stock_quants WHERE product_id = ? AND location_id = ?
    `).get(product_id, location_id);

    res.json({ recorded_qty: quant ? quant.quantity : 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Perform Stock Adjustment
app.post('/api/adjustments', (req, res) => {
  try {
    const {
      product_id,
      location_id,
      counted_qty,
      reason = 'Physical count audit',
      notes = '',
      user_name = 'Sarah Connor'
    } = req.body;

    if (!product_id || !location_id || counted_qty === undefined) {
      return res.status(400).json({ error: 'product_id, location_id, and counted_qty are required' });
    }

    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(product_id);
    const loc = db.prepare('SELECT l.*, w.id as wh_id FROM locations l LEFT JOIN warehouses w ON l.warehouse_id = w.id WHERE l.id = ?').get(location_id);
    if (!product || !loc) {
      return res.status(404).json({ error: 'Product or Location not found' });
    }

    // Virtual scrap / loss location (ID: 3)
    const scrapLoc = db.prepare("SELECT * FROM locations WHERE type = 'loss' LIMIT 1").get();
    const scrapLocId = scrapLoc ? scrapLoc.id : 3;
    const scrapLocName = scrapLoc ? scrapLoc.name : 'Inventory Loss & Scrap';

    // Current recorded quantity
    const quant = db.prepare('SELECT quantity FROM stock_quants WHERE product_id = ? AND location_id = ?').get(product_id, location_id);
    const recordedQty = quant ? quant.quantity : 0;
    const delta = Number(counted_qty) - recordedQty; // Difference

    if (delta === 0) {
      return res.json({ message: 'Counted quantity equals recorded stock. No adjustment needed.' });
    }

    const reference = generateReference('adjustment');

    // Create adjustment operation record
    const insertOp = db.prepare(`
      INSERT INTO operations (
        reference, type, status, partner_name,
        src_location_id, dest_location_id, warehouse_id,
        notes, created_by, scheduled_date, validated_at
      ) VALUES (?, 'adjustment', 'done', ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `);

    const srcId = delta < 0 ? location_id : scrapLocId;
    const destId = delta < 0 ? scrapLocId : location_id;

    const opResult = insertOp.run(
      reference, reason, srcId, destId, loc.wh_id,
      `Physical count mismatch: ${recordedQty} -> ${counted_qty} (${delta > 0 ? '+' : ''}${delta} ${product.uom}). ${notes}`,
      user_name, new Date().toISOString()
    );
    const opId = opResult.lastInsertRowid;

    // Operation items
    db.prepare(`
      INSERT INTO operation_items (operation_id, product_id, qty_demanded, qty_done, picked, packed)
      VALUES (?, ?, ?, ?, 1, 1)
    `).run(opId, product_id, Math.abs(delta), Math.abs(delta));

    // Update stock quant atomically to the physical count
    db.prepare(`
      INSERT INTO stock_quants (product_id, location_id, quantity)
      VALUES (?, ?, ?)
      ON CONFLICT(product_id, location_id) DO UPDATE SET
      quantity = ?,
      updated_at = CURRENT_TIMESTAMP
    `).run(product_id, location_id, Number(counted_qty), Number(counted_qty));

    // Log in Stock Ledger
    db.prepare(`
      INSERT INTO stock_ledger (
        timestamp, operation_id, reference, operation_type,
        product_id, product_name, product_sku,
        src_location_id, src_location_name,
        dest_location_id, dest_location_name,
        quantity, uom, user_name, notes
      ) VALUES (
        datetime('now'), ?, ?, 'adjustment',
        ?, ?, ?,
        ?, ?,
        ?, ?,
        ?, ?, ?, ?
      )
    `).run(
      opId, reference,
      product.id, product.name, product.sku,
      srcId, delta < 0 ? loc.name : scrapLocName,
      destId, delta < 0 ? scrapLocName : loc.name,
      delta, product.uom, user_name,
      `Adjustment (${reason}): Counted ${counted_qty} vs Recorded ${recordedQty}`
    );

    res.json({
      success: true,
      reference,
      previous_qty: recordedQty,
      new_qty: Number(counted_qty),
      delta,
      message: `Stock adjusted successfully. ${reference} logged in Stock Ledger.`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 6. MOVE HISTORY / STOCK LEDGER
// ==========================================

app.get('/api/ledger', (req, res) => {
  try {
    const { product_id, operation_type, search, limit = 100 } = req.query;

    let query = `SELECT * FROM stock_ledger WHERE 1=1`;
    const params = [];

    if (product_id) {
      query += ` AND product_id = ?`;
      params.push(product_id);
    }
    if (operation_type && operation_type !== 'all') {
      query += ` AND operation_type = ?`;
      params.push(operation_type);
    }
    if (search) {
      query += ` AND (reference LIKE ? OR product_name LIKE ? OR product_sku LIKE ? OR notes LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }

    query += ` ORDER BY id DESC LIMIT ?`;
    params.push(Number(limit));

    const moves = db.prepare(query).all(...params);
    res.json(moves);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// CSV Export for Stock Ledger
app.get('/api/ledger/export', (req, res) => {
  try {
    const moves = db.prepare(`SELECT * FROM stock_ledger ORDER BY id DESC`).all();
    let csv = 'ID,Timestamp,Reference,Type,Product,SKU,From Location,To Location,Quantity,UoM,User,Notes\n';
    for (const m of moves) {
      const line = [
        m.id,
        `"${m.timestamp}"`,
        `"${m.reference}"`,
        `"${m.operation_type}"`,
        `"${(m.product_name || '').replace(/"/g, '""')}"`,
        `"${m.product_sku}"`,
        `"${(m.src_location_name || '').replace(/"/g, '""')}"`,
        `"${(m.dest_location_name || '').replace(/"/g, '""')}"`,
        m.quantity,
        `"${m.uom}"`,
        `"${m.user_name || ''}"`,
        `"${(m.notes || '').replace(/"/g, '""')}"`
      ].join(',');
      csv += line + '\n';
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="stocksense_ledger.csv"');
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 7. WAREHOUSES & LOCATIONS SETTINGS
// ==========================================

app.get('/api/warehouses', (req, res) => {
  const warehouses = db.prepare(`
    SELECT w.*, 
           (SELECT COUNT(*) FROM locations WHERE warehouse_id = w.id) as location_count
    FROM warehouses w ORDER BY w.name ASC
  `).all();
  res.json(warehouses);
});

app.post('/api/warehouses', (req, res) => {
  try {
    const { code, name, address } = req.body;
    if (!code || !name) {
      return res.status(400).json({ error: 'Warehouse code and name are required' });
    }
    const insert = db.prepare('INSERT INTO warehouses (code, name, address) VALUES (?, ?, ?)');
    const result = insert.run(code, name, address);
    res.status(201).json({ id: result.lastInsertRowid, code, name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/locations', (req, res) => {
  try {
    const { warehouse_id, type } = req.query;
    let query = `
      SELECT l.*, w.name as warehouse_name, w.code as warehouse_code
      FROM locations l
      LEFT JOIN warehouses w ON l.warehouse_id = w.id
      WHERE 1=1
    `;
    const params = [];
    if (warehouse_id && warehouse_id !== 'all') {
      query += ` AND l.warehouse_id = ?`;
      params.push(warehouse_id);
    }
    if (type) {
      query += ` AND l.type = ?`;
      params.push(type);
    }
    query += ` ORDER BY l.warehouse_id, l.name ASC`;
    const locations = db.prepare(query).all(...params);
    res.json(locations);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/locations', (req, res) => {
  try {
    const { warehouse_id, name, type = 'internal', barcode } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Location name is required' });
    }
    const insert = db.prepare('INSERT INTO locations (warehouse_id, name, type, barcode) VALUES (?, ?, ?, ?)');
    const result = insert.run(warehouse_id || null, name, type, barcode || null);
    res.status(201).json({ id: result.lastInsertRowid, name, type });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reset Demo Data
app.post('/api/system/reset-demo', (req, res) => {
  try {
    seedInitialData(true);
    res.json({ message: 'System database successfully reset to clean problem statement benchmark state.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fallback route for SPA (Express 5 compatible)
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api')) {
    return res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
  next();
});

// Start Server
app.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`  StockSense Inventory Management System (IMS) Running`);
  console.log(`  Local URL: http://localhost:${PORT}`);
  console.log(`  API Base:  http://localhost:${PORT}/api`);
  console.log(`=======================================================`);
});
