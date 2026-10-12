const bcrypt = require("bcryptjs");
const { all, run, serializeOrder } = require("../database");
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
       orders.neighborhood, orders.city, orders.total, orders.created_at, order_items.product_name, order_items.unit_price,
       order_items.product_id, order_items.quantity
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
          neighborhood: row.neighborhood,
          city: row.city,
          total: row.total,
          created_at: row.created_at,
          items: [],
        });
      }
      if (row.product_name) {
        ordersById.get(row.id).items.push({
          product_id: row.product_id,
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

router.put("/api/admin/orders/:id", requireAdmin, async (request, response, next) => {
  const orderId = Number(request.params.id);
  const { customer_name, email, phone, zip, address, neighborhood, city, items } = request.body || {};
  if (!Number.isSafeInteger(orderId) || orderId < 1) {
    return response.status(404).json({ error: "Pedido não encontrado." });
  }
  const fields = { customer_name, email, phone, zip, address, neighborhood, city };
  if (["customer_name", "email", "phone", "zip", "address", "city"].some(field => (
    typeof fields[field] !== "string" || !fields[field].trim() || fields[field].trim().length > 250
  )) || typeof neighborhood !== "string" || neighborhood.trim().length > 250) {
    return response.status(400).json({ error: "Preencha os dados de contato e entrega com valores válidos." });
  }
  if (!validateName(customer_name) || email.trim().length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return response.status(400).json({ error: "Informe um nome e um e-mail válidos para o pedido." });
  }
  if (typeof phone !== "string" || phone.trim().length > 40 || typeof zip !== "string" || zip.trim().length > 20) {
    return response.status(400).json({ error: "Telefone ou CEP inválido." });
  }
  if (!Array.isArray(items) || items.length === 0 || items.length > 30) {
    return response.status(400).json({ error: "O pedido precisa ter entre 1 e 30 itens." });
  }

  const quantities = new Map();
  for (const item of items) {
    if (!item || typeof item.productId !== "string" || !item.productId.trim()
        || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 20
        || quantities.has(item.productId)) {
      return response.status(400).json({ error: "Há um produto ou uma quantidade inválida no pedido." });
    }
    quantities.set(item.productId, item.quantity);
  }

  try {
    const result = await serializeOrder(async () => {
      const orderRows = await all("SELECT id FROM orders WHERE id = ?", [orderId]);
      if (!orderRows.length) return { notFound: true };

      const productIds = [...quantities.keys()];
      const products = await all(
        `SELECT id, name, price FROM products WHERE id IN (${productIds.map(() => "?").join(",")})`,
        productIds,
      );
      if (products.length !== productIds.length) return { unavailableProduct: true };
      const total = products.reduce((sum, product) => sum + product.price * quantities.get(product.id), 0);
      if (!Number.isSafeInteger(total)) {
        return { invalidTotal: true };
      }

      await run("BEGIN TRANSACTION");
      try {
        await run(
          `UPDATE orders SET customer_name = ?, email = ?, phone = ?, zip = ?, address = ?, neighborhood = ?, city = ?, total = ?
           WHERE id = ?`,
          [customer_name.trim(), email.trim(), phone.trim(), zip.trim(), address.trim(), neighborhood.trim(), city.trim(), total, orderId],
        );
        await run("DELETE FROM order_items WHERE order_id = ?", [orderId]);
        for (const product of products) {
          await run(
            `INSERT INTO order_items (order_id, product_id, product_name, unit_price, quantity)
             VALUES (?, ?, ?, ?, ?)`,
            [orderId, product.id, product.name, product.price, quantities.get(product.id)],
          );
        }
        await run("COMMIT");
        return { total };
      } catch (error) {
        try {
          await run("ROLLBACK");
        } catch (rollbackError) {
          console.error("Falha ao reverter a edição de um pedido.", rollbackError);
        }
        throw error;
      }
    });
    if (result.notFound) return response.status(404).json({ error: "Pedido não encontrado." });
    if (result.unavailableProduct) return response.status(400).json({ error: "Um dos produtos selecionados não está disponível." });
    if (result.invalidTotal) return response.status(400).json({ error: "O total do pedido excede o valor permitido." });
    response.json({ id: orderId, total: result.total });
  } catch (error) {
    next(error);
  }
});

router.delete("/api/admin/orders/:id", requireAdmin, async (request, response, next) => {
  const orderId = Number(request.params.id);
  if (!Number.isSafeInteger(orderId) || orderId < 1) {
    return response.status(404).json({ error: "Pedido não encontrado." });
  }
  try {
    const deleted = await serializeOrder(async () => {
      const orders = await all("SELECT id FROM orders WHERE id = ?", [orderId]);
      if (!orders.length) return false;

      await run("BEGIN TRANSACTION");
      try {
        await run("DELETE FROM order_items WHERE order_id = ?", [orderId]);
        await run("DELETE FROM orders WHERE id = ?", [orderId]);
        await run("COMMIT");
        return true;
      } catch (error) {
        try {
          await run("ROLLBACK");
        } catch (rollbackError) {
          console.error("Falha ao reverter a exclusão de um pedido.", rollbackError);
        }
        throw error;
      }
    });
    if (!deleted) return response.status(404).json({ error: "Pedido não encontrado." });
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

module.exports = router;
