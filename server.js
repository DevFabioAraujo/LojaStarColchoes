const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const bcrypt = require("bcryptjs");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);
const { rateLimit } = require("express-rate-limit");
const helmet = require("helmet");

const app = express();
const port = Number(process.env.PORT) || 3000;
const dataDirectory = process.env.DATA_DIRECTORY
  ? path.resolve(process.env.DATA_DIRECTORY)
  : path.join(__dirname, "data");
fs.mkdirSync(dataDirectory, { recursive: true });

const db = new sqlite3.Database(path.join(dataDirectory, "star-colchoes.db"));
db.run("PRAGMA foreign_keys = ON");
let orderQueue = Promise.resolve();
const sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
if (process.env.NODE_ENV === "production" && !process.env.SESSION_SECRET) {
  throw new Error("Configure SESSION_SECRET antes de iniciar em produção.");
}

if (process.env.TRUST_PROXY) {
  const proxyHops = Number(process.env.TRUST_PROXY);
  app.set("trust proxy", Number.isInteger(proxyHops) && proxyHops >= 0 ? proxyHops : process.env.TRUST_PROXY);
}

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https://images.unsplash.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      styleSrc: ["'self'", "https://fonts.googleapis.com"],
      scriptSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
    },
  },
}));
app.use(express.json({ limit: "30kb" }));
app.use("/css", express.static(path.join(__dirname, "css")));
app.use("/js", express.static(path.join(__dirname, "js")));
app.use(session({
  name: "star.sid",
  secret: sessionSecret,
  store: new SQLiteStore({ db: "sessions.sqlite", dir: dataDirectory, table: "sessions" }),
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 12 * 60 * 60 * 1000,
  },
}));

app.use("/api", (request, response, next) => {
  if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) {
    const origin = request.get("Origin");
    if (origin) {
      try {
        const parsedOrigin = new URL(origin);
        if (parsedOrigin.host !== request.get("host") || parsedOrigin.protocol !== `${request.protocol}:`) {
          return response.status(403).json({ error: "Origem da solicitação não permitida." });
        }
      } catch {
        return response.status(403).json({ error: "Origem da solicitação inválida." });
      }
    }
  }
  next();
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Muitas tentativas. Aguarde alguns minutos e tente novamente." },
});
const registrationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Muitas contas criadas. Tente novamente mais tarde." },
});

function normalizeEmail(email) {
  return email.trim().toLowerCase();
}

function validateProduct(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { error: "Informe os dados do produto." };
  }

  const { name, category, description, size, price, original_price, badge, image } = input;
  if (typeof name !== "string" || name.trim().length < 3 || name.trim().length > 100) {
    return { error: "O nome deve ter entre 3 e 100 caracteres." };
  }
  if (!["espuma", "molas", "hibrido"].includes(category)) {
    return { error: "Selecione uma categoria válida." };
  }
  if (typeof description !== "string" || !description.trim() || description.trim().length > 500) {
    return { error: "A descrição deve ter entre 1 e 500 caracteres." };
  }
  if (typeof size !== "string" || !size.trim() || size.trim().length > 100) {
    return { error: "Informe um tamanho de até 100 caracteres." };
  }
  if (!Number.isSafeInteger(price) || price < 1) {
    return { error: "O preço deve ser um valor inteiro positivo em reais." };
  }
  const originalPrice = original_price === "" || original_price === null || original_price === undefined
    ? null
    : original_price;
  if (originalPrice !== null && (!Number.isSafeInteger(originalPrice) || originalPrice <= price)) {
    return { error: "O preço original deve ser inteiro e maior que o preço atual." };
  }
  if (badge !== undefined && (typeof badge !== "string" || badge.trim().length > 40)) {
    return { error: "O selo deve ter no máximo 40 caracteres." };
  }
  if (typeof image !== "string" || image.length > 2048) {
    return { error: "Informe uma imagem válida para o produto." };
  }
  let parsedImage;
  try {
    parsedImage = new URL(image);
  } catch {
    return { error: "Informe uma URL HTTPS válida para a imagem." };
  }
  if (parsedImage.protocol !== "https:") {
    return { error: "A URL da imagem deve usar HTTPS." };
  }

  return {
    product: {
      name: name.trim(),
      category,
      description: description.trim(),
      size: size.trim(),
      price,
      originalPrice,
      badge: typeof badge === "string" ? badge.trim() : "",
      image: parsedImage.toString(),
    },
  };
}

function validateName(name) {
  return typeof name === "string" && name.trim().length >= 3 && name.trim().length <= 100;
}

function passwordError(password) {
  if (typeof password !== "string" || password.length < 12) {
    return "A senha deve ter pelo menos 12 caracteres.";
  }
  if (Buffer.byteLength(password, "utf8") > 72) {
    return "A senha deve ter no máximo 72 bytes.";
  }
  return null;
}

function safeUser(user) {
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

function saveAuthenticatedSession(request, user) {
  return new Promise((resolve, reject) => {
    request.session.regenerate(error => {
      if (error) return reject(error);
      request.session.userId = user.id;
      request.session.sessionVersion = user.session_version;
      request.session.save(saveError => saveError ? reject(saveError) : resolve());
    });
  });
}

function requireRole(role) {
  return async (request, response, next) => {
    try {
      if (!request.session.userId) {
        return response.status(401).json({ error: "Entre na sua conta para continuar." });
      }
      const users = await all(
        "SELECT id, name, email, role, session_version FROM users WHERE id = ?",
        [request.session.userId],
      );
      const user = users[0];
      if (!user || user.session_version !== request.session.sessionVersion) {
        request.session.destroy(() => {});
        response.clearCookie("star.sid", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
        return response.status(401).json({ error: "Sua sessão expirou. Entre novamente." });
      }
      if (role && user.role !== role) {
        return response.status(403).json({ error: "Você não tem permissão para acessar este recurso." });
      }
      request.user = user;
      next();
    } catch (error) {
      next(error);
    }
  };
}

const requireAdmin = requireRole("admin");

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
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  });
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

app.post("/api/auth/register", registrationLimiter, async (request, response, next) => {
  const { name, email, password } = request.body || {};
  if (!validateName(name) || typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || email.trim().length > 254) {
    return response.status(400).json({ error: "Informe um nome e um e-mail válidos." });
  }
  const validationError = passwordError(password);
  if (validationError) return response.status(400).json({ error: validationError });

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const result = await run(
      "INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'customer')",
      [name.trim(), normalizeEmail(email), passwordHash],
    );
    const user = {
      id: result.lastID,
      name: name.trim(),
      email: normalizeEmail(email),
      role: "customer",
      session_version: 0,
    };
    await saveAuthenticatedSession(request, user);
    response.status(201).json({ user: safeUser(user) });
  } catch (error) {
    if (error.code === "SQLITE_CONSTRAINT" && error.message.includes("users.email")) {
      return response.status(409).json({ error: "Já existe uma conta com este e-mail." });
    }
    next(error);
  }
});

app.post("/api/auth/login", loginLimiter, async (request, response, next) => {
  const { email, password } = request.body || {};
  if (typeof email !== "string" || typeof password !== "string") {
    return response.status(400).json({ error: "Informe seu e-mail e sua senha." });
  }
  try {
    const users = await all(
      "SELECT id, name, email, password_hash, role, session_version FROM users WHERE email = ?",
      [normalizeEmail(email)],
    );
    const user = users[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return response.status(401).json({ error: "E-mail ou senha inválidos." });
    }
    await saveAuthenticatedSession(request, user);
    response.json({ user: safeUser(user) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/auth/me", async (request, response, next) => {
  try {
    if (!request.session.userId) return response.json({ user: null });
    const users = await all(
      "SELECT id, name, email, role, session_version FROM users WHERE id = ?",
      [request.session.userId],
    );
    const user = users[0];
    if (!user || user.session_version !== request.session.sessionVersion) {
      return response.json({ user: null });
    }
    response.json({ user: safeUser(user) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/logout", (request, response, next) => {
  request.session.destroy(error => {
    if (error) return next(error);
    response.clearCookie("star.sid", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
    response.status(204).end();
  });
});

app.post("/api/auth/password", requireRole(), async (request, response, next) => {
  const { currentPassword, newPassword } = request.body || {};
  if (typeof currentPassword !== "string" || !currentPassword) {
    return response.status(400).json({ error: "Informe sua senha atual." });
  }
  const validationError = passwordError(newPassword);
  if (validationError) return response.status(400).json({ error: validationError });
  try {
    const users = await all("SELECT password_hash, session_version FROM users WHERE id = ?", [request.user.id]);
    if (!users[0] || !(await bcrypt.compare(currentPassword, users[0].password_hash))) {
      return response.status(400).json({ error: "A senha atual está incorreta." });
    }
    const passwordHash = await bcrypt.hash(newPassword, 12);
    await run("UPDATE users SET password_hash = ?, session_version = session_version + 1 WHERE id = ?", [passwordHash, request.user.id]);
    await saveAuthenticatedSession(request, { ...request.user, session_version: users[0].session_version + 1 });
    response.json({ message: "Senha alterada. As outras sessões foram encerradas." });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/sellers", requireAdmin, async (request, response, next) => {
  try {
    const sellers = await all(
      `SELECT users.id, users.name, users.email, users.created_at, COUNT(orders.id) AS order_count
       FROM users LEFT JOIN orders ON orders.user_id = users.id
       WHERE users.role = 'seller' GROUP BY users.id ORDER BY users.created_at DESC`,
    );
    response.json(sellers);
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/sellers", requireAdmin, async (request, response, next) => {
  const { name, email, password } = request.body || {};
  if (!validateName(name) || typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || email.trim().length > 254) {
    return response.status(400).json({ error: "Informe um nome e um e-mail válidos para o vendedor." });
  }
  const validationError = passwordError(password);
  if (validationError) return response.status(400).json({ error: validationError });
  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const result = await run(
      "INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'seller')",
      [name.trim(), normalizeEmail(email), passwordHash],
    );
    response.status(201).json({
      seller: { id: result.lastID, name: name.trim(), email: normalizeEmail(email) },
    });
  } catch (error) {
    if (error.code === "SQLITE_CONSTRAINT" && error.message.includes("users.email")) {
      return response.status(409).json({ error: "Já existe uma conta com este e-mail." });
    }
    next(error);
  }
});

app.get("/api/admin/summary", requireAdmin, async (request, response, next) => {
  try {
    const [products, orders, customers, sellers, sales] = await Promise.all([
      all("SELECT COUNT(*) AS count FROM products"),
      all("SELECT COUNT(*) AS count FROM orders"),
      all("SELECT COUNT(*) AS count FROM users WHERE role = 'customer'"),
      all("SELECT COUNT(*) AS count FROM users WHERE role = 'seller'"),
      all("SELECT COALESCE(SUM(total), 0) AS total FROM orders"),
    ]);
    response.json({
      products: products[0].count,
      orders: orders[0].count,
      customers: customers[0].count,
      sellers: sellers[0].count,
      sales: sales[0].total,
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/products", requireAdmin, async (request, response, next) => {
  try {
    const rows = await all(
      "SELECT id, name, category, description, size, price, original_price, badge, rating, reviews, image FROM products ORDER BY rowid DESC",
    );
    response.json(rows);
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/products", requireAdmin, async (request, response, next) => {
  const validation = validateProduct(request.body);
  if (validation.error) return response.status(400).json({ error: validation.error });
  const product = validation.product;
  const baseId = product.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "produto";
  try {
    let id = baseId;
    let suffix = 2;
    while ((await all("SELECT id FROM products WHERE id = ?", [id])).length) {
      id = `${baseId}-${suffix}`;
      suffix += 1;
    }
    await run(
      `INSERT INTO products (id, name, category, description, size, price, original_price, badge, rating, reviews, image)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?)`,
      [id, product.name, product.category, product.description, product.size, product.price, product.originalPrice, product.badge, product.image],
    );
    response.status(201).json({ product: { id, ...product, rating: 0, reviews: 0 } });
  } catch (error) {
    next(error);
  }
});

app.put("/api/admin/products/:id", requireAdmin, async (request, response, next) => {
  const validation = validateProduct(request.body);
  if (validation.error) return response.status(400).json({ error: validation.error });
  const product = validation.product;
  try {
    const result = await run(
      `UPDATE products SET name = ?, category = ?, description = ?, size = ?, price = ?,
       original_price = ?, badge = ?, image = ? WHERE id = ?`,
      [product.name, product.category, product.description, product.size, product.price, product.originalPrice, product.badge, product.image, request.params.id],
    );
    if (!result.changes) return response.status(404).json({ error: "Produto não encontrado." });
    response.json({ product: { id: request.params.id, ...product } });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/admin/products/:id", requireAdmin, async (request, response, next) => {
  try {
    const result = await run("DELETE FROM products WHERE id = ?", [request.params.id]);
    if (!result.changes) return response.status(404).json({ error: "Produto não encontrado." });
    response.status(204).end();
  } catch (error) {
    if (error.code?.startsWith("SQLITE_CONSTRAINT") && /FOREIGN KEY/i.test(error.message)) {
      return response.status(409).json({ error: "Este produto já faz parte de um pedido e não pode ser excluído." });
    }
    next(error);
  }
});

app.get("/api/admin/users", requireAdmin, async (request, response, next) => {
  try {
    const users = await all(
      "SELECT id, name, email, role, created_at FROM users ORDER BY role = 'admin' DESC, created_at DESC",
    );
    response.json(users.map(user => ({ ...user, is_current: user.id === request.user.id })));
  } catch (error) {
    next(error);
  }
});

app.put("/api/admin/users/:id/role", requireAdmin, async (request, response, next) => {
  const { role } = request.body || {};
  const userId = Number(request.params.id);
  if (!["customer", "seller", "admin"].includes(role)) {
    return response.status(400).json({ error: "Selecione um perfil válido." });
  }
  if (!Number.isInteger(userId) || userId < 1) {
    return response.status(404).json({ error: "Usuário não encontrado." });
  }
  if (userId === request.user.id) {
    return response.status(400).json({ error: "Você não pode alterar o seu próprio perfil." });
  }
  try {
    const result = await run(
      "UPDATE users SET role = ?, session_version = session_version + 1 WHERE id = ?",
      [role, userId],
    );
    if (!result.changes) return response.status(404).json({ error: "Usuário não encontrado." });
    response.json({ id: userId, role });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/customers", requireAdmin, async (request, response, next) => {
  try {
    const customers = await all(
      `SELECT users.id, users.name, users.email, users.created_at, COUNT(orders.id) AS order_count,
       COALESCE(SUM(orders.total), 0) AS order_total
       FROM users LEFT JOIN orders ON orders.user_id = users.id
       WHERE users.role = 'customer' GROUP BY users.id ORDER BY users.created_at DESC`,
    );
    response.json(customers);
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/orders", requireAdmin, async (request, response, next) => {
  try {
    const rows = await all(
      `SELECT orders.id, orders.customer_name, orders.email, orders.phone, orders.zip, orders.address,
       orders.city, orders.total, orders.created_at, order_items.product_name, order_items.unit_price,
       order_items.quantity
       FROM orders LEFT JOIN order_items ON order_items.order_id = orders.id
       ORDER BY orders.created_at DESC, orders.id DESC LIMIT 500`,
    );
    const ordersById = new Map();
    for (const row of rows) {
      if (!ordersById.has(row.id)) {
        ordersById.set(row.id, {
          id: row.id,
          customer_name: row.customer_name,
          email: row.email,
          phone: row.phone,
          zip: row.zip,
          address: row.address,
          city: row.city,
          total: row.total,
          created_at: row.created_at,
          items: [],
        });
      }
      if (row.product_name) {
        ordersById.get(row.id).items.push({
          name: row.product_name,
          unit_price: row.unit_price,
          quantity: row.quantity,
        });
      }
    }
    response.json([...ordersById.values()]);
  } catch (error) {
    next(error);
  }
});

app.get("/api/products", async (request, response, next) => {
  try {
    const rows = await all("SELECT id, name, category, description, size, price, original_price, badge, rating, reviews, image FROM products ORDER BY rowid");
    response.json(rows);
  } catch (error) {
    next(error);
  }
});

app.post("/api/orders", requireRole(), async (request, response, next) => {
  const { customer = {}, items } = request.body || {};
  const requiredFields = ["phone", "zip", "address", "city"];
  if (!customer || typeof customer !== "object" || requiredFields.some(field => typeof customer[field] !== "string" || !customer[field].trim())) {
    return response.status(400).json({ error: "Preencha todos os dados para entrega." });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(request.user.email) || request.user.name.trim().length < 3) {
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
          "INSERT INTO orders (user_id, customer_name, email, phone, zip, address, city, total) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          [request.user.id, request.user.name.trim(), request.user.email, customer.phone.trim(), customer.zip.trim(), customer.address.trim(), customer.city.trim(), total],
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

function protectedPage(role, fileName) {
  return async (request, response, next) => {
    try {
      if (!request.session.userId) return response.redirect(`/account?returnTo=${role}`);
      const users = await all(
        "SELECT id, role, session_version FROM users WHERE id = ?",
        [request.session.userId],
      );
      const user = users[0];
      if (!user || user.session_version !== request.session.sessionVersion) {
        return response.redirect("/account");
      }
      if (user.role !== role) {
        if (user.role === "admin") return response.redirect("/admin");
        if (user.role === "seller") return response.redirect("/seller");
        return response.redirect("/");
      }
      response.sendFile(path.join(__dirname, fileName));
    } catch (error) {
      next(error);
    }
  };
}

app.get("/account", (request, response) => response.sendFile(path.join(__dirname, "account.html")));
app.get("/seller", protectedPage("seller", "seller.html"));
app.get("/admin", protectedPage("admin", "admin.html"));

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
