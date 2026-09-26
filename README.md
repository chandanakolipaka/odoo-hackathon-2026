# StockSense - Modular Inventory Management System (IMS)

StockSense is an enterprise-grade, modular Inventory Management System (IMS) engineered to replace manual registers, error-prone spreadsheets, and fragmented tracking tools with a centralized, real-time, double-entry stock architecture.

---

## 🎯 Architecture Overview (Odoo-Style Double-Entry Stock Engine)

In traditional inventory software, quantities are simply incremented or decremented on product rows. In **StockSense**, inventory operations adhere to the **Double-Entry Stock Ledger Paradigm**:

> **Every inventory movement is a transfer from a Source Location to a Destination Location.**

- **Vendor Receipts (Incoming Goods)**:
  `Vendors/Inbound (Virtual)` $\rightarrow$ `Main Store (Internal)`: Internal stock increases by $+Qty$.
- **Customer Deliveries (Outgoing Goods)**:
  `Main Store (Internal)` $\rightarrow$ `Customers/Outbound (Virtual)`: Internal stock decreases by $-Qty$.
- **Internal Transfers (Warehouse/Shopfloor Move)**:
  `Main Store (WH1)` $\rightarrow$ `Production Rack (WH2)`: Stock at WH1 decreases, stock at WH2 increases. Total company inventory remains constant!
- **Stock Adjustments (Audit Reconciliation)**:
  - Shortage/Scrap/Damage: `Production Rack` $\rightarrow$ `Inventory Loss & Scrap (Virtual)`: Stock decreases by damaged amount.
  - Found Surplus: `Inventory Loss & Scrap (Virtual)` $\rightarrow$ `Storage (Internal)`: Stock increases.

All movements write immutable audit entries into the **Stock Ledger**, providing a tamper-proof audit trail of timestamps, references, actors, products, locations, and quantities.

---

## 👥 Target Users & Role Perspectives

| Role | Responsibilities | Permissions & Capabilities |
| :--- | :--- | :--- |
| **Inventory Manager** | Manage overall stock, suppliers, customer orders, categories, thresholds, and audits. | Full administrative access: create/edit products, set reorder thresholds, approve adjustments, manage warehouses & locations. |
| **Warehouse Staff** | Ground operations on the shopfloor and loading docks. | Execute physical movements: pick & pack delivery orders, shelving receipts, initiate transfers, enter physical count audits. |

*You can toggle between roles dynamically using the **Perspective Switcher** (`Manager` / `Staff`) in the top navigation bar.*

---

## 🚀 Quick Start Guide

### Prerequisites
- Node.js (v18+ or v22+, tested on Node v26)
- NPM

### 1. Installation
Navigate into the `stocksense` folder:
```bash
cd stocksense
npm install
```

### 2. Start Application
```bash
npm start
# or
node server.js
```

### 3. Open in Browser
Open your browser and navigate to:
```
http://localhost:5000
```

---

## 📊 Problem Statement Benchmark Flow (Pre-Loaded & Verified)

StockSense comes pre-seeded with the exact flow outlined in the problem specification:

| Step | Operation Type | Reference | Movement Details | Resulting Stock State |
| :--- | :--- | :--- | :--- | :--- |
| **Step 1** | **Receipt** | `REC-2026-0001` | Receive 100 kg "Steel Rods" from *Alpha Metals* to **Main Store**. | Main Store: `+100 kg` |
| **Step 2** | **Internal Transfer** | `INT-2026-0001` | Move 100 kg "Steel Rods" from **Main Store** to **Production Rack**. | Main Store: `0 kg`<br>Production Rack: `100 kg`<br>*(Total company stock unchanged)* |
| **Step 3** | **Delivery Order** | `DEL-2026-0001` | Ship 20 kg "Steel Rods" to *Apex Construction* from **Production Rack**. | Production Rack: `80 kg` (`-20 kg`) |
| **Step 4** | **Stock Adjustment** | `ADJ-2026-0001` | Physical inspection reveals 3 kg damaged steel rods $\rightarrow$ count adjusted to 77 kg. | Production Rack: `77 kg` (`-3 kg` logged to Scrap) |

> 💡 **1-Click Reset**: Click the **🔄 Reset Demo** button in the header anytime to revert all data to this clean benchmark baseline.

---

## 🛠️ Core Modules & Features

### 1. Authentication & Security
- Sign Up & Log In with role-based routing.
- **OTP-Based Password Reset**: Generates a secure 6-digit OTP code with expiry and verification workflow. In demo mode, the generated OTP is automatically populated and displayed.

### 2. Operations Dashboard
- **5 Live KPI Cards**:
  1. *Total Products in Stock* (count of unique items and total aggregate units)
  2. *Low Stock / Out of Stock Items* (highlighted with visual danger indicators)
  3. *Pending Receipts* (draft & ready incoming orders)
  4. *Pending Deliveries* (draft, waiting & ready outgoing shipments)
  5. *Internal Transfers Scheduled* (active shopfloor transfer jobs)
- **Dynamic Multi-Attribute Filters**:
  - Filter by **Document Type**: Receipts / Delivery / Internal / Adjustments
  - Filter by **Status**: Draft / Waiting / Ready / Done / Canceled
  - Filter by **Warehouse / Location**
  - Filter by **Product Category**
  - Instant text search across reference IDs and partner names.

### 3. Product Management & Multi-Location Stock
- Create and edit products with SKU, Category, Unit of Measure (kg, Units, Meters, Boxes, Liters), and Unit Price.
- **Automated Reordering Rules**: Define Min Qty alert threshold and Max Qty.
- **Stock Availability per Location Modal**: View real-time breakdown of on-hand inventory across individual warehouses, racks, and assembly zones.
- **1-Click Restock Shortcut**: Instant shortcut on low-stock items to generate vendor receipts.

### 4. Operations Hub
- **Receipts**: Incoming vendor shipments $\rightarrow$ validate to automatically increment internal storage.
- **Delivery Orders (Multi-Step)**: Outgoing customer orders $\rightarrow$ **Pick** items $\rightarrow$ **Pack** items $\rightarrow$ **Validate** (decrements stock, with strict prevention against negative inventory).
- **Internal Transfers**: Relocate stock across internal zones without impacting total company holdings.
- **Stock Adjustments**: Enter physical counted quantity $\rightarrow$ system automatically calculates discrepancy ($\pm \Delta$) $\rightarrow$ updates quant and records audit move.

### 5. Move History & Stock Ledger
- Complete double-entry immutable audit ledger.
- Filter by operation type, product SKU, and keyword.
- **CSV Export**: Direct download of ledger for compliance and reporting.

### 6. Settings & Warehouses
- Multi-warehouse configuration (e.g. WH1 Central Warehouse, WH2 Production Plant).
- Hierarchical locations (Main Store, Rack A, Rack B, Production Rack, Assembly Floor, Virtual Inbound/Outbound/Scrap).

---

## 🌐 API Reference

### Auth
- `POST /api/auth/login` - Sign in (`email`, `password`)
- `POST /api/auth/signup` - Register user (`name`, `email`, `password`, `role`)
- `POST /api/auth/request-otp` - Dispatch 6-digit password reset OTP
- `POST /api/auth/reset-password` - Verify OTP and apply new password

### Dashboard & Analytics
- `GET /api/dashboard/kpis` - 5 KPI metrics and low-stock summaries
- `GET /api/dashboard/operations` - Filtered operations by type, status, warehouse, category, and search
- `GET /api/dashboard/stats` - Category stock distribution and recent moves

### Products
- `GET /api/products` - Product catalog with live stock and low-stock flags
- `POST /api/products` - Create product (supports initial stock allocation)
- `PUT /api/products/:id` - Update product details and thresholds
- `GET /api/products/:id/locations` - Breakdown of stock per warehouse rack/bin

### Operations & Ledger
- `GET /api/operations` - List operations
- `POST /api/operations` - Create new receipt, delivery, or internal transfer
- `POST /api/operations/:id/pick` - Pick items for delivery
- `POST /api/operations/:id/pack` - Pack items for delivery
- `POST /api/operations/:id/validate` - Validate operation, mutate stock quants, write ledger
- `POST /api/adjustments` - Reconcile physical count and write adjustment
- `GET /api/ledger` - Immutable audit ledger
- `GET /api/ledger/export` - Download audit ledger as CSV
- `POST /api/system/reset-demo` - Reset database to problem statement baseline

---

## 📁 Project Structure

```
stocksense/
├── server.js              # Express REST API, routes, and static SPA serving
├── db.js                  # Native SQLite (DatabaseSync) schema, double-entry quants, seed data
├── package.json           # Dependencies and scripts
├── public/
│   ├── index.html         # Single Page Application HTML markup
│   ├── css/
│   │   └── style.css      # Dark-mode styling, glassmorphism, responsive layout, animations
│   └── js/
│       └── app.js         # Frontend controller, API integration, filters, modals, role state
└── data/
    └── stocksense.db      # Persistent SQLite database file
```
