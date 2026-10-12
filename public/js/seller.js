async function loadSeller() {
  try {
    const response = await fetch("/api/auth/me");
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Não foi possível verificar o acesso.");
    if (!result.user) return window.location.replace("/account?returnTo=seller");
    if (result.user.role !== "seller") {
      return window.location.replace(result.user.role === "admin" ? "/admin" : "/");
    }
    document.querySelector("#seller-name").textContent = result.user.name;
  } catch (error) {
    console.error("Não foi possível verificar a sessão do vendedor.", error);
    document.querySelector("#seller-name").textContent = "sua conta";
  }
}

document.querySelector("#seller-logout").addEventListener("click", async () => {
  try {
    const response = await fetch("/api/auth/logout", { method: "POST" });
    if (!response.ok) throw new Error("Não foi possível encerrar a sessão.");
    window.location.assign("/");
  } catch (error) {
    console.error(error);
    alert(error.message);
  }
});

loadSeller();
