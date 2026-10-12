const bcrypt = require("bcryptjs");
const { all, run } = require("../database");
const { normalizeEmail, validateName, passwordError, safeUser } = require("../validation");
const { saveAuthenticatedSession, requireRole } = require("../middleware/auth");
const { loginLimiter, registrationLimiter } = require("../middleware/security");

const router = require("express").Router();

router.post("/api/auth/register", registrationLimiter, async (request, response, next) => {
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

router.post("/api/auth/login", loginLimiter, async (request, response, next) => {
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

router.get("/api/auth/me", async (request, response, next) => {
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

router.post("/api/auth/logout", (request, response, next) => {
  request.session.destroy(error => {
    if (error) return next(error);
    response.clearCookie("star.sid", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
    response.status(204).end();
  });
});

router.post("/api/auth/password", requireRole(), async (request, response, next) => {
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

module.exports = router;
