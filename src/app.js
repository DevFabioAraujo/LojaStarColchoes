const express = require("express");
const { configureSecurity } = require("./middleware/security");
const authRoutes = require("./routes/auth");
const adminRoutes = require("./routes/admin");
const storeRoutes = require("./routes/store");
const pageRoutes = require("./routes/pages");

function createApp() {
  const app = express();
  configureSecurity(app);
  app.use(authRoutes);
  app.use(adminRoutes);
  app.use(storeRoutes);
  app.use(pageRoutes);
  app.use((error, request, response, next) => {
    console.error("Erro na API:", error);
    if (response.headersSent) return next(error);
    response.status(500).json({ error: "Ocorreu um erro ao processar sua solicitação." });
  });
  return app;
}

module.exports = createApp;
