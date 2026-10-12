const path = require("node:path");
const express = require("express");
const { all } = require("../database");
const { publicDirectory } = require("../config/paths");

const router = express.Router();

function protectedPage(role, fileName) {
  return async (request, response, next) => {
    try {
      if (!request.session.userId) return response.redirect(`/account?returnTo=${role}`);
      const users = await all(
        "SELECT id, role, session_version FROM users WHERE id = ?",
        [request.session.userId],
      );
      const user = users[0];
      if (!user || user.session_version !== request.session.sessionVersion) {
        return response.redirect("/account");
      }
      if (user.role !== role) {
        if (user.role === "admin") return response.redirect("/admin");
        if (user.role === "seller") return response.redirect("/seller");
        return response.redirect("/");
      }
      response.sendFile(path.join(publicDirectory, fileName));
    } catch (error) {
      next(error);
    }
  };
}

router.get("/account", (request, response) => response.sendFile(path.join(publicDirectory, "account.html")));
router.get("/seller", protectedPage("seller", "seller.html"));
router.get("/admin", protectedPage("admin", "admin.html"));
router.get("*", (request, response) => response.sendFile(path.join(publicDirectory, "index.html")));

module.exports = router;
