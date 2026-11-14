// The small web API the pages talk to, and the server for the pages themselves.

const fs = require("fs");
const path = require("path");
const express = require("express");
const { ethers } = require("ethers");
const { STEPS, InvalidDetails, buildStepDetails, buildNoteDetails, hashDetails } = require("./details");
const { codeFor, findCode } = require("./passport");
const { checkPaper, logEntry } = require("./checker");
const { remember } = require("./proofs");
const { hashText } = require("./hashes");
const { describeError } = require("./errors");

/** The browser build that ships inside the ethers package, so the pages need no CDN for it. */
function ethersBrowserBundle() {
  return path.join(path.dirname(require.resolve("ethers")), "..", "dist", "ethers.umd.min.js");
}

/** A valid address in its standard spelling, or null. */
function address(value) {
  try {
    return ethers.getAddress(String(value || "").trim().toLowerCase());
  } catch {
    return null;
  }
}

/**
 * @param reader    what createReader() returned
 * @param contract  the passport contract (used to read transaction receipts)
 * @param llm       { model, complete(messages) }
 * @param log       the public log, see hcs.js
 * @param store     the agent's own file, see store.js
 * @param info      { network, chainId, contract, abi, owner, explorer, demo() }
 * @param pictures  optional handler for the pictures the pages use, see pictures.js
 */
function createApp({ reader, contract, llm, log, store, info, samples = () => [], pictures = null, maxPaperChars = 8000, staticDir = null, logger = console }) {
  const app = express();
  app.use(express.json({ limit: "200kb" }));

  // The pages may be served from another port while they are being worked on.
  app.use(["/api", "/vendor"], (req, res, next) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return res.status(204).end();
    next();
  });

  const fail = (res, code, error) => res.status(code).json({ error });
  const link = (kind, value) => (info.explorer && value ? `${info.explorer}/${kind}/${value}` : null);
  const onHedera = () => Boolean(log.topicId) && log.topicId !== "local-file";

  /** The transaction that wrote a record, or the contract's own page when the agent does not know it. */
  function proof(key) {
    const transaction = store.getProof(key);
    return transaction ? link("transaction", transaction) : link("contract", info.contract);
  }

  app.get("/api/health", (req, res) => res.json({ ok: true }));

  app.get("/api/config", (req, res) => {
    res.json({
      live: true,
      network: info.network,
      chainId: info.chainId,
      contract: info.contract,
      abi: info.abi,
      owner: info.owner,
      steps: STEPS,
      model: llm.model,
      logTopicId: log.topicId,
      explorer: info.explorer,
      links: { contract: link("contract", info.contract), log: onHedera() ? link("topic", log.topicId) : null },
      maxPaperChars,
      demo: info.demo(),
    });
  });

  app.get("/api/companies", async (req, res) => {
    res.json(await reader.companies());
  });

  // Lots that still hold something: each one has a passport worth opening.
  app.get("/api/passports", async (req, res) => {
    const lots = await reader.lots();
    res.json(
      lots
        .filter((lot) => lot.kg > 0 && !lot.withdrawn)
        .map((lot) => ({
          code: lot.code,
          lot: lot.lot,
          product: lot.product || "Lot without wording",
          pieces: lot.pieces,
          kg: lot.kg,
          holder: lot.holder,
          holderCountry: lot.holderCountry,
        }))
    );
  });

  app.get("/api/passports/:code", async (req, res) => {
    const raw = String(req.params.code || "");
    const lot = /^\d{1,9}$/.test(raw) ? Number(raw) : findCode(raw);
    if (!lot) return fail(res, 400, "A passport code looks like KHIT-6.");
    const passport = await reader.passport(lot);
    if (!passport) return fail(res, 404, `Passport ${codeFor(lot)} does not exist on the chain.`);
    for (const line of passport.lines) {
      line.proof = line.type === "step" ? proof(`lot:${line.lot}`) : proof(`shipment:${line.shipment}:closed`);
    }
    res.json(passport);
  });

  app.get("/api/samples", (req, res) => res.json(samples().map(({ id, label, text }) => ({ id, label, text }))));

  // What one company sees on its own page.
  app.get("/api/workspace/:address", async (req, res) => {
    const who = address(req.params.address);
    if (!who) return fail(res, 400, "That is not a valid address.");
    res.json(await reader.workspace(who, info.owner));
  });

  // Before recording a step, a company hands its wording to the agent and gets
  // the fingerprint to put on the chain. The wording itself never goes there.
  app.post("/api/details", (req, res) => {
    const body = req.body || {};
    let details;
    try {
      details = body.kind === "note" ? buildNoteDetails(body) : buildStepDetails(body);
    } catch (error) {
      if (error instanceof InvalidDetails) return fail(res, 400, error.message);
      throw error;
    }
    const detailsHash = hashDetails(details);
    store.putDetails(detailsHash, details);
    res.json({ detailsHash, step: body.kind === "note" ? null : STEPS.findIndex((step) => step.name === details.step) });
  });

  // After a transaction is confirmed, the page tells the agent, so each passport
  // line can link to the transaction that wrote it. The agent reads the receipt
  // itself: only events from this contract count.
  app.post("/api/proofs", async (req, res) => {
    const hash = String((req.body || {}).transaction || "").trim();
    if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) return fail(res, 400, "That is not a transaction hash.");
    // Something was just written: what the agent remembers of the chain is out of date.
    reader.forget();
    const receipt = await contract.runner.provider.getTransactionReceipt(hash);
    if (!receipt) return fail(res, 404, "This transaction is not confirmed yet.");
    if (receipt.status !== 1) return fail(res, 400, "This transaction failed, so it recorded nothing.");
    res.json({ recorded: remember(store, receipt, contract) });
  });

  // The check itself. The paper is read, answered and forgotten.
  app.post("/api/check", async (req, res) => {
    const body = req.body || {};
    const paper = typeof body.paper === "string" ? body.paper : "";
    if (paper.trim().length < 20) return fail(res, 400, "Paste the text of a delivery note first, or load a sample.");
    if (paper.length > maxPaperChars) return fail(res, 413, `This paper is too long for the demo (limit: ${maxPaperChars} characters).`);

    const lot = findCode(paper);
    if (!lot) {
      return fail(res, 400, "This paper names no passport. Add a line such as “Passport: KHIT-6”, so the agent knows which passport to compare it with.");
    }

    let report;
    try {
      const passport = await reader.passport(lot);
      if (!passport) return fail(res, 404, `This paper names passport ${codeFor(lot)}, which does not exist on the chain.`);
      report = await checkPaper({ llm, paper, passport });
    } catch (error) {
      logger.error(`Check failed: ${describeError(error)}`);
      return fail(res, 502, `The agent could not finish the check: ${describeError(error)}`);
    }

    const entry = logEntry(report, info);
    const answer = { ...report, reportHash: hashText(entry), log: null, logError: null };
    try {
      const written = await log.submit(entry);
      answer.log = {
        topicId: String(written.topicId),
        sequenceNumber: Number(written.sequenceNumber),
        url: onHedera() ? link("topic", written.topicId) : null,
      };
    } catch (error) {
      logger.error(`Log failed: ${describeError(error)}`);
      answer.logError = describeError(error);
    }
    res.json(answer);
  });

  app.use("/api", (req, res) => fail(res, 404, "Not found."));

  app.get("/vendor/ethers.js", (req, res) => res.type("application/javascript").sendFile(ethersBrowserBundle()));

  if (pictures) app.use(pictures);

  // The pages: static files, with one shell for every address the pages handle themselves.
  if (staticDir) {
    const shell = path.join(staticDir, "_shell.html");
    app.use(express.static(staticDir, { index: false }));
    app.use((req, res, next) => {
      if (req.method !== "GET" || path.extname(req.path)) return next();
      if (!fs.existsSync(shell)) {
        return res.status(503).type("text/plain").send("The pages are not built yet. In the repository's top folder, run:  npm run build:static");
      }
      res.sendFile(shell);
    });
  }

  app.use((req, res) => res.status(404).type("text/plain").send("Not found."));

  // Broken requests, and anything a route let through.
  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, next) => {
    if (error && (error.type === "entity.parse.failed" || error.type === "entity.too.large")) {
      return fail(res, 400, "The request could not be read.");
    }
    logger.error(`${req.method} ${req.path}: ${describeError(error)}`);
    fail(res, 502, `The agent could not answer: ${describeError(error)}`);
  });

  return app;
}

module.exports = { createApp };
