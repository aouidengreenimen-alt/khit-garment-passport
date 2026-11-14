// Reads the settings from .env and the deployed contract's details.

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
require("dotenv").config({ path: path.join(ROOT, ".env"), quiet: true });

function env(name, fallback = "") {
  return (process.env[name] || "").trim() || fallback;
}

function deploymentFile(network) {
  return path.join(ROOT, "deployments", `${network}.json`);
}

function loadConfig() {
  const network = env("AGENT_NETWORK", "hederaTestnet");

  const file = deploymentFile(network);
  if (!fs.existsSync(file)) {
    const how = network === "hederaTestnet" ? "npm run deploy:testnet" : `npx hardhat run scripts/deploy.js --network ${network}`;
    const error = new Error(`The contract is not deployed yet (deployments/${network}.json is missing). Deploy it first:\n  ${how}`);
    error.setup = true;
    throw error;
  }
  const deployment = JSON.parse(fs.readFileSync(file, "utf8"));

  const rawKey = env("AGENT_PRIVATE_KEY");
  if (!rawKey) {
    const error = new Error("AGENT_PRIVATE_KEY is empty. Copy .env.example to .env in this folder and fill it in.");
    error.setup = true;
    throw error;
  }

  return {
    root: ROOT,
    network,
    deployment,
    deploymentFile: file,
    privateKey: rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`,
    rpcUrl: env("HEDERA_RPC_URL", "https://testnet.hashio.io/api"),
    mirrorUrl: env("HEDERA_MIRROR_URL", "https://testnet.mirrornode.hedera.com"),
    accountId: env("AGENT_ACCOUNT_ID"),
    // The log topic belongs to this deployment and is saved next to its address.
    // (THREAD_TOPIC_ID only exists to point at another topic on purpose.)
    topicId: env("THREAD_TOPIC_ID") || deployment.hcsTopicId || "",
    groqKey: env("GROQ_API_KEY"),
    groqModel: env("GROQ_MODEL", "openai/gpt-oss-120b"),
    groqBaseUrl: env("GROQ_BASE_URL", "https://api.groq.com/openai/v1"),
    localLog: env("LOCAL_LOG") === "1",
    port: Number(env("PORT", "3000")),
    host: env("HOST", "127.0.0.1"),
    maxPaperChars: Number(env("MAX_PAPER_CHARS", "8000")),
    // How long an answer read from the chain is remembered, to stay within the public relay's limits.
    readCacheMs: Math.max(0, Number(env("READ_CACHE_SECONDS", "30")) || 0) * 1000,
    demoFile: path.join(ROOT, "deployments", `${network}.demo.json`),
    demoDir: path.join(ROOT, "demo"),
    dataDir: path.join(ROOT, "agent", "data"),
    // The pages, built as static files from the front end at the top of the repository.
    staticDir: path.join(ROOT, "web"),
    // Where the front end's own source lives: the pictures it uses are described there.
    frontendDir: path.join(ROOT, ".."),
    // The published Lovable site, used only to fetch those pictures. Optional.
    lovableSite: env("LOVABLE_SITE"),
    // Pictures placed here by hand are used before anything is fetched.
    picturesDir: path.join(ROOT, "pictures"),
  };
}

/** The demo data written by scripts/seed.js, or null when it has not run. */
function loadDemo(file) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
}

/** Remembers the log topic next to the contract address, so the page can link to it. */
function saveTopicId(file, topicId) {
  const deployment = JSON.parse(fs.readFileSync(file, "utf8"));
  const { abi, ...rest } = deployment;
  fs.writeFileSync(file, JSON.stringify({ ...rest, hcsTopicId: topicId, abi }, null, 2) + "\n");
}

module.exports = { loadConfig, loadDemo, saveTopicId };
