// Copies the pages, built as static files, into chain/web, where the agent
// serves them. It is the second half of "npm run build:static", run from the
// top of the repository.

const fs = require("fs");
const path = require("path");

const built = path.join(__dirname, "..", "..", "dist", "client");
const target = path.join(__dirname, "..", "web");

if (!fs.existsSync(path.join(built, "_shell.html"))) {
  console.error(`No built pages in ${path.relative(process.cwd(), built)}. Run "npm run build:static" from the top of the repository.`);
  process.exit(1);
}

fs.rmSync(target, { recursive: true, force: true });
fs.cpSync(built, target, { recursive: true });
const files = fs.readdirSync(path.join(target, "assets")).length;
console.log(`Pages copied to ${path.relative(process.cwd(), target)} (${files} files in assets). The agent serves them at its own address.`);
