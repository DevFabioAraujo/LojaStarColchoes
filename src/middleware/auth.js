const { all } = require("../database");

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

module.exports = { saveAuthenticatedSession, requireRole };
