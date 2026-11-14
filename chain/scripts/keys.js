// Shows the demo companies' accounts:  npm run demo:keys
//
// "npm run seed" gives each demo company its own Hedera testnet account, as a
// real company would have. Their keys are derived from the agent's key, so they
// are stored nowhere. This prints them, so that one can be imported into
// MetaMask to act as that company on the "For companies" page.
//
// These keys only open demo accounts holding a few test HBAR. Treat them like
// any key all the same: not in a chat, not in a screenshot, not in a commit.

const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");
const { describeError } = require("../agent/errors");
const { loadConfig } = require("../agent/config");
const { derive } = require("./seed");

function main() {
  const cfg = loadConfig();
  const seed = JSON.parse(fs.readFileSync(path.join(cfg.demoDir, "seed.json"), "utf8"));

  console.log("Demo companies. Test accounts made for this demo, nothing else.\n");
  for (const company of seed.companies) {
    const wallet = new ethers.Wallet(derive(cfg.privateKey, `company:${company.key}`));
    console.log(`${company.name}, ${company.country}${company.source ? "  (can record new material)" : ""}`);
    console.log(`  address      ${wallet.address}`);
    console.log(`  private key  ${wallet.privateKey}\n`);
  }
  console.log("To act as one of them on the page: in MetaMask, open the account menu,");
  console.log('choose "Add account or hardware wallet", then "Import account", and paste its private key.');
  console.log("Do not show this screen in a recording or a screenshot.");
}

try {
  main();
} catch (error) {
  console.error(describeError(error));
  process.exitCode = 1;
}
