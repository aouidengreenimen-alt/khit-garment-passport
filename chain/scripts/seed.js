// Puts the demo journeys on the chain:  npm run seed
//
// It approves the demo companies listed in demo/seed.json, gives each one a
// little HBAR for its fees, and then lets each company record its own steps:
// the mill records its fabric and ships it, the factory confirms, sews and
// ships, the brand confirms. Run it once after deploying. It is safe to run
// again: steps that are already on the chain are skipped.
//
// Each demo company has its own Hedera account, as a real one would. Their
// keys are derived from the agent's key, so there is nothing more to store.

require("../agent/network");
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");
const { describeError } = require("../agent/errors");
const { loadConfig } = require("../agent/config");
const { connect, explorerFor } = require("../agent/chain");
const { createStore } = require("../agent/store");
const { remember } = require("../agent/proofs");
const { codeFor } = require("../agent/passport");
const { STEP_NAMES, buildStepDetails, buildNoteDetails, hashDetails, toGrams } = require("../agent/details");

const FEES = ethers.parseEther("5"); // test HBAR sent to each demo company
const LOW = ethers.parseEther("2"); // below this, a company gets a refill
const PAUSES = [4000, 8000]; // waits before trying a step again, in milliseconds

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const hbar = (wei) => Number(ethers.formatEther(wei)).toFixed(2);
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

function derive(adminKey, label) {
  return ethers.keccak256(ethers.toUtf8Bytes(`${adminKey}|thread demo|${label}`));
}

/** A contract's own refusal ("More out than in"...) will not change by asking again. */
function isRefusal(error) {
  if (!error) return false;
  if (error.code === "INVALID_ARGUMENT") return true;
  return error.code === "CALL_EXCEPTION" && Boolean(error.reason || error.revert);
}

/**
 * Does one step unless it is already done. A public relay sometimes answers a
 * moment late, so a step that fails is checked and tried again before giving up.
 * Returns true when the step was done now, false when it was done already.
 */
async function step(isDone, act, pauses = PAUSES) {
  for (let attempt = 0; ; attempt++) {
    try {
      if (await isDone()) return attempt > 0;
      await act();
      return true;
    } catch (error) {
      if (attempt >= pauses.length || isRefusal(error)) throw error;
      console.log(`             not yet (${describeError(error)}); trying again in ${pauses[attempt] / 1000} s`);
      await sleep(pauses[attempt]);
    }
  }
}

/** What is on the chain, read once and then kept up to date from each transaction. */
function createLedger(contract) {
  const lots = new Map();
  const shipments = new Map();

  async function sync() {
    const [lotCount, shipmentCount] = await Promise.all([contract.lotCount(), contract.shipmentCount()]);
    const missing = [];
    for (let id = 1; id <= Number(lotCount); id++) if (!lots.has(id)) missing.push(id);
    for (let i = 0; i < missing.length; i += 6) {
      const loaded = await Promise.all(missing.slice(i, i + 6).map((id) => contract.getLot(id)));
      loaded.forEach((lot, k) => lots.set(missing[i + k], lot));
    }
    // Shipments change (sent, then received), so they are read again every time.
    const ids = Array.from({ length: Number(shipmentCount) }, (_, i) => i + 1);
    for (let i = 0; i < ids.length; i += 6) {
      const loaded = await Promise.all(ids.slice(i, i + 6).map((id) => contract.getShipment(id)));
      loaded.forEach((shipment, k) => shipments.set(ids[i + k], shipment));
    }
  }

  return {
    sync,
    /** The lot a company made with exactly this wording, or 0. */
    madeLot(maker, detailsHash) {
      for (const [id, lot] of lots) if (lot.shipment === 0n && lot.detailsHash === detailsHash && same(lot.maker, maker)) return id;
      return 0;
    },
    /** The shipment a company sent with exactly this delivery note, or null. */
    shipment(from, detailsHash) {
      for (const [id, shipment] of shipments) if (shipment.detailsHash === detailsHash && same(shipment.from, from)) return { id, ...shipment.toObject() };
      return null;
    },
  };
}

async function main() {
  const cfg = loadConfig();
  const { deployment } = cfg;
  const seed = JSON.parse(fs.readFileSync(path.join(cfg.demoDir, "seed.json"), "utf8"));
  const explorer = explorerFor(deployment.chainId);

  const chain = connect({
    rpcUrl: cfg.rpcUrl,
    chainId: deployment.chainId,
    privateKey: cfg.privateKey,
    address: deployment.address,
    abi: deployment.abi,
  });
  const passport = chain.contract;
  const admin = chain.wallet;
  const store = createStore(cfg.dataDir, deployment.address);

  const owner = await passport.owner();
  if (!same(owner, admin.address)) {
    throw new Error(`Only the contract's owner can approve companies. The owner is ${owner}, and the key in .env belongs to ${admin.address}.`);
  }

  const companies = new Map();
  for (const entry of seed.companies) {
    const wallet = new ethers.Wallet(derive(cfg.privateKey, `company:${entry.key}`), chain.provider);
    companies.set(entry.key, { ...entry, wallet, contract: passport.connect(wallet) });
  }

  // Enough HBAR for the whole run? Better to know now than halfway through.
  let toSend = 0n;
  for (const company of companies.values()) {
    if ((await chain.provider.getBalance(company.wallet.address)) < LOW) toSend += FEES;
  }
  const balance = await chain.provider.getBalance(admin.address);
  const needed = toSend + ethers.parseEther("3"); // plus this account's own fees
  console.log(`Contract     ${deployment.address}`);
  console.log(`Paying       ${admin.address}, which holds ${hbar(balance)} HBAR\n`);
  if (balance < needed) {
    throw new Error(`This needs about ${hbar(needed)} HBAR and the account holds ${hbar(balance)}. Refill it in the Hedera Portal (portal.hedera.com), then run this again.`);
  }

  /** Sends a transaction, waits for it, and remembers it as the proof of what it recorded. */
  async function send(call) {
    const receipt = await (await call()).wait();
    remember(store, receipt, passport);
    return receipt;
  }

  // 1. Companies: approve each one and give it a little HBAR for its fees.
  for (const company of companies.values()) {
    const { wallet, name, country } = company;
    const source = Boolean(company.source);
    const approvedNow = await step(
      async () => {
        const current = await passport.getCompany(wallet.address);
        return current.approved && current.name === name && current.country === country && current.source === source;
      },
      () => send(() => passport.approveCompany(wallet.address, name, country, source))
    );
    console.log(`Company      ${name}, ${country}: ${approvedNow ? "approved" : "already approved"} (${wallet.address})`);

    const fundedNow = await step(
      async () => (await chain.provider.getBalance(wallet.address)) >= LOW,
      async () => (await admin.sendTransaction({ to: wallet.address, value: FEES })).wait()
    );
    if (fundedNow) console.log(`             sent ${ethers.formatEther(FEES)} test HBAR for its fees`);
  }

  // 2. Journeys: each company records its own steps.
  const ledger = createLedger(passport);
  await ledger.sync();
  const journeys = {};
  const spare = {};

  for (const journey of seed.journeys) {
    console.log(`\nJourney ${journey.key}: ${journey.about}`);
    const lots = new Map(); // the name a lot has in seed.json, to its number on the chain
    const lotOf = (name) => {
      if (!lots.has(name)) throw new Error(`demo/seed.json: journey ${journey.key} uses "${name}" before making it.`);
      return lots.get(name);
    };

    for (const [index, entry] of journey.steps.entries()) {
      const company = companies.get(entry.by);
      if (!company) throw new Error(`demo/seed.json: journey ${journey.key} names an unknown company "${entry.by}".`);
      // A fixed salt, so running the script again finds the same record instead of adding a copy.
      const salt = derive(cfg.privateKey, `salt:${journey.key}:${index}`).slice(2, 34);

      if (entry.do === "record" || entry.do === "make") {
        const details = buildStepDetails(entry, salt);
        const detailsHash = hashDetails(details);
        store.putDetails(detailsHash, details);
        const stepNumber = STEP_NAMES.indexOf(details.step);
        const grams = toGrams(entry.kg);

        const madeNow = await step(
          async () => {
            await ledger.sync();
            return ledger.madeLot(company.wallet.address, detailsHash) > 0;
          },
          () =>
            send(() =>
              entry.do === "record"
                ? company.contract.record(stepNumber, grams, detailsHash)
                : company.contract.transform(entry.from.map(([name]) => lotOf(name)), entry.from.map(([, kg]) => toGrams(kg)), stepNumber, grams, detailsHash)
            )
        );
        await step(async () => (await ledger.sync(), ledger.madeLot(company.wallet.address, detailsHash) > 0), async () => {
          throw new Error("the new lot is not visible yet");
        });
        const id = ledger.madeLot(company.wallet.address, detailsHash);
        lots.set(entry.as, id);
        console.log(`  ${codeFor(id).padEnd(8)} ${company.name}: ${details.step}, ${entry.kg} kg, ${details.product}${madeNow ? "" : " (already recorded)"}`);
      } else if (entry.do === "ship") {
        const receiver = companies.get(entry.to);
        if (!receiver) throw new Error(`demo/seed.json: journey ${journey.key} ships to an unknown company "${entry.to}".`);
        const details = buildNoteDetails(entry, salt);
        const detailsHash = hashDetails(details);
        store.putDetails(detailsHash, details);
        const find = async () => (await ledger.sync(), ledger.shipment(company.wallet.address, detailsHash));

        const sentNow = await step(
          async () => Boolean(await find()),
          () => send(() => company.contract.ship(lotOf(entry.lot), receiver.wallet.address, toGrams(entry.kg), detailsHash))
        );
        let shipment = null;
        await step(async () => Boolean((shipment = await find())), async () => {
          throw new Error("the shipment is not visible yet");
        });

        // The handover only counts once the receiver confirms it, with its own account.
        const confirmedNow = await step(
          async () => Number((await find()).status) === 2,
          () => send(() => receiver.contract.confirm(shipment.id))
        );
        await step(async () => Number((shipment = await find()).received) > 0, async () => {
          throw new Error("the delivery is not visible yet");
        });
        const id = Number(shipment.received);
        lots.set(entry.as, id);
        console.log(`  ${codeFor(id).padEnd(8)} ${company.name} to ${receiver.name}: ${entry.kg} kg, note ${details.reference}${sentNow || confirmedNow ? "" : " (already delivered)"}`);
      } else {
        throw new Error(`demo/seed.json: unknown action "${entry.do}".`);
      }
    }

    journeys[journey.key] = { lot: lotOf("final"), code: codeFor(lotOf("final")), about: journey.about };
    // Fabric the factory received and has not used up: "npm run cheat" plays with it.
    if (!spare.lot && lots.has("fabricA@factory")) {
      spare.lot = lots.get("fabricA@factory");
      spare.at = lots.get("fabricA");
    }
  }

  fs.writeFileSync(
    cfg.demoFile,
    JSON.stringify(
      {
        network: cfg.network,
        contract: deployment.address,
        companies: [...companies.values()].map((c) => ({ key: c.key, name: c.name, country: c.country, address: c.wallet.address })),
        journeys,
        spare,
        seededAt: new Date().toISOString(),
      },
      null,
      2
    ) + "\n"
  );

  console.log(`\nThe demo journeys are on the chain.`);
  for (const [key, journey] of Object.entries(journeys)) console.log(`  Journey ${key}: passport ${journey.code}`);
  if (explorer) console.log(`See the contract on HashScan: ${explorer}/contract/${deployment.address}`);
  console.log(`Start the agent with:  npm run agent`);
}

if (require.main === module) {
  main().catch((error) => {
    // Something missing before the start is not something to try again.
    const again = error && error.setup ? "" : `\nRun "npm run seed" again: it continues where it stopped.`;
    console.error(`\nThe demo data could not be finished.\n${describeError(error)}${again}`);
    process.exitCode = 1;
  });
}

module.exports = { step, isRefusal, derive };
