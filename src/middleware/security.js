const path = require("node:path");
const crypto = require("node:crypto");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);
const { rateLimit } = require("express-rate-limit");
const helmet = require("helmet");
const { dataDirectory, publicDirectory } = require("../config/paths");

const sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
if (process.env.NODE_ENV === "production" && !process.env.SESSION_SECRET) {
  throw new Error("Configure SESSION_SECRET antes de iniciar em produção.");
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Muitas tentativas. Aguarde alguns minutos e tente novamente." },
});
const registrationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Muitas contas criadas. Tente novamente mais tarde." },
});

function configureSecurity(app) {
  if (process.env.TRUST_PROXY) {
    const proxyHops = Number(process.env.TRUST_PROXY);
    app.set("trust proxy", Number.isInteger(proxyHops) && proxyHops >= 0 ? proxyHops : process.env.TRUST_PROXY);
  }

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        connectSrc: ["'self'", "https://viacep.com.br"],
        imgSrc: ["'self'", "data:", "https://images.unsplash.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        styleSrc: ["'self'", "https://fonts.googleapis.com"],
        scriptSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
  }));
  app.use(require("express").json({ limit: "30kb" }));
  app.use("/css", require("express").static(path.join(publicDirectory, "css"), { dotfiles: "deny" }));
  app.use("/js", require("express").static(path.join(publicDirectory, "js"), { dotfiles: "deny" }));
  app.use(session({
    name: "star.sid",
    secret: sessionSecret,
    store: new SQLiteStore({ db: "sessions.sqlite", dir: dataDirectory, table: "sessions" }),
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 12 * 60 * 60 * 1000,
    },
  }));

  app.use("/api", (request, response, next) => {
    if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) {
      const origin = request.get("Origin");
      if (origin) {
        try {
          const parsedOrigin = new URL(origin);
          if (parsedOrigin.host !== request.get("host") || parsedOrigin.protocol !== `${request.protocol}:`) {
            return response.status(403).json({ error: "Origem da solicitação não permitida." });
          }
        } catch {
          return response.status(403).json({ error: "Origem da solicitação inválida." });
        }
      }
    }
    next();
  });
}

module.exports = { configureSecurity, loginLimiter, registrationLimiter };
