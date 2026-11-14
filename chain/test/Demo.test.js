const { expect } = require("chai");
const { ethers } = require("hardhat");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { step, isRefusal, derive } = require("../scripts/seed");
const { refusal } = require("../scripts/cheat");
const { createStore } = require("../agent/store");
const { recordsIn, remember } = require("../agent/proofs");
const { loadSamples } = require("../agent/samples");
const { STEP_NAMES, buildStepDetails, buildNoteDetails, toGrams } = require("../agent/details");

const DEMO = path.join(__dirname, "..", "demo");
const seed = JSON.parse(fs.readFileSync(path.join(DEMO, "seed.json"), "utf8"));
const hash = (text) => ethers.keccak256(ethers.toUtf8Bytes(text));

const quietly = async (fn) => {
  const log = console.log;
  console.log = () => {};
  try {
    return await fn();
  } finally {
    console.log = log;
  }
};

describe("demo data", function () {
  describe("doing one step", function () {
    it("skips a step that is already done", async function () {
      let acted = 0;
      const now = await step(async () => true, async () => { acted += 1; });
      expect(now).to.equal(false);
      expect(acted).to.equal(0);
    });

    it("does a step that is not done yet", async function () {
      let done = false;
      const now = await step(async () => done, async () => { done = true; });
      expect(now).to.equal(true);
    });

    it("tries again when the network answers late, without doing the step twice", async function () {
      let done = false;
      let acted = 0;
      const now = await quietly(() => step(
        async () => done,
        async () => {
          acted += 1;
          done = true; // the transaction went through...
          throw new Error("nonce has already been used"); // ...but the answer was an error
        },
        [1, 1]
      ));
      expect(now).to.equal(true);
      expect(acted).to.equal(1);
    });

    it("gives up after the last wait", async function () {
      let acted = 0;
      let caught = null;
      try {
        await quietly(() => step(async () => false, async () => { acted += 1; throw new Error("still down"); }, [1, 1]));
      } catch (error) {
        caught = error;
      }
      expect(caught.message).to.equal("still down");
      expect(acted).to.equal(3);
    });

    it("does not insist when the contract itself refuses", async function () {
      const refused = Object.assign(new Error("execution reverted"), { code: "CALL_EXCEPTION", reason: "More out than in" });
      let acted = 0;
      let caught = null;
      try {
        await step(async () => false, async () => { acted += 1; throw refused; }, [1, 1]);
      } catch (error) {
        caught = error;
      }
      expect(caught).to.equal(refused);
      expect(acted).to.equal(1);
      expect(isRefusal(refused)).to.equal(true);
      expect(isRefusal(new Error("timeout"))).to.equal(false);
      expect(isRefusal(Object.assign(new Error("x"), { code: "CALL_EXCEPTION" }))).to.equal(false);
    });
  });

  it("derives a different, repeatable key for each demo company", function () {
    const key = "0x" + "11".repeat(32);
    expect(derive(key, "company:mill")).to.equal(derive(key, "company:mill"));
    expect(derive(key, "company:mill")).to.not.equal(derive(key, "company:factory"));
    expect(derive(key, "company:mill")).to.not.equal(derive("0x" + "22".repeat(32), "company:mill"));
    expect(derive(key, "company:mill")).to.match(/^0x[0-9a-f]{64}$/);
  });

  it("reads the contract's own words out of a refusal", function () {
    expect(refusal({ reason: "More out than in" })).to.equal("More out than in");
    expect(refusal({ revert: { args: ["Only the receiver"] } })).to.equal("Only the receiver");
    expect(refusal({ message: 'execution reverted: "You do not hold this lot"' })).to.equal("You do not hold this lot");
    expect(refusal({ message: "reverted with reason string 'Only a source of material'" })).to.equal("Only a source of material");
    expect(refusal(new Error("socket hang up"))).to.equal(null);
    expect(refusal(null)).to.equal(null);
  });

  it("names demo companies as placeholders, never as real firms", function () {
    for (const company of seed.companies) expect(company.name).to.match(/\(demo\)$/);
    expect(seed.companies.filter((c) => c.source).map((c) => c.country)).to.deep.equal(["Turkey", "Egypt"]);
  });

  it("is accepted by the contract, step by step, with each company signing its own", async function () {
    const signers = await ethers.getSigners();
    const Passport = await ethers.getContractFactory("GarmentPassport");
    const passport = await Passport.deploy();
    await passport.waitForDeployment();

    const wallets = new Map();
    for (const [index, company] of seed.companies.entries()) {
      wallets.set(company.key, signers[index + 1]);
      await passport.approveCompany(signers[index + 1].address, company.name, company.country, Boolean(company.source));
    }

    for (const journey of seed.journeys) {
      const lots = new Map();
      for (const [index, entry] of journey.steps.entries()) {
        const by = passport.connect(wallets.get(entry.by));
        const where = `journey ${journey.key}, step ${index + 1}`;
        if (entry.do === "record") {
          const details = buildStepDetails(entry, "salt");
          await by.record(STEP_NAMES.indexOf(details.step), toGrams(entry.kg), hash(where));
          lots.set(entry.as, await passport.lotCount());
        } else if (entry.do === "make") {
          const details = buildStepDetails(entry, "salt");
          for (const [name] of entry.from) expect(lots.has(name), `${where} uses "${name}" before it exists`).to.equal(true);
          await by.transform(entry.from.map(([name]) => lots.get(name)), entry.from.map(([, kg]) => toGrams(kg)), STEP_NAMES.indexOf(details.step), toGrams(entry.kg), hash(where));
          lots.set(entry.as, await passport.lotCount());
        } else {
          expect(entry.do, where).to.equal("ship");
          buildNoteDetails(entry, "salt");
          await by.ship(lots.get(entry.lot), wallets.get(entry.to).address, toGrams(entry.kg), hash(where));
          await passport.connect(wallets.get(entry.to)).confirm(await passport.shipmentCount());
          lots.set(entry.as, await passport.lotCount());
        }
      }
      // Each journey ends with a lot in the brand's hands: that lot is the passport.
      const final = await passport.getLot(lots.get("final"));
      expect(final.holder).to.equal(wallets.get("brand").address);
      expect(final.grams > 0n).to.equal(true);
    }

    // "npm run cheat" plays with fabric the factory received and did not use up.
    const spare = await passport.getLot(3);
    expect(spare.holder).to.equal(wallets.get("factory").address);
    expect(spare.grams).to.equal(toGrams(60));
  });

  describe("sample papers", function () {
    const demo = { journeys: { A: { lot: 6 }, B: { lot: 12 } } };

    it("name the passport of the journey they are about", function () {
      const samples = loadSamples(DEMO, demo);
      expect(samples.map((s) => s.id)).to.deep.equal(["honest", "origin", "changed"]);
      expect(samples[0].text).to.contain("Passport: KHIT-6");
      expect(samples[1].text).to.contain("Passport: KHIT-12");
      for (const sample of samples) expect(sample.text).to.not.contain("{{");
    });

    it("say what each one is expected to show", function () {
      const samples = loadSamples(DEMO, demo);
      expect(samples[0].expect.differs).to.deep.equal([0, 0]); // the correct note differs nowhere
      expect(samples[1].expect.differs).to.deep.equal([2, 2]); // dyed and woven "in Turkey", on a batch from Egypt
      expect(samples[2].expect.not_found[0]).to.be.greaterThan(0); // the organic claim has no line
    });

    it("are not offered before the demo journeys exist", function () {
      expect(loadSamples(DEMO, null)).to.deep.equal([]);
      expect(loadSamples(DEMO, { journeys: { A: { lot: 6 } } }).map((s) => s.id)).to.deep.equal(["honest", "changed"]);
    });

    it("never use a word that judges a company", function () {
      for (const file of fs.readdirSync(DEMO)) {
        const text = fs.readFileSync(path.join(DEMO, file), "utf8").toLowerCase();
        expect(text, file).to.not.match(/\bfake\b|\bfraud/);
      }
    });
  });
});

describe("what the agent keeps", function () {
  let dir;

  beforeEach(function () {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "thread-store-"));
  });

  afterEach(function () {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("lets the running agent see what the demo script has just stored", function () {
    const agent = createStore(dir, "0xContract");
    const script = createStore(dir, "0xContract");
    script.putDetails("0xaa", { product: "From the script" });
    script.putProof("lot:1", "0x01");
    expect(agent.getDetails("0xaa")).to.deep.equal({ product: "From the script" });
    expect(agent.getProof("lot:1")).to.equal("0x01");

    // And the agent's next write keeps the script's entries.
    agent.putDetails("0xbb", { product: "From the page" });
    expect(script.getDetails("0xaa")).to.deep.equal({ product: "From the script" });
    expect(script.getDetails("0xbb")).to.deep.equal({ product: "From the page" });
    expect(script.getProof("lot:1")).to.equal("0x01");
    expect(agent.count()).to.equal(2);
  });

  it("keeps one file per contract, so a new deployment starts clean", function () {
    createStore(dir, "0xOLD").putDetails("0xaa", { product: "Old" });
    const fresh = createStore(dir, "0xNEW");
    expect(fresh.getDetails("0xaa")).to.equal(null);
    expect(fresh.getProof("lot:1")).to.equal(null);
    expect(fresh.count()).to.equal(0);
  });

  it("remembers which transaction recorded each lot and each handover", async function () {
    const [, mill, factory, other] = await ethers.getSigners();
    const Passport = await ethers.getContractFactory("GarmentPassport");
    const passport = await Passport.deploy();
    await passport.waitForDeployment();
    const store = createStore(dir, await passport.getAddress());

    const approved = await (await passport.approveCompany(mill.address, "Anadolu Denim (demo)", "Turkey", true)).wait();
    expect(recordsIn(approved, passport)).to.deep.equal([`company:${mill.address.toLowerCase()}`]);
    await passport.approveCompany(factory.address, "Atelier Bizerte (demo)", "Tunisia", false);

    const recorded = await (await passport.connect(mill).record(0, 700000n, hash("fabric"))).wait();
    const shipped = await (await passport.connect(mill).ship(1, factory.address, 700000n, hash("note"))).wait();
    const confirmed = await (await passport.connect(factory).confirm(1)).wait();
    const withdrawn = await (await passport.connect(mill).withdraw(1)).wait();

    expect(remember(store, recorded, passport)).to.deep.equal(["lot:1"]);
    expect(remember(store, shipped, passport)).to.deep.equal(["shipment:1:sent"]);
    expect(remember(store, confirmed, passport)).to.deep.equal(["shipment:1:closed", "lot:2"]);
    expect(remember(store, withdrawn, passport)).to.deep.equal(["lot:1:withdrawn"]);
    expect(store.getProof("lot:2")).to.equal(confirmed.hash);
    expect(store.getProof("shipment:1:closed")).to.equal(confirmed.hash);

    // The same events from any other contract prove nothing here.
    const elsewhere = await Passport.deploy();
    await elsewhere.waitForDeployment();
    await elsewhere.approveCompany(other.address, "Somebody Else", "Italy", true);
    const foreign = await (await elsewhere.connect(other).record(0, 1000n, hash("x"))).wait();
    expect(recordsIn(foreign, passport)).to.deep.equal([]);
  });
});
