const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
let editingProductId = null;
let productsCache = [];

async function readResponse(response) {
  const result = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error(result?.error || "Não foi possível processar sua solicitação.");
  return result;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function formattedDate(value) {
  return new Date(`${value.replace(" ", "T")}Z`).toLocaleString("pt-BR", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function showEmpty(list, message) {
  list.innerHTML = `<li class="admin-empty">${escapeHtml(message)}</li>`;
}

async function loadAdmin() {
  try {
    const result = await readResponse(await fetch("/api/auth/me"));
    if (!result.user) return window.location.replace("/account?returnTo=admin");
    if (result.user.role !== "admin") {
      return window.location.replace(result.user.role === "seller" ? "/seller" : "/");
    }
    document.querySelector("#admin-name").textContent = result.user.name;
    await loadSummary();
  } catch (error) {
    console.error("Não foi possível verificar o acesso administrativo.", error);
    document.querySelector("#admin-error").textContent = "Não foi possível carregar o painel. Tente novamente.";
  }
}

async function loadSummary() {
  const summary = await readResponse(await fetch("/api/admin/summary"));
  document.querySelector("#metric-products").textContent = summary.products;
  document.querySelector("#metric-orders").textContent = summary.orders;
  document.querySelector("#metric-customers").textContent = summary.customers;
  document.querySelector("#metric-sellers").textContent = summary.sellers;
  document.querySelector("#metric-sales").textContent = money.format(summary.sales);
}

async function loadProducts() {
  const products = await readResponse(await fetch("/api/admin/products"));
  productsCache = products;
  const list = document.querySelector("#product-list");
  if (!products.length) return showEmpty(list, "Nenhum produto cadastrado.");
  list.innerHTML = products.map(product => `
    <li class="admin-list-entry admin-product-entry">
      <img src="${escapeHtml(product.image)}" alt="" loading="lazy">
      <div class="admin-entry-content">
        <strong>${escapeHtml(product.name)}</strong>
        <span>${escapeHtml(product.size)} · ${money.format(product.price)}</span>
        <small>${escapeHtml(product.category)}${product.badge ? ` · ${escapeHtml(product.badge)}` : ""}</small>
      </div>
      <div class="admin-entry-actions">
        <button class="admin-action" type="button" data-edit-product="${escapeHtml(product.id)}">Editar</button>
        <button class="admin-action admin-action-danger" type="button" data-delete-product="${escapeHtml(product.id)}">Excluir</button>
      </div>
    </li>`).join("");
}

async function loadOrders() {
  const orders = await readResponse(await fetch("/api/admin/orders"));
  const list = document.querySelector("#order-list");
  if (!orders.length) return showEmpty(list, "Nenhum pedido registrado.");
  list.innerHTML = orders.map(order => `
    <li class="admin-list-entry admin-order-entry">
      <div class="admin-entry-content">
        <strong>Pedido #${order.id} · ${escapeHtml(order.customer_name)}</strong>
        <span>${escapeHtml(order.email)} · ${escapeHtml(order.phone)}</span>
        <span>${escapeHtml(order.address)}, ${escapeHtml(order.city)} · CEP ${escapeHtml(order.zip)}</span>
        <small>${formattedDate(order.created_at)}</small>
        <ul class="admin-order-items">${order.items.map(item => `
          <li>${escapeHtml(item.name)} · ${item.quantity} × ${money.format(item.unit_price)}</li>`).join("")}</ul>
      </div>
      <strong class="admin-order-total">${money.format(order.total)}</strong>
    </li>`).join("");
}

async function loadCustomers() {
  const customers = await readResponse(await fetch("/api/admin/customers"));
  const list = document.querySelector("#customer-list");
  if (!customers.length) return showEmpty(list, "Nenhum cliente cadastrado.");
  list.innerHTML = customers.map(customer => `
    <li class="admin-list-entry">
      <div class="admin-entry-content">
        <strong>${escapeHtml(customer.name)}</strong>
        <span>${escapeHtml(customer.email)}</span>
        <small>Cliente desde ${formattedDate(customer.created_at)} · ${customer.order_count} pedido(s) · ${money.format(customer.order_total)}</small>
      </div>
    </li>`).join("");
}

async function loadSellers() {
  const sellers = await readResponse(await fetch("/api/admin/sellers"));
  const list = document.querySelector("#seller-list");
  if (!sellers.length) return showEmpty(list, "Nenhum vendedor cadastrado.");
  list.innerHTML = sellers.map(seller => `
    <li class="admin-list-entry">
      <div class="admin-entry-content">
        <strong>${escapeHtml(seller.name)}</strong>
        <span>${escapeHtml(seller.email)}</span>
        <small>Cadastrado em ${formattedDate(seller.created_at)} · ${seller.order_count} pedido(s)</small>
      </div>
    </li>`).join("");
}

const roleLabels = { customer: "Cliente", seller: "Vendedor", admin: "Administrador" };

async function loadUsers() {
  const users = await readResponse(await fetch("/api/admin/users"));
  const list = document.querySelector("#user-list");
  if (!users.length) return showEmpty(list, "Nenhum usuário cadastrado.");
  list.innerHTML = users.map(user => `
    <li class="admin-list-entry">
      <div class="admin-entry-content">
        <strong>${escapeHtml(user.name)}${user.is_current ? " (você)" : ""}</strong>
        <span>${escapeHtml(user.email)}</span>
        <small>Cadastrado em ${formattedDate(user.created_at)}</small>
      </div>
      <select class="admin-role-select" data-user-id="${user.id}" data-current-role="${user.role}" aria-label="Perfil de ${escapeHtml(user.name)}" ${user.is_current ? "disabled" : ""}>
        ${Object.entries(roleLabels).map(([value, label]) => `<option value="${value}"${value === user.role ? " selected" : ""}>${label}</option>`).join("")}
      </select>
    </li>`).join("");
}

const sectionTitles = {
  overview: "Visão geral da loja.",
  products: "Catálogo de produtos.",
  orders: "Pedidos.",
  customers: "Clientes.",
  sellers: "Vendedores.",
  users: "Acesso ao painel.",
};

async function openSection(section) {
  document.querySelector(".dashboard-heading h1").textContent = sectionTitles[section];
  document.querySelectorAll(".admin-tab").forEach(tab => {
    const active = tab.dataset.section === section;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
  });
  document.querySelectorAll(".admin-section").forEach(panel => {
    panel.hidden = panel.id !== `section-${section}`;
  });
  document.querySelector("#admin-error").textContent = "";
  try {
    if (section === "products") await loadProducts();
    if (section === "orders") await loadOrders();
    if (section === "customers") await loadCustomers();
    if (section === "sellers") await loadSellers();
    if (section === "users") await loadUsers();
  } catch (error) {
    console.error(`Não foi possível carregar a seção ${section}.`, error);
    document.querySelector("#admin-error").textContent = error.message;
  }
}

function resetProductForm() {
  editingProductId = null;
  document.querySelector("#product-form").reset();
  document.querySelector("#product-form-title").textContent = "Novo produto";
  document.querySelector("#product-submit").innerHTML = 'Adicionar produto <span aria-hidden="true">↗</span>';
  document.querySelector("#product-cancel").hidden = true;
  document.querySelector("#product-error").textContent = "";
  document.querySelector("#product-success").textContent = "";
}

function beginProductEdit(productId, products) {
  const product = products.find(entry => entry.id === productId);
  if (!product) return;
  editingProductId = product.id;
  const form = document.querySelector("#product-form");
  for (const field of ["name", "category", "description", "size", "price", "badge", "image"]) {
    form.elements.namedItem(field).value = product[field] ?? "";
  }
  form.elements.namedItem("original_price").value = product.original_price ?? "";
  document.querySelector("#product-form-title").textContent = `Editar ${product.name}`;
  document.querySelector("#product-submit").textContent = "Salvar alterações";
  document.querySelector("#product-cancel").hidden = false;
  document.querySelector("#product-error").textContent = "";
  document.querySelector("#product-success").textContent = "";
  form.scrollIntoView({ behavior: "smooth", block: "start" });
}

document.querySelector(".admin-tabs").addEventListener("click", event => {
  const tab = event.target.closest("[data-section]");
  if (tab) openSection(tab.dataset.section);
});

document.querySelectorAll("[data-open-section]").forEach(button => {
  button.addEventListener("click", () => openSection(button.dataset.openSection));
});

document.querySelector("#product-form").addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const error = document.querySelector("#product-error");
  const success = document.querySelector("#product-success");
  const submit = document.querySelector("#product-submit");
  error.textContent = "";
  success.textContent = "";
  submit.disabled = true;
  const fields = Object.fromEntries(new FormData(form).entries());
  const payload = {
    ...fields,
    price: Number(fields.price),
    original_price: fields.original_price ? Number(fields.original_price) : null,
  };
  try {
    const response = await fetch(editingProductId
      ? `/api/admin/products/${encodeURIComponent(editingProductId)}`
      : "/api/admin/products", {
      method: editingProductId ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    await readResponse(response);
    const message = editingProductId ? "Produto atualizado." : "Produto adicionado ao catálogo.";
    resetProductForm();
    document.querySelector("#product-success").textContent = message;
    await Promise.all([loadProducts(), loadSummary()]);
  } catch (requestError) {
    error.textContent = requestError.message;
  } finally {
    submit.disabled = false;
  }
});

document.querySelector("#product-cancel").addEventListener("click", resetProductForm);

document.querySelector("#product-list").addEventListener("click", async event => {
  const editButton = event.target.closest("[data-edit-product]");
  if (editButton) {
    beginProductEdit(editButton.dataset.editProduct, productsCache);
    return;
  }
  const deleteButton = event.target.closest("[data-delete-product]");
  if (!deleteButton || !window.confirm("Excluir este produto do catálogo?")) return;
  deleteButton.disabled = true;
  try {
    await readResponse(await fetch(`/api/admin/products/${encodeURIComponent(deleteButton.dataset.deleteProduct)}`, {
      method: "DELETE",
    }));
    resetProductForm();
    await Promise.all([loadProducts(), loadSummary()]);
  } catch (error) {
    document.querySelector("#admin-error").textContent = error.message;
    deleteButton.disabled = false;
  }
});

document.querySelector("#user-list").addEventListener("change", async event => {
  const select = event.target.closest(".admin-role-select");
  if (!select) return;
  const user = select.closest("li").querySelector("strong").textContent;
  if (!window.confirm(`Alterar o perfil de ${user} para ${roleLabels[select.value]}?`)) {
    select.value = select.dataset.currentRole;
    return;
  }
  select.disabled = true;
  try {
    await readResponse(await fetch(`/api/admin/users/${encodeURIComponent(select.dataset.userId)}/role`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: select.value }),
    }));
    await Promise.all([loadUsers(), loadSummary()]);
  } catch (error) {
    document.querySelector("#admin-error").textContent = error.message;
    select.value = select.dataset.currentRole;
    select.disabled = false;
  }
});

document.querySelector("#seller-form").addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const error = document.querySelector("#seller-error");
  const success = document.querySelector("#seller-success");
  const submit = form.querySelector('[type="submit"]');
  error.textContent = "";
  success.textContent = "";
  submit.disabled = true;
  try {
    const response = await fetch("/api/admin/sellers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(new FormData(form).entries())),
    });
    const result = await readResponse(response);
    form.reset();
    success.textContent = `Acesso criado para ${result.seller.email}. Compartilhe a senha inicial em particular.`;
    await Promise.all([loadSellers(), loadSummary()]);
  } catch (requestError) {
    error.textContent = requestError.message;
  } finally {
    submit.disabled = false;
  }
});

document.querySelector("#admin-logout").addEventListener("click", async () => {
  try {
    await readResponse(await fetch("/api/auth/logout", { method: "POST" }));
    window.location.assign("/");
  } catch (error) {
    document.querySelector("#admin-error").textContent = error.message;
  }
});

loadAdmin();
