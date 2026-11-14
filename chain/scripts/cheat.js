// Shows the contract saying no:  npm run cheat
//
// It asks the contract, in the name of the demo factory, to do four things a
// dishonest company might try. Nothing is sent and nothing is spent: each
// request is a rehearsal ("what would happen if..."), and the contract answers
// the same way it would for a real transaction.
//
// Run it after "npm run seed".

require("../agent/network");
const { ethers } = require("ethers");
const { describeError } = require("../agent/errors");
const { loadConfig, loadDemo } = require("../agent/config");
const { connect } = require("../agent/chain");
const { codeFor } = require("../agent/passport");
const { derive } = require("./seed");

const KG = 1000n;
const SEWING = 2;
const WEAVING = 0;
const hash = (text) => ethers.keccak256(ethers.toUtf8Bytes(text));

/** The contract's own words for a refusal, or null when it was not a refusal. */
function refusal(error) {
  if (!error) return null;
  if (error.reason) return error.reason;
  if (error.revert && error.revert.args && error.revert.args[0]) return String(error.revert.args[0]);
  const text = [error.shortMessage, error.message, error.info && error.info.error && error.info.error.message].filter(Boolean).join(" ");
  const match = /execution reverted:?\s*"?([^"\n]+?)"?(?:\s*\(|$)/i.exec(text) || /reverted with reason string '([^']+)'/i.exec(text);
  return match ? match[1].trim() : null;
}

async function main() {
  const cfg = loadConfig();
  const demo = loadDemo(cfg.demoFile);
  if (!demo || !demo.spare || !demo.spare.lot) throw new Error('There is no demo data yet. Run "npm run seed" first.');

  const chain = connect({
    rpcUrl: cfg.rpcUrl,
    chainId: cfg.deployment.chainId,
    privateKey: cfg.privateKey,
    address: cfg.deployment.address,
    abi: cfg.deployment.abi,
  });
  const factory = chain.contract.connect(new ethers.Wallet(derive(cfg.privateKey, "company:factory"), chain.provider));
  const factoryName = demo.companies.find((c) => c.key === "factory").name;

  const spare = await chain.contract.getLot(demo.spare.lot);
  const left = spare.grams / KG;
  console.log(`${factoryName} holds ${left} kg of fabric in lot ${codeFor(demo.spare.lot)}.\n`);

  const attempts = [
    {
      what: `It declares 600 kg of jeans made from those ${left} kg of fabric.`,
      call: () => factory.transform.staticCall([demo.spare.lot], [spare.grams], SEWING, 600n * KG, hash("too many jeans")),
    },
    {
      what: `It declares jeans made from lot ${codeFor(demo.spare.at)}, fabric that is still recorded at the mill.`,
      call: () => factory.transform.staticCall([demo.spare.at], [100n * KG], SEWING, 90n * KG, hash("fabric it never received")),
    },
    {
      what: "It records 500 kg of new fabric of its own, as if it were a mill.",
      call: () => factory.record.staticCall(WEAVING, 500n * KG, hash("invented fabric")),
    },
    {
      what: `It ships ${left + 100n} kg from a lot that holds ${left} kg.`,
      call: () => factory.ship.staticCall(demo.spare.lot, demo.companies.find((c) => c.key === "brand").address, (left + 100n) * KG, hash("more than it holds")),
    },
  ];

  let surprises = 0;
  for (const [index, attempt] of attempts.entries()) {
    console.log(`${index + 1}. ${attempt.what}`);
    try {
      await attempt.call();
      surprises += 1;
      console.log("   NOT REFUSED. The contract would have accepted this.\n");
    } catch (error) {
      const reason = refusal(error);
      if (reason) console.log(`   The contract refuses: "${reason}"\n`);
      else {
        surprises += 1;
        console.log(`   No clear answer from the network: ${describeError(error)}\n`);
      }
    }
  }

  console.log(surprises === 0 ? "All four were refused. Nothing was sent to the chain." : `${surprises} of 4 did not end as expected.`);
  process.exitCode = surprises === 0 ? 0 : 1;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(describeError(error));
    process.exitCode = 1;
  });
}

module.exports = { refusal };
