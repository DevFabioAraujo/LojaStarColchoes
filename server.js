const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const path = require("node:path");
const fs = require("node:fs");

const app = express();
const port = Number(process.env.PORT) || 3000;
const dataDirectory = path.join(__dirname, "data");
fs.mkdirSync(dataDirectory, { recursive: true });

const db = new sqlite3.Database(path.join(dataDirectory, "star-colchoes.db"));
db.run("PRAGMA foreign_keys = ON");
let orderQueue = Promise.resolve();
app.use(express.json({ limit: "30kb" }));
app.use("/css", express.static(path.join(__dirname, "css")));
app.use("/js", express.static(path.join(__dirname, "js")));

const products = [
  {
    id: "nuvem-casal", name: "Nuvem Original", category: "espuma", description: "Acolhimento macio com suporte na medida certa.", size: "Casal · 138 × 188 cm",
    price: 1899, original_price: 2299, badge: "Mais vendido", rating: 4.9, reviews: 384,
    image: "https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&w=1000&q=80",
  },
  {
    id: "essencial-queen", name: "Essencial Queen", category: "molas", description: "Molas ensacadas para noites sem interrupções.", size: "Queen · 158 × 198 cm",
    price: 2499, original_price: 2899, badge: "Mais espaço", rating: 4.8, reviews: 276,
    image: "https://images.unsplash.com/photo-1611892440504-42a792e24d32?auto=format&fit=crop&w=1000&q=80",
  },
  {
    id: "equilibrio-casal", name: "Equilíbrio Híbrido", category: "hibrido", description: "O melhor da espuma e das molas, em harmonia.", size: "Casal · 138 × 188 cm",
    price: 2799, original_price: 3199, badge: "Suporte extra", rating: 4.9, reviews: 192,
    image: "https://images.unsplash.com/photo-1631049307264-da0ec9d70304?auto=format&fit=crop&w=1000&q=80",
  },
  {
    id: "sereno-solteiro", name: "Sereno", category: "espuma", description: "Conforto inteligente para o seu espaço.", size: "Solteiro · 88 × 188 cm",
    price: 1299, original_price: 1499, badge: "Ótimo começo", rating: 4.7, reviews: 143,
    image: "https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&w=1000&q=80&sat=-30",
  },
  {
    id: "brisa-queen", name: "Brisa Premium", category: "molas", description: "Frescor e independência de movimento a noite toda.", size: "Queen · 158 × 198 cm",
    price: 3299, original_price: 3799, badge: "Toque refrescante", rating: 4.9, reviews: 218,
    image: "https://images.unsplash.com/photo-1616594039964-ae9021a400a0?auto=format&fit=crop&w=1000&q=80",
  },
  {
    id: "aurora-king", name: "Aurora King", category: "hibrido", description: "Espaço de sobra e conforto em cada detalhe.", size: "King · 193 × 203 cm",
    price: 3999, original_price: 4599, badge: "Edição especial", rating: 5.0, reviews: 96,
    image: "https://images.unsplash.com/photo-1615874694520-474822394e73?auto=format&fit=crop&w=1000&q=80",
  },
];

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

function initializeDatabase() {
  return new Promise((resolve, reject) => {
    db.serialize(async () => {
      try {
        await run(`CREATE TABLE IF NOT EXISTS products (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, description TEXT NOT NULL,
          size TEXT NOT NULL, price INTEGER NOT NULL CHECK(price >= 0), original_price INTEGER,
          badge TEXT, rating REAL NOT NULL, reviews INTEGER NOT NULL, image TEXT NOT NULL
        )`);
        await run(`CREATE TABLE IF NOT EXISTS orders (
          id INTEGER PRIMARY KEY AUTOINCREMENT, customer_name TEXT NOT NULL, email TEXT NOT NULL,
          phone TEXT NOT NULL, zip TEXT NOT NULL, address TEXT NOT NULL, city TEXT NOT NULL,
          total INTEGER NOT NULL CHECK(total >= 0), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`);
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
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  });
}

app.get("/api/products", async (request, response, next) => {
  try {
    const rows = await all("SELECT id, name, category, description, size, price, original_price, badge, rating, reviews, image FROM products ORDER BY rowid");
    response.json(rows);
  } catch (error) {
    next(error);
  }
});

app.post("/api/orders", async (request, response, next) => {
  const { customer, items } = request.body || {};
  const requiredFields = ["name", "email", "phone", "zip", "address", "city"];
  if (!customer || typeof customer !== "object" || requiredFields.some(field => typeof customer[field] !== "string" || !customer[field].trim())) {
    return response.status(400).json({ error: "Preencha todos os dados para entrega." });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email) || customer.name.trim().length < 3) {
    return response.status(400).json({ error: "Confira seu nome e endereço de e-mail." });
  }
  if (!Array.isArray(items) || items.length === 0 || items.length > 30) {
    return response.status(400).json({ error: "Sua sacola está vazia ou contém itens demais." });
  }
  const quantities = new Map();
  for (const item of items) {
    if (!item || typeof item.id !== "string" || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 20) {
      return response.status(400).json({ error: "Há um item inválido na sacola." });
    }
    quantities.set(item.id, (quantities.get(item.id) || 0) + item.quantity);
    if (quantities.get(item.id) > 20) return response.status(400).json({ error: "A quantidade máxima por produto é 20." });
  }

  try {
    const ids = [...quantities.keys()];
    const productRows = await all(`SELECT id, name, price FROM products WHERE id IN (${ids.map(() => "?").join(",")})`, ids);
    if (productRows.length !== ids.length) return response.status(400).json({ error: "Um dos produtos da sacola não está mais disponível." });
    const total = productRows.reduce((sum, product) => sum + product.price * quantities.get(product.id), 0);

    const result = await serializeOrder(async () => {
      await run("BEGIN TRANSACTION");
      try {
        const order = await run(
          "INSERT INTO orders (customer_name, email, phone, zip, address, city, total) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [customer.name.trim(), customer.email.trim(), customer.phone.trim(), customer.zip.trim(), customer.address.trim(), customer.city.trim(), total],
        );
        for (const product of productRows) {
          await run(
            "INSERT INTO order_items (order_id, product_id, product_name, unit_price, quantity) VALUES (?, ?, ?, ?, ?)",
            [order.lastID, product.id, product.name, product.price, quantities.get(product.id)],
          );
        }
        await run("COMMIT");
        return order;
      } catch (error) {
        try {
          await run("ROLLBACK");
        } catch (rollbackError) {
          console.error("Falha ao reverter uma transação de pedido.", rollbackError);
        }
        throw error;
      }
    });
    response.status(201).json({ orderId: result.lastID, total });
  } catch (error) {
    next(error);
  }
});

app.get("*", (request, response) => {
  response.sendFile(path.join(__dirname, "index.html"));
});

app.use((error, request, response, next) => {
  console.error("Erro na API:", error);
  if (response.headersSent) return next(error);
  response.status(500).json({ error: "Ocorreu um erro ao processar sua solicitação." });
});

initializeDatabase().then(() => {
  app.listen(port, () => console.log(`Star Colchões disponível em http://localhost:${port}`));
}).catch(error => {
  console.error("Não foi possível inicializar o banco de dados.", error);
  db.close(() => {
    process.exitCode = 1;
  });
});
