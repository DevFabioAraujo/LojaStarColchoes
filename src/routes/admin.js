const bcrypt = require("bcryptjs");
const { all, run } = require("../database");
const { normalizeEmail, validateProduct, validateName, passwordError } = require("../validation");
const { requireRole } = require("../middleware/auth");
const requireAdmin = requireRole("admin");

const router = require("express").Router();

router.get("/api/admin/sellers", requireAdmin, async (request, response, next) => {
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

router.post("/api/admin/sellers", requireAdmin, async (request, response, next) => {
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

router.get("/api/admin/summary", requireAdmin, async (request, response, next) => {
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

router.get("/api/admin/products", requireAdmin, async (request, response, next) => {
  try {
    const rows = await all(
      "SELECT id, name, category, description, size, price, original_price, badge, rating, reviews, image FROM products ORDER BY rowid DESC",
    );
    response.json(rows);
  } catch (error) {
    next(error);
  }
});

router.post("/api/admin/products", requireAdmin, async (request, response, next) => {
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

router.put("/api/admin/products/:id", requireAdmin, async (request, response, next) => {
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

router.delete("/api/admin/products/:id", requireAdmin, async (request, response, next) => {
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

router.get("/api/admin/users", requireAdmin, async (request, response, next) => {
  try {
    const users = await all(
      "SELECT id, name, email, role, created_at FROM users ORDER BY role = 'admin' DESC, created_at DESC",
    );
    response.json(users.map(user => ({ ...user, is_current: user.id === request.user.id })));
  } catch (error) {
    next(error);
  }
});

router.put("/api/admin/users/:id/role", requireAdmin, async (request, response, next) => {
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

router.get("/api/admin/customers", requireAdmin, async (request, response, next) => {
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

router.get("/api/admin/orders", requireAdmin, async (request, response, next) => {
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

module.exports = router;
