// Tests every connection the agent needs:  npm run agent:check
//
// Run it before a demo. Each line says OK or names the problem.

require("./network");
const path = require("path");
const { ethers } = require("ethers");
const { describeError } = require("./errors");
const { loadConfig, loadDemo, saveTopicId } = require("./config");
const { connect, explorerFor } = require("./chain");
const { resolveAccountId, createHederaLog, createFileLog } = require("./hcs");
const { createGroq } = require("./llm");
const { createStore } = require("./store");
const { createReader, findCode } = require("./passport");
const { checkPaper } = require("./checker");
const { loadSamples } = require("./samples");

let problems = 0;
const ok = (label, detail = "") => console.log(`OK       ${label}${detail ? `  ${detail}` : ""}`);
const bad = (label, detail) => {
  problems += 1;
  console.log(`PROBLEM  ${label}\n         ${String(detail).split("\n").join("\n         ")}`);
};

async function step(label, fn) {
  try {
    const detail = await fn();
    ok(label, detail || "");
    return true;
  } catch (error) {
    bad(label, describeError(error));
    return false;
  }
}

// A tiny passport and paper that exist only inside this check.
const company = (name, country) => ({ name, country, address: ethers.ZeroAddress, approved: true });
const SAMPLE_PASSPORT = {
  lot: 2,
  code: "KHIT-2",
  holder: company("Test Factory", "Tunisia"),
  kg: 100,
  madeKg: 100,
  product: "Test shirts",
  reference: "T-2",
  pieces: 400,
  origins: {},
  warnings: [],
  lines: [
    { n: 1, type: "step", lot: 1, step: "weaving", company: company("Test Mill", "Turkey"), at: 0, kg: 120, product: "Cotton poplin", reference: "T-1", pieces: null, note: "", standing: "valid", withdrawnAt: null },
    { n: 2, type: "step", lot: 2, step: "sewing", company: company("Test Factory", "Tunisia"), at: 0, kg: 100, product: "Test shirts", reference: "T-2", pieces: 400, note: "", standing: "valid", withdrawnAt: null },
  ],
};
const SAMPLE_PAPER = ["Delivery note", "Passport: KHIT-2", "400 shirts", "Fabric woven in Italy", "Sewn in Tunisia"].join("\n");

const WORDS = { verified: "on Hedera", differs: "chain says otherwise", withdrawn: "withdrawn", not_found: "no record" };
const tell = (counts) => Object.keys(WORDS).filter((k) => counts[k]).map((k) => `${counts[k]} ${WORDS[k]}`).join(", ") || "no statement found";

async function main() {
  let cfg;
  if (!(await step("Settings and deployed contract found", () => { cfg = loadConfig(); }))) return;
  const { deployment } = cfg;
  const explorer = explorerFor(deployment.chainId);

  const chain = connect({
    rpcUrl: cfg.rpcUrl,
    chainId: deployment.chainId,
    privateKey: cfg.privateKey,
    address: deployment.address,
    abi: deployment.abi,
  });

  await step("Network reachable", async () => {
    const reported = Number(await chain.provider.send("eth_chainId", []));
    if (reported !== deployment.chainId) {
      throw new Error(`The network says chain ${reported}, the contract was deployed on chain ${deployment.chainId}. Check HEDERA_RPC_URL.`);
    }
    return `chain ${reported}`;
  });

  await step("Agent account has HBAR for fees", async () => {
    const balance = await chain.provider.getBalance(chain.wallet.address);
    if (balance === 0n) throw new Error(`${chain.wallet.address} has no HBAR. Refill it in the Hedera Portal.`);
    return `${chain.wallet.address} holds ${Number(ethers.formatEther(balance)).toFixed(2)}`;
  });

  const store = createStore(cfg.dataDir, deployment.address);
  const reader = createReader({ contract: chain.contract, store });
  const demo = loadDemo(cfg.demoFile);
  await step("Contract answers", async () => {
    const stats = await reader.stats();
    const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;
    const seeded = demo ? "demo journeys present" : "no demo data yet (npm run seed)";
    return `${deployment.address}, ${count(stats.companies, "company", "companies")}, ${count(stats.lots, "lot", "lots")}, ${seeded}`;
  });

  let log = null;
  if (cfg.localLog) {
    log = createFileLog(path.join(cfg.dataDir, "local-log.jsonl"));
    ok("Check log", "local file (development only)");
  } else {
    await step("Check log on Hedera (writes one test message)", async () => {
      const accountId = await resolveAccountId({
        accountId: cfg.accountId,
        evmAddress: chain.wallet.address,
        mirrorUrl: cfg.mirrorUrl,
      });
      log = createHederaLog({ accountId, privateKey: cfg.privateKey, topicId: cfg.topicId || null });
      const { topicId, created } = await log.ensureTopic(`Thread passport agent log ${deployment.address}`);
      if (created) saveTopicId(cfg.deploymentFile, topicId);
      const sent = await log.submit(
        JSON.stringify({ v: 1, type: "check", contract: deployment.address, at: new Date().toISOString() })
      );
      const where = explorer ? `${explorer}/topic/${topicId}` : topicId;
      return `account ${accountId}, ${created ? "new " : ""}topic ${topicId}, message #${sent.sequenceNumber}\n         ${where}`;
    });
  }

  let llm = null;
  const modelReady = await step("Language model key works", async () => {
    llm = createGroq({ apiKey: cfg.groqKey, model: cfg.groqModel, baseUrl: cfg.groqBaseUrl });
    const { model, replaced } = await llm.ready();
    return replaced ? `using ${model}, because "${replaced}" is not offered to this key` : model;
  });

  if (modelReady) {
    await step("Agent can check a small paper", async () => {
      const report = await checkPaper({ llm, paper: SAMPLE_PAPER, passport: SAMPLE_PASSPORT });
      const shown = report.claims.map((c) => `${c.n}:${c.status}`).join(" ");
      const weaving = report.claims.find((c) => c.kind === "weaving");
      const sewing = report.claims.find((c) => c.kind === "sewing");
      if (!weaving || weaving.status !== "differs" || !sewing || sewing.status !== "verified") {
        throw new Error(`Expected "woven in Italy" to differ from the chain and "sewn in Tunisia" to agree, got: ${shown || "no statement found"}. Try another GROQ_MODEL.`);
      }
      return shown;
    });

    // Two sample papers of the demo, against the journeys on the chain. Not written to the log.
    for (const sample of loadSamples(cfg.demoDir, demo).filter((s) => s.expect).slice(0, 2)) {
      await step(`Sample "${sample.label}" gives the expected report`, async () => {
        const passport = await reader.passport(findCode(sample.text));
        if (!passport) throw new Error(`The sample names a passport that is not on the chain. Run "npm run seed" again.`);
        const report = await checkPaper({ llm, paper: sample.text, passport });
        const off = Object.entries(sample.expect).filter(([status, [least, most]]) => report.counts[status] < least || report.counts[status] > most);
        if (off.length) {
          const wanted = Object.entries(sample.expect).map(([status, [least, most]]) => `${least === most ? least : `${least} to ${most}`} ${WORDS[status]}`).join(", ");
          const lines = report.claims.map((c) => `${c.n}. ${WORDS[c.status]}: ${c.claim} (${c.note})`).join("\n");
          throw new Error(`Expected ${wanted}. Got ${tell(report.counts)}:\n${lines}\nThe model read this paper differently. Run the check again, or try another GROQ_MODEL.`);
        }
        return `${passport.code}: ${tell(report.counts)}`;
      });
    }
  }

  if (log) log.close();
  console.log(problems === 0 ? "\nEverything is ready. Start the agent with:  npm run agent" : `\n${problems} problem${problems === 1 ? "" : "s"} to fix, then run this check again.`);
  process.exitCode = problems === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(describeError(error));
  process.exitCode = 1;
});
