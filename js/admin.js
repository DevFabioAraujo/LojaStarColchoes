async function readResponse(response) {
  const result = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error(result?.error || "Não foi possível processar sua solicitação.");
  return result;
}

async function loadAdmin() {
  try {
    const response = await fetch("/api/auth/me");
    const result = await readResponse(response);
    if (!result.user) return window.location.replace("/account?returnTo=admin");
    if (result.user.role !== "admin") {
      return window.location.replace(result.user.role === "seller" ? "/seller" : "/");
    }
    document.querySelector("#admin-name").textContent = result.user.name;
    await loadSellers();
  } catch (error) {
    console.error("Não foi possível verificar o acesso administrativo.", error);
    document.querySelector("#seller-list-error").textContent = "Não foi possível carregar o painel. Tente novamente.";
  }
}

async function loadSellers() {
  const response = await fetch("/api/admin/sellers");
  const sellers = await readResponse(response);
  const list = document.querySelector("#seller-list");
  if (!sellers.length) {
    list.innerHTML = '<li class="seller-empty">Nenhum vendedor cadastrado.</li>';
    return;
  }
  list.innerHTML = sellers.map(seller => `
    <li class="seller-entry">
      <strong>${escapeHtml(seller.name)}</strong>
      <span>${escapeHtml(seller.email)}</span>
      <small>Criado em ${new Date(`${seller.created_at.replace(" ", "T")}Z`).toLocaleDateString("pt-BR")}</small>
    </li>`).join("");
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

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
    await loadSellers();
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
    document.querySelector("#seller-error").textContent = error.message;
  }
});

loadAdmin();
