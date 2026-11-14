// Starts the agent:  npm run agent
//
// It needs a deployed contract (deployments/<network>.json) and a filled .env.
// Run "npm run agent:check" first to test every connection.

require("./network");
const path = require("path");
const { describeError } = require("./errors");
const { loadConfig, loadDemo, saveTopicId } = require("./config");
const { connect, explorerFor } = require("./chain");
const { resolveAccountId, createHederaLog, createFileLog } = require("./hcs");
const { createGroq } = require("./llm");
const { createStore } = require("./store");
const { createReader } = require("./passport");
const { createApp } = require("./api");
const { createPictures } = require("./pictures");
const { loadSamples } = require("./samples");

async function main() {
  const cfg = loadConfig();
  const { deployment } = cfg;

  const chain = connect({
    rpcUrl: cfg.rpcUrl,
    chainId: deployment.chainId,
    privateKey: cfg.privateKey,
    address: deployment.address,
    abi: deployment.abi,
  });
  const owner = await chain.contract.owner();

  let log;
  if (cfg.localLog) {
    log = createFileLog(path.join(cfg.dataDir, "local-log.jsonl"));
  } else {
    const accountId = await resolveAccountId({
      accountId: cfg.accountId,
      evmAddress: chain.wallet.address,
      mirrorUrl: cfg.mirrorUrl,
    });
    log = createHederaLog({ accountId, privateKey: cfg.privateKey, topicId: cfg.topicId || null });
    const { topicId, created } = await log.ensureTopic(`Thread passport agent log ${deployment.address}`);
    if (created) saveTopicId(cfg.deploymentFile, topicId);
  }

  const llm = createGroq({ apiKey: cfg.groqKey, model: cfg.groqModel, baseUrl: cfg.groqBaseUrl });
  let modelNote = "";
  try {
    const { replaced } = await llm.ready();
    if (replaced) modelNote = `  ("${replaced}" is not offered to this key)`;
  } catch (error) {
    // Not fatal at start-up: a check simply fails with a clear message until the model answers.
    modelNote = `  (could not be confirmed: ${describeError(error).split("\n")[0]})`;
  }

  const store = createStore(cfg.dataDir, deployment.address);
  const reader = createReader({ contract: chain.contract, store });
  const explorer = explorerFor(deployment.chainId);

  const app = createApp({
    reader,
    contract: chain.contract,
    llm,
    log,
    store,
    maxPaperChars: cfg.maxPaperChars,
    staticDir: cfg.staticDir,
    pictures: createPictures({
      frontendDir: cfg.frontendDir,
      cacheDir: path.join(cfg.dataDir, "pictures"),
      localDir: cfg.picturesDir,
      site: cfg.lovableSite,
    }),
    // Read on every request, so "npm run seed" shows up without a restart.
    samples: () => loadSamples(cfg.demoDir, loadDemo(cfg.demoFile)),
    info: {
      network: cfg.network,
      chainId: deployment.chainId,
      contract: deployment.address,
      abi: deployment.abi,
      owner,
      explorer,
      demo: () => loadDemo(cfg.demoFile),
    },
  });

  const stats = await reader.stats();
  const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  // Only this computer can reach the agent, unless HOST says otherwise.
  app.listen(cfg.port, cfg.host, (error) => {
    if (error) {
      const why = error.code === "EADDRINUSE"
        ? `Port ${cfg.port} is already in use. Another agent is probably still running: stop it with Ctrl+C in its terminal, or set PORT=3001 in .env.`
        : describeError(error);
      console.error(`\nThe agent could not start.\n${why}`);
      process.exit(1);
    }
    console.log(`Contract        ${deployment.address}`);
    if (explorer) console.log(`                ${explorer}/contract/${deployment.address}`);
    console.log(`                ${count(stats.companies, "company", "companies")}, ${count(stats.lots, "lot", "lots")}, ${count(stats.shipments, "shipment", "shipments")}`);
    console.log(`Agent account   ${chain.wallet.address}`);
    console.log(`Check log       ${log.kind === "hedera" ? `topic ${log.topicId}` : "local file (development only)"}`);
    if (explorer && log.kind === "hedera") console.log(`                ${explorer}/topic/${log.topicId}`);
    console.log(`Model           ${llm.model}${modelNote}`);
    if (stats.lots === 0) console.log(`\nThe chain holds no lot yet. For demo data, run:  npm run seed`);
    console.log(`\nThread is running at http://localhost:${cfg.port}  (stop it with Ctrl+C)`);
  });
}

main().catch((error) => {
  console.error(`\nThe agent could not start.\n${describeError(error)}`);
  process.exit(1);
});
