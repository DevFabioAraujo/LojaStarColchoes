const path = require("node:path");
const sqlite3 = require("sqlite3").verbose();
const bcrypt = require("bcryptjs");
const { dataDirectory } = require("./config/paths");
const products = require("./data/products");
const { normalizeEmail, validateName, passwordError } = require("./validation");

const databasePath = path.join(dataDirectory, "star-colchoes.db");
const db = new sqlite3.Database(databasePath);
let orderQueue = Promise.resolve();

function run(sql, parameters = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, parameters, function onRun(error) {
      if (error) reject(error);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function all(sql, parameters = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, parameters, (error, rows) => error ? reject(error) : resolve(rows));
  });
}

function serializeOrder(operation) {
  const result = orderQueue.then(operation);
  orderQueue = result.catch(() => {});
  return result;
}

async function initializeDatabase() {
  await run("PRAGMA foreign_keys = ON");
  await run(`CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, description TEXT NOT NULL,
    size TEXT NOT NULL, price INTEGER NOT NULL CHECK(price >= 0), original_price INTEGER,
    badge TEXT, rating REAL NOT NULL, reviews INTEGER NOT NULL, image TEXT NOT NULL
  )`);
  await run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('customer', 'seller', 'admin')),
    session_version INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await run(`CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT, customer_name TEXT NOT NULL, email TEXT NOT NULL,
    phone TEXT NOT NULL, zip TEXT NOT NULL, address TEXT NOT NULL, city TEXT NOT NULL,
    total INTEGER NOT NULL CHECK(total >= 0), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  const orderColumns = await all("PRAGMA table_info(orders)");
  if (!orderColumns.some(column => column.name === "user_id")) {
    await run("ALTER TABLE orders ADD COLUMN user_id INTEGER REFERENCES users(id)");
  }
  await run(`CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL REFERENCES orders(id),
    product_id TEXT NOT NULL REFERENCES products(id), product_name TEXT NOT NULL,
    unit_price INTEGER NOT NULL, quantity INTEGER NOT NULL CHECK(quantity > 0)
  )`);

  for (const product of products) {
    await run(
      `INSERT OR IGNORE INTO products (id, name, category, description, size, price, original_price, badge, rating, reviews, image)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [product.id, product.name, product.category, product.description, product.size, product.price, product.original_price, product.badge, product.rating, product.reviews, product.image],
    );
  }
  await bootstrapAdmin();
}

async function bootstrapAdmin() {
  const name = process.env.BOOTSTRAP_ADMIN_NAME;
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL;
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!name && !email && !password) return;
  if (!validateName(name) || typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || passwordError(password)) {
    throw new Error("Configure BOOTSTRAP_ADMIN_NAME, BOOTSTRAP_ADMIN_EMAIL e uma BOOTSTRAP_ADMIN_PASSWORD válida.");
  }

  const normalizedEmail = normalizeEmail(email);
  const existing = await all("SELECT id, role FROM users WHERE email = ?", [normalizedEmail]);
  if (existing.length) {
    if (existing[0].role !== "admin") {
      throw new Error("O e-mail configurado para o administrador já pertence a uma conta que não é administradora.");
    }
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await run(
    "INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'admin')",
    [name.trim(), normalizedEmail, passwordHash],
  );
  console.log(`Administrador inicial configurado para ${normalizedEmail}.`);
}

function closeDatabase(callback) {
  db.close(callback);
}

module.exports = { all, run, serializeOrder, initializeDatabase, closeDatabase };
