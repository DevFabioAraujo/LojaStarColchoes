const authPanel = document.querySelector("#auth-panel");
const accountHome = document.querySelector("#account-home");
const loginForm = document.querySelector("#login-form");
const registerForm = document.querySelector("#register-form");

async function readResponse(response) {
  const result = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error(result?.error || "Não foi possível processar sua solicitação.");
  return result;
}

function accountDestination(user) {
  const returnTo = new URLSearchParams(window.location.search).get("returnTo");
  if (user.role === "customer" && returnTo === "checkout") return "/?checkout=1";
  if (user.role === "admin") return "/admin";
  if (user.role === "seller") return "/seller";
  return "/";
}

function showAccount(user) {
  authPanel.hidden = true;
  accountHome.hidden = false;
  document.querySelector("#account-name").textContent = user.name;
  document.querySelector("#account-email").textContent = user.email;
  const destination = document.querySelector("#account-destination");
  if (user.role === "admin") {
    destination.href = "/admin";
    destination.innerHTML = 'Abrir painel administrativo <span aria-hidden="true">↗</span>';
  } else if (user.role === "seller") {
    destination.href = "/seller";
    destination.innerHTML = 'Abrir painel do vendedor <span aria-hidden="true">↗</span>';
  } else {
    destination.href = "/";
    destination.innerHTML = 'Continuar comprando <span aria-hidden="true">↗</span>';
  }
}

async function loadAccount() {
  try {
    const response = await fetch("/api/auth/me");
    const result = await readResponse(response);
    if (result.user) showAccount(result.user);
  } catch (error) {
    console.error("Não foi possível verificar a sessão.", error);
    document.querySelector("#login-error").textContent = "Não foi possível conectar ao servidor. Tente novamente.";
  }
}

document.querySelectorAll(".auth-tab").forEach(tab => {
  tab.addEventListener("click", () => {
    const register = tab.dataset.mode === "register";
    loginForm.hidden = register;
    registerForm.hidden = !register;
    document.querySelectorAll(".auth-tab").forEach(button => button.classList.toggle("active", button === tab));
    document.querySelector("#auth-title").textContent = register ? "Crie sua conta." : "Acesse sua conta.";
    document.querySelectorAll(".form-error").forEach(error => { error.textContent = ""; });
    (register ? registerForm : loginForm).querySelector("input").focus();
  });
});

loginForm.addEventListener("submit", async event => {
  event.preventDefault();
  const errorElement = document.querySelector("#login-error");
  const submit = loginForm.querySelector('[type="submit"]');
  errorElement.textContent = "";
  submit.disabled = true;
  try {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(new FormData(loginForm).entries())),
    });
    const { user } = await readResponse(response);
    window.location.assign(accountDestination(user));
  } catch (error) {
    errorElement.textContent = error.message;
  } finally {
    submit.disabled = false;
  }
});

registerForm.addEventListener("submit", async event => {
  event.preventDefault();
  const errorElement = document.querySelector("#register-error");
  const submit = registerForm.querySelector('[type="submit"]');
  errorElement.textContent = "";
  submit.disabled = true;
  try {
    const response = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(new FormData(registerForm).entries())),
    });
    const { user } = await readResponse(response);
    window.location.assign(accountDestination(user));
  } catch (error) {
    errorElement.textContent = error.message;
  } finally {
    submit.disabled = false;
  }
});

document.querySelector("#password-form").addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const errorElement = document.querySelector("#password-error");
  const successElement = document.querySelector("#password-success");
  const submit = form.querySelector('[type="submit"]');
  errorElement.textContent = "";
  successElement.textContent = "";
  submit.disabled = true;
  try {
    const response = await fetch("/api/auth/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(new FormData(form).entries())),
    });
    const result = await readResponse(response);
    form.reset();
    successElement.textContent = result.message;
  } catch (error) {
    errorElement.textContent = error.message;
  } finally {
    submit.disabled = false;
  }
});

document.querySelector("#account-logout").addEventListener("click", async () => {
  try {
    await readResponse(await fetch("/api/auth/logout", { method: "POST" }));
    window.location.assign("/");
  } catch (error) {
    document.querySelector("#password-error").textContent = error.message;
  }
});

loadAccount();
