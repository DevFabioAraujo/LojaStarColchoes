const createApp = require("./src/app");
const { initializeDatabase, closeDatabase } = require("./src/database");

const port = Number(process.env.PORT) || 3000;
const app = createApp();

initializeDatabase().then(() => {
  app.listen(port, () => console.log(`Star Colchões disponível em http://localhost:${port}`));
}).catch(error => {
  console.error("Não foi possível inicializar o banco de dados.", error);
  closeDatabase(() => {
    process.exitCode = 1;
  });
});
