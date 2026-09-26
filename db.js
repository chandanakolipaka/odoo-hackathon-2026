const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

// Ensure data folder exists
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'stocksense.db');
const db = new DatabaseSync(dbPath);

// Enable foreign keys
db.exec('PRAGMA foreign_keys = ON;');

/**
 * Initialize Database Tables
 */
function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'inventory_manager', -- 'inventory_manager' or 'warehouse_staff'
      warehouse_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS password_resets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      otp_code TEXT NOT NULL,
      expires_at DATETIME NOT NULL,
      used INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS warehouses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      address TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS locations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      warehouse_id INTEGER,
      name TEXT NOT NULL,
      type TEXT NOT NULL, -- 'internal', 'vendor', 'customer', 'loss', 'transit'
      barcode TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS product_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      description TEXT
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      sku TEXT UNIQUE NOT NULL,
      category_id INTEGER,
      uom TEXT NOT NULL DEFAULT 'Units', -- 'kg', 'Units', 'Meters', 'Boxes', 'Liters'
      min_qty REAL DEFAULT 10,
      max_qty REAL DEFAULT 100,
      unit_price REAL DEFAULT 0.0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (category_id) REFERENCES product_categories(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS stock_quants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      location_id INTEGER NOT NULL,
      quantity REAL NOT NULL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(product_id, location_id),
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
      FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS operations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reference TEXT UNIQUE NOT NULL,
      type TEXT NOT NULL, -- 'receipt', 'delivery', 'internal', 'adjustment'
      status TEXT NOT NULL DEFAULT 'draft', -- 'draft', 'waiting', 'ready', 'done', 'canceled'
      partner_name TEXT, -- Supplier for receipt, Customer for delivery, Reason for adjustment
      src_location_id INTEGER,
      dest_location_id INTEGER,
      warehouse_id INTEGER,
      notes TEXT,
      created_by TEXT DEFAULT 'Inventory Manager',
      scheduled_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      validated_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (src_location_id) REFERENCES locations(id) ON DELETE SET NULL,
      FOREIGN KEY (dest_location_id) REFERENCES locations(id) ON DELETE SET NULL,
      FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS operation_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      operation_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      qty_demanded REAL NOT NULL,
      qty_done REAL NOT NULL DEFAULT 0,
      picked INTEGER DEFAULT 0,
      packed INTEGER DEFAULT 0,
      FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS stock_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      operation_id INTEGER,
      reference TEXT NOT NULL,
      operation_type TEXT NOT NULL, -- 'receipt', 'delivery', 'internal', 'adjustment', 'initial'
      product_id INTEGER NOT NULL,
      product_name TEXT NOT NULL,
      product_sku TEXT NOT NULL,
      src_location_id INTEGER,
      src_location_name TEXT,
      dest_location_id INTEGER,
      dest_location_name TEXT,
      quantity REAL NOT NULL,
      uom TEXT NOT NULL,
      user_name TEXT DEFAULT 'System',
      notes TEXT,
      FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE SET NULL,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    );
  `);
}

/**
 * Seed sample & benchmark data matching the exact example in problem statement
 */
function seedInitialData(force = false) {
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  if (userCount > 0 && !force) {
    return; // Already seeded
  }

  // Clear existing if force
  if (force) {
    db.exec(`
      DELETE FROM stock_ledger;
      DELETE FROM operation_items;
      DELETE FROM operations;
      DELETE FROM stock_quants;
      DELETE FROM products;
      DELETE FROM product_categories;
      DELETE FROM users;
      DELETE FROM locations;
      DELETE FROM warehouses;
      DELETE FROM password_resets;
      DELETE FROM sqlite_sequence;
    `);
  }

  // 1. Warehouses (Inserted first so foreign keys exist)
  const insertWH = db.prepare(`
    INSERT INTO warehouses (code, name, address) VALUES (?, ?, ?)
  `);
  const wh1 = insertWH.run('WH1', 'Main Central Warehouse', 'Sector 14, Industrial Park, Hub A');
  const wh2 = insertWH.run('WH2', 'Production & Assembly Plant', 'Zone B, North Logistics Park');
  const wh1Id = wh1.lastInsertRowid;
  const wh2Id = wh2.lastInsertRowid;

  // 2. Users (Default Manager and Staff)
  const insertUser = db.prepare(`
    INSERT INTO users (name, email, password_hash, role, warehouse_id)
    VALUES (?, ?, ?, ?, ?)
  `);
  insertUser.run('Sarah Connor', 'manager@stocksense.com', 'admin123', 'inventory_manager', wh1Id);
  insertUser.run('Alex Mercer', 'staff@stocksense.com', 'staff123', 'warehouse_staff', wh1Id);

  // 3. Locations (Internal + Virtual)
  const insertLoc = db.prepare(`
    INSERT INTO locations (warehouse_id, name, type, barcode) VALUES (?, ?, ?, ?)
  `);
  // Virtual locations
  const locVend = insertLoc.run(null, 'Vendors (Inbound Partner)', 'vendor', 'VIRT-VEND').lastInsertRowid; // Virtual
  const locCust = insertLoc.run(null, 'Customers (Outbound Partner)', 'customer', 'VIRT-CUST').lastInsertRowid; // Virtual
  const locScrap = insertLoc.run(null, 'Inventory Loss & Scrap', 'loss', 'VIRT-SCRAP').lastInsertRowid; // Virtual
  
  // WH1 Locations
  const locMainStore = insertLoc.run(wh1Id, 'Main Store (WH1/Stock)', 'internal', 'WH1-STORE-01').lastInsertRowid;
  const locRackA = insertLoc.run(wh1Id, 'Rack A (Raw Racks)', 'internal', 'WH1-RACK-A').lastInsertRowid;
  const locRackB = insertLoc.run(wh1Id, 'Rack B (Storage)', 'internal', 'WH1-RACK-B').lastInsertRowid;
  
  // WH2 Locations
  const locProdRack = insertLoc.run(wh2Id, 'Production Rack (WH2/Prod)', 'internal', 'WH2-PROD-RACK').lastInsertRowid;
  const locAssm = insertLoc.run(wh2Id, 'Assembly Floor (WH2/Floor)', 'internal', 'WH2-ASSM-01').lastInsertRowid;

  // 4. Product Categories
  const insertCat = db.prepare('INSERT INTO product_categories (name, description) VALUES (?, ?)');
  insertCat.run('Raw Materials', 'Unprocessed base items for production');
  insertCat.run('Finished Goods', 'Manufactured final items ready for delivery');
  insertCat.run('Furniture', 'Office and warehouse ergonomic furniture');
  insertCat.run('Hardware & Fasteners', 'Bolts, nuts, fixtures, and accessories');

  // 5. Products
  const insertProd = db.prepare(`
    INSERT INTO products (name, sku, category_id, uom, min_qty, max_qty, unit_price)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  insertProd.run('Steel Rods (Industrial Grade)', 'STL-100', 1, 'kg', 25.0, 250.0, 4.50); // ID: 1
  insertProd.run('Steel Frames (Reinforced)', 'FRM-200', 2, 'Units', 10.0, 60.0, 45.00); // ID: 2
  insertProd.run('Ergonomic Mesh Chair', 'CHR-010', 3, 'Units', 5.0, 30.0, 110.00); // ID: 3
  insertProd.run('Industrial Screws M8 (100pk)', 'SCR-880', 4, 'Boxes', 15.0, 100.0, 12.50); // ID: 4
  insertProd.run('Oak Wood Planks', 'WOD-050', 1, 'Meters', 20.0, 120.0, 8.00); // ID: 5

  // 6. EXACT DEMONSTRATION WORKFLOW FROM PROBLEM STATEMENT (Pages 3 & 4)
  // Step 1: Receive Goods from Vendor: Receive 100 kg Steel -> Stock: +100
  // Step 2: Internal Transfer: Main Store -> Production Rack -> Stock unchanged in total, but location updated
  // Step 3: Deliver finished goods: Deliver 20 steel -> Stock: -20
  // Step 4: Adjust damaged items: 3 kg steel damaged -> Stock: -3 (Remaining: 77 kg in Production Rack)

  // Step 1: Receipt (Vendor -> Main Store, +100 kg)
  const op1 = db.prepare(`
    INSERT INTO operations (reference, type, status, partner_name, src_location_id, dest_location_id, warehouse_id, notes, created_by, scheduled_date, validated_at)
    VALUES ('REC-2026-0001', 'receipt', 'done', 'Alpha Metals & Steel Ltd', 1, 4, 1, 'Initial steel vendor batch delivery', 'Sarah Connor', datetime('now', '-3 days'), datetime('now', '-3 days'))
  `).run();
  const op1Id = op1.lastInsertRowid;
  db.prepare(`
    INSERT INTO operation_items (operation_id, product_id, qty_demanded, qty_done, picked, packed)
    VALUES (?, 1, 100, 100, 1, 1)
  `).run(op1Id);
  db.prepare(`
    INSERT INTO stock_ledger (timestamp, operation_id, reference, operation_type, product_id, product_name, product_sku, src_location_id, src_location_name, dest_location_id, dest_location_name, quantity, uom, user_name, notes)
    VALUES (datetime('now', '-3 days'), ?, 'REC-2026-0001', 'receipt', 1, 'Steel Rods (Industrial Grade)', 'STL-100', 1, 'Vendors (Inbound Partner)', 4, 'Main Store (WH1/Stock)', 100, 'kg', 'Sarah Connor', 'Step 1: Received 100 kg Steel from Vendor')
  `).run(op1Id);

  // Step 2: Internal Transfer (Main Store -> Production Rack, 100 kg)
  const op2 = db.prepare(`
    INSERT INTO operations (reference, type, status, partner_name, src_location_id, dest_location_id, warehouse_id, notes, created_by, scheduled_date, validated_at)
    VALUES ('INT-2026-0001', 'internal', 'done', 'Internal Shopfloor Movement', 4, 7, 2, 'Move raw steel to production rack for fabrication', 'Alex Mercer', datetime('now', '-2 days'), datetime('now', '-2 days'))
  `).run();
  const op2Id = op2.lastInsertRowid;
  db.prepare(`
    INSERT INTO operation_items (operation_id, product_id, qty_demanded, qty_done, picked, packed)
    VALUES (?, 1, 100, 100, 1, 1)
  `).run(op2Id);
  db.prepare(`
    INSERT INTO stock_ledger (timestamp, operation_id, reference, operation_type, product_id, product_name, product_sku, src_location_id, src_location_name, dest_location_id, dest_location_name, quantity, uom, user_name, notes)
    VALUES (datetime('now', '-2 days'), ?, 'INT-2026-0001', 'internal', 1, 'Steel Rods (Industrial Grade)', 'STL-100', 4, 'Main Store (WH1/Stock)', 7, 'Production Rack (WH2/Prod)', 100, 'kg', 'Alex Mercer', 'Step 2: Internal transfer: Main Store -> Production Rack')
  `).run(op2Id);

  // Step 3: Deliver finished goods / steel (Production Rack -> Customers, 20 kg)
  const op3 = db.prepare(`
    INSERT INTO operations (reference, type, status, partner_name, src_location_id, dest_location_id, warehouse_id, notes, created_by, scheduled_date, validated_at)
    VALUES ('DEL-2026-0001', 'delivery', 'done', 'Apex Infrastructure Corp', 7, 2, 2, 'Customer shipment: order for 20 kg steel frames material', 'Alex Mercer', datetime('now', '-1 day'), datetime('now', '-1 day'))
  `).run();
  const op3Id = op3.lastInsertRowid;
  db.prepare(`
    INSERT INTO operation_items (operation_id, product_id, qty_demanded, qty_done, picked, packed)
    VALUES (?, 1, 20, 20, 1, 1)
  `).run(op3Id);
  db.prepare(`
    INSERT INTO stock_ledger (timestamp, operation_id, reference, operation_type, product_id, product_name, product_sku, src_location_id, src_location_name, dest_location_id, dest_location_name, quantity, uom, user_name, notes)
    VALUES (datetime('now', '-1 day'), ?, 'DEL-2026-0001', 'delivery', 1, 'Steel Rods (Industrial Grade)', 'STL-100', 7, 'Production Rack (WH2/Prod)', 2, 'Customers (Outbound Partner)', -20, 'kg', 'Alex Mercer', 'Step 3: Deliver finished goods: Deliver 20 steel')
  `).run(op3Id);

  // Step 4: Adjust damaged items (Production Rack -> Scrap/Loss, 3 kg)
  const op4 = db.prepare(`
    INSERT INTO operations (reference, type, status, partner_name, src_location_id, dest_location_id, warehouse_id, notes, created_by, scheduled_date, validated_at)
    VALUES ('ADJ-2026-0001', 'adjustment', 'done', 'Damaged in shopfloor handling', 7, 3, 2, 'Physical count revealed 3 kg bent/corroded rods during inspection', 'Sarah Connor', datetime('now', '-6 hours'), datetime('now', '-6 hours'))
  `).run();
  const op4Id = op4.lastInsertRowid;
  db.prepare(`
    INSERT INTO operation_items (operation_id, product_id, qty_demanded, qty_done, picked, packed)
    VALUES (?, 1, 3, 3, 1, 1)
  `).run(op4Id);
  db.prepare(`
    INSERT INTO stock_ledger (timestamp, operation_id, reference, operation_type, product_id, product_name, product_sku, src_location_id, src_location_name, dest_location_id, dest_location_name, quantity, uom, user_name, notes)
    VALUES (datetime('now', '-6 hours'), ?, 'ADJ-2026-0001', 'adjustment', 1, 'Steel Rods (Industrial Grade)', 'STL-100', 7, 'Production Rack (WH2/Prod)', 3, 'Inventory Loss & Scrap', -3, 'kg', 'Sarah Connor', 'Step 4: 3 kg steel damaged -> Stock: -3')
  `).run(op4Id);

  // Set final Quant for Steel Rods: 100 - 100 + 100 - 20 - 3 = 77 kg at Production Rack!
  db.prepare(`INSERT OR REPLACE INTO stock_quants (product_id, location_id, quantity) VALUES (1, 7, 77)`).run();
  db.prepare(`INSERT OR REPLACE INTO stock_quants (product_id, location_id, quantity) VALUES (1, 4, 0)`).run();

  // Additional realistic initial stocks:
  // Product 2: Steel Frames (18 units in Assembly Floor)
  db.prepare(`INSERT OR REPLACE INTO stock_quants (product_id, location_id, quantity) VALUES (2, 8, 18)`).run();
  db.prepare(`
    INSERT INTO stock_ledger (timestamp, operation_id, reference, operation_type, product_id, product_name, product_sku, src_location_id, src_location_name, dest_location_id, dest_location_name, quantity, uom, user_name, notes)
    VALUES (datetime('now', '-4 days'), NULL, 'INIT-002', 'initial', 2, 'Steel Frames (Reinforced)', 'FRM-200', 1, 'Vendors (Inbound Partner)', 8, 'Assembly Floor (WH2/Floor)', 18, 'Units', 'System', 'Initial physical count')
  `).run();

  // Product 3: Ergonomic Mesh Chair (Only 3 units in Main Store -> Low stock alert!)
  db.prepare(`INSERT OR REPLACE INTO stock_quants (product_id, location_id, quantity) VALUES (3, 4, 3)`).run();
  db.prepare(`
    INSERT INTO stock_ledger (timestamp, operation_id, reference, operation_type, product_id, product_name, product_sku, src_location_id, src_location_name, dest_location_id, dest_location_name, quantity, uom, user_name, notes)
    VALUES (datetime('now', '-4 days'), NULL, 'INIT-003', 'initial', 3, 'Ergonomic Mesh Chair', 'CHR-010', 1, 'Vendors (Inbound Partner)', 4, 'Main Store (WH1/Stock)', 3, 'Units', 'System', 'Low stock alert threshold (3 < min 5)')
  `).run();

  // Product 4: Industrial Screws (45 boxes in Rack B)
  db.prepare(`INSERT OR REPLACE INTO stock_quants (product_id, location_id, quantity) VALUES (4, 6, 45)`).run();
  // Product 5: Oak Wood Planks (30 meters in Rack A)
  db.prepare(`INSERT OR REPLACE INTO stock_quants (product_id, location_id, quantity) VALUES (5, 5, 30)`).run();

  // 7. Active Pending Operations for Dashboard KPIs & Filters:
  // Pending Receipt: Draft
  const opRecPending = db.prepare(`
    INSERT INTO operations (reference, type, status, partner_name, src_location_id, dest_location_id, warehouse_id, notes, created_by, scheduled_date)
    VALUES ('REC-2026-0002', 'receipt', 'ready', 'Titanium Hardware Corp', 1, 6, 1, 'Vendor shipment arriving this afternoon', 'Sarah Connor', datetime('now', '+4 hours'))
  `).run();
  db.prepare(`
    INSERT INTO operation_items (operation_id, product_id, qty_demanded, qty_done, picked, packed)
    VALUES (?, 4, 40, 0, 0, 0)
  `).run(opRecPending.lastInsertRowid);

  // Pending Delivery: Waiting / Ready
  const opDelPending = db.prepare(`
    INSERT INTO operations (reference, type, status, partner_name, src_location_id, dest_location_id, warehouse_id, notes, created_by, scheduled_date)
    VALUES ('DEL-2026-0002', 'delivery', 'waiting', 'Urban Workspace Inc', 4, 2, 1, 'Sales Order SO-991: 2 Mesh Chairs for branch office', 'Alex Mercer', datetime('now', '+1 day'))
  `).run();
  db.prepare(`
    INSERT INTO operation_items (operation_id, product_id, qty_demanded, qty_done, picked, packed)
    VALUES (?, 3, 2, 0, 0, 0)
  `).run(opDelPending.lastInsertRowid);

  // Pending Internal Transfer: Scheduled / Draft
  const opIntPending = db.prepare(`
    INSERT INTO operations (reference, type, status, partner_name, src_location_id, dest_location_id, warehouse_id, notes, created_by, scheduled_date)
    VALUES ('INT-2026-0002', 'internal', 'ready', 'Replenishment WH1 -> WH2', 6, 7, 2, 'Transfer fasteners to production rack', 'Alex Mercer', datetime('now', '+2 days'))
  `).run();
  db.prepare(`
    INSERT INTO operation_items (operation_id, product_id, qty_demanded, qty_done, picked, packed)
    VALUES (?, 4, 15, 0, 0, 0)
  `).run(opIntPending.lastInsertRowid);
}

initSchema();
seedInitialData();

module.exports = {
  db,
  seedInitialData
};
