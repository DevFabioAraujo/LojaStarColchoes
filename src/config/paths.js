const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..", "..");
const dataDirectory = process.env.DATA_DIRECTORY
  ? path.resolve(process.env.DATA_DIRECTORY)
  : path.join(projectRoot, "data");
const publicDirectory = path.join(projectRoot, "public");

fs.mkdirSync(dataDirectory, { recursive: true });

module.exports = { projectRoot, dataDirectory, publicDirectory };
