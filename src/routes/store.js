const { all, run, serializeOrder } = require("../database");
const { requireRole } = require("../middleware/auth");

const router = require("express").Router();

router.get("/api/products", async (request, response, next) => {
  try {
    const rows = await all("SELECT id, name, category, description, size, price, original_price, badge, rating, reviews, image FROM products ORDER BY rowid");
    response.json(rows);
  } catch (error) {
    next(error);
  }
});

router.post("/api/orders", requireRole(), async (request, response, next) => {
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

module.exports = router;
