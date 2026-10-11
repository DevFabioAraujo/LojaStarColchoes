const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const cartKey = "star-colchoes-cart";

const state = {
  products: [],
  category: "todos",
  search: "",
  sort: "featured",
  cart: loadCart(),
};

const elements = {
  grid: document.querySelector("#product-grid"),
  count: document.querySelector("#cart-count"),
  drawerCount: document.querySelector("#drawer-count"),
  cartItems: document.querySelector("#cart-items"),
  cartEmpty: document.querySelector("#cart-empty"),
  drawerFooter: document.querySelector("#drawer-footer"),
  subtotal: document.querySelector("#cart-subtotal"),
  overlay: document.querySelector("#cart-overlay"),
  drawer: document.querySelector("#cart-drawer"),
  checkoutModal: document.querySelector("#checkout-modal"),
  checkoutSummary: document.querySelector("#checkout-summary"),
  checkoutForm: document.querySelector("#checkout-form"),
  checkoutError: document.querySelector("#checkout-error"),
  toast: document.querySelector("#toast"),
};

function loadCart() {
  try {
    const stored = JSON.parse(localStorage.getItem(cartKey) || "[]");
    return Array.isArray(stored) ? stored.filter(item => item && typeof item.id === "string" && Number.isInteger(item.quantity) && item.quantity > 0) : [];
  } catch (error) {
    console.error("Não foi possível recuperar a sacola salva.", error);
    return [];
  }
}

function saveCart() {
  localStorage.setItem(cartKey, JSON.stringify(state.cart));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

async function fetchProducts() {
  try {
    const response = await fetch("/api/products");
    if (!response.ok) throw new Error("Não foi possível carregar os colchões.");
    state.products = await response.json();
    const validIds = new Set(state.products.map(product => product.id));
    state.cart = state.cart.filter(item => validIds.has(item.id));
    saveCart();
    document.querySelector("#all-count").textContent = state.products.length;
    renderProducts();
    renderCart();
  } catch (error) {
    console.error(error);
    elements.grid.innerHTML = '<div class="empty-state">Não conseguimos carregar os produtos agora. Atualize a página para tentar novamente.</div>';
  }
}

function visibleProducts() {
  let products = [...state.products];
  if (state.category !== "todos") products = products.filter(product => product.category === state.category);
  if (state.search) {
    const term = state.search.toLocaleLowerCase("pt-BR");
    products = products.filter(product => `${product.name} ${product.description} ${product.category}`.toLocaleLowerCase("pt-BR").includes(term));
  }
  if (state.sort === "price-asc") products.sort((a, b) => a.price - b.price);
  if (state.sort === "price-desc") products.sort((a, b) => b.price - a.price);
  if (state.sort === "rating") products.sort((a, b) => b.rating - a.rating);
  return products;
}

function renderProducts() {
  const products = visibleProducts();
  if (!products.length) {
    elements.grid.innerHTML = '<div class="empty-state">Nenhum colchão encontrado. Tente outra busca ou categoria.</div>';
    return;
  }
  elements.grid.innerHTML = products.map(product => `
    <article class="product-card">
      <div class="product-image-wrap">
        <img class="product-image" src="${escapeHtml(product.image)}" alt="${escapeHtml(product.name)}" loading="lazy">
        ${product.badge ? `<span class="product-badge">${escapeHtml(product.badge)}</span>` : ""}
        <button class="quick-add" type="button" data-add="${escapeHtml(product.id)}" aria-label="Adicionar ${escapeHtml(product.name)} à sacola">+</button>
      </div>
      <div class="product-info">
        <div class="product-title-line"><h3 class="product-title">${escapeHtml(product.name)}</h3><span class="product-rating">★ ${Number(product.rating).toFixed(1)} <span>(${product.reviews})</span></span></div>
        <p class="product-description">${escapeHtml(product.description)}</p>
        <span class="product-size">${escapeHtml(product.size)}</span>
        <div class="product-pricing"><span class="product-price">${currency.format(product.price)}</span>${product.original_price ? `<span class="old-price">${currency.format(product.original_price)}</span>` : ""}</div>
        <p class="installment">ou 10x de ${currency.format(product.price / 10)} sem juros</p>
      </div>
    </article>`).join("");
}

function renderCart() {
  const quantity = state.cart.reduce((sum, item) => sum + item.quantity, 0);
  const total = state.cart.reduce((sum, item) => {
    const product = state.products.find(entry => entry.id === item.id);
    return sum + (product ? product.price * item.quantity : 0);
  }, 0);
  elements.count.textContent = quantity;
  elements.drawerCount.textContent = `(${quantity})`;
  elements.subtotal.textContent = currency.format(total);
  elements.cartEmpty.classList.toggle("visible", quantity === 0);
  elements.drawerFooter.hidden = quantity === 0;
  elements.cartItems.innerHTML = state.cart.map(item => {
    const product = state.products.find(entry => entry.id === item.id);
    if (!product) return "";
    return `<article class="cart-item">
      <img src="${escapeHtml(product.image)}" alt="">
      <div><h3>${escapeHtml(product.name)}</h3><p>${escapeHtml(product.size)}</p>
        <div class="quantity-control"><button type="button" data-quantity="${escapeHtml(product.id)}" data-change="-1" aria-label="Diminuir quantidade">−</button><span>${item.quantity}</span><button type="button" data-quantity="${escapeHtml(product.id)}" data-change="1" aria-label="Aumentar quantidade">+</button></div>
      </div>
      <span class="cart-item-price">${currency.format(product.price * item.quantity)}</span>
      <button class="remove-item" type="button" data-remove="${escapeHtml(product.id)}">Remover</button>
    </article>`;
  }).join("");
  saveCart();
}

function addToCart(id) {
  const existing = state.cart.find(item => item.id === id);
  if (existing && existing.quantity >= 20) {
    showToast("O limite é de 20 unidades por produto.");
    return;
  }
  if (existing) existing.quantity += 1;
  else state.cart.push({ id, quantity: 1 });
  renderCart();
  showToast("Adicionado à sua sacola.");
}

function updateQuantity(id, change) {
  const item = state.cart.find(entry => entry.id === id);
  if (!item) return;
  if (change > 0 && item.quantity >= 20) {
    showToast("O limite é de 20 unidades por produto.");
    return;
  }
  item.quantity += change;
  if (item.quantity < 1) state.cart = state.cart.filter(entry => entry.id !== id);
  renderCart();
}

function openCart() {
  elements.overlay.hidden = false;
  requestAnimationFrame(() => elements.drawer.classList.add("open"));
  elements.drawer.setAttribute("aria-hidden", "false");
  document.body.classList.add("no-scroll");
}

function closeCart() {
  elements.drawer.classList.remove("open");
  elements.drawer.setAttribute("aria-hidden", "true");
  elements.overlay.hidden = true;
  document.body.classList.remove("no-scroll");
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("visible");
  window.clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(() => elements.toast.classList.remove("visible"), 2600);
}

document.querySelector("#product-grid").addEventListener("click", event => {
  const button = event.target.closest("[data-add]");
  if (button) addToCart(button.dataset.add);
});

document.querySelector(".category-tabs").addEventListener("click", event => {
  const button = event.target.closest("[data-category]");
  if (!button) return;
  state.category = button.dataset.category;
  document.querySelectorAll(".filter-chip").forEach(chip => chip.classList.toggle("active", chip === button));
  renderProducts();
});

document.querySelector("#sort-products").addEventListener("change", event => {
  state.sort = event.target.value;
  renderProducts();
});

document.querySelector("#search-toggle").addEventListener("click", () => {
  const search = document.querySelector("#search-bar");
  search.classList.toggle("visible");
  if (search.classList.contains("visible")) document.querySelector("#product-search").focus();
});

document.querySelector("#search-bar").addEventListener("submit", event => event.preventDefault());
document.querySelector("#product-search").addEventListener("input", event => {
  state.search = event.target.value.trim();
  renderProducts();
});

document.querySelector("#cart-open").addEventListener("click", openCart);
document.querySelector("#cart-close").addEventListener("click", closeCart);
document.querySelector("#continue-shopping").addEventListener("click", closeCart);
elements.overlay.addEventListener("click", closeCart);
elements.cartItems.addEventListener("click", event => {
  const quantityButton = event.target.closest("[data-quantity]");
  const removeButton = event.target.closest("[data-remove]");
  if (quantityButton) updateQuantity(quantityButton.dataset.quantity, Number(quantityButton.dataset.change));
  if (removeButton) {
    state.cart = state.cart.filter(item => item.id !== removeButton.dataset.remove);
    renderCart();
  }
});

document.querySelector("#checkout-open").addEventListener("click", () => {
  const count = state.cart.reduce((sum, item) => sum + item.quantity, 0);
  elements.checkoutSummary.textContent = `${count} ${count === 1 ? "item" : "itens"} · ${elements.subtotal.textContent} · Frete grátis`;
  closeCart();
  elements.checkoutModal.hidden = false;
  document.body.classList.add("no-scroll");
  document.querySelector("#checkout-modal input").focus();
});

function closeCheckout() {
  elements.checkoutModal.hidden = true;
  document.body.classList.remove("no-scroll");
}

document.querySelector("#checkout-close").addEventListener("click", closeCheckout);
elements.checkoutModal.addEventListener("click", event => {
  if (event.target === elements.checkoutModal) closeCheckout();
});
document.addEventListener("keydown", event => {
  if (event.key === "Escape") {
    closeCart();
    closeCheckout();
  }
});

elements.checkoutForm.addEventListener("submit", async event => {
  event.preventDefault();
  elements.checkoutError.textContent = "";
  const submit = elements.checkoutForm.querySelector('[type="submit"]');
  submit.disabled = true;
  submit.textContent = "Enviando pedido...";
  const customer = Object.fromEntries(new FormData(elements.checkoutForm).entries());
  try {
    const response = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customer, items: state.cart }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Não foi possível concluir o pedido.");
    state.cart = [];
    renderCart();
    elements.checkoutForm.reset();
    closeCheckout();
    showToast(`Pedido #${result.orderId} recebido. Obrigado por escolher a Star!`);
  } catch (error) {
    elements.checkoutError.textContent = error.message;
  } finally {
    submit.disabled = false;
    submit.innerHTML = 'Confirmar pedido <span>↗</span>';
  }
});

document.querySelector("#newsletter-form").addEventListener("submit", event => {
  event.preventDefault();
  showToast("Formulário demonstrativo: conecte um serviço de e-mail antes de publicar.");
  event.currentTarget.reset();
});

fetchProducts();
