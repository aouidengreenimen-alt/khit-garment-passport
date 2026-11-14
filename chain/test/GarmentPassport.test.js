const { expect } = require("chai");
const { ethers } = require("hardhat");

const WEAVING = 0;
const DYEING = 1;
const SEWING = 2;
const FINISHING = 3;
const KG = 1000n; // the contract counts in grams
const hash = (text) => ethers.keccak256(ethers.toUtf8Bytes(text));

describe("GarmentPassport", function () {
  let passport, owner, mill, factory, brand, stranger;

  beforeEach(async function () {
    [owner, mill, factory, brand, stranger] = await ethers.getSigners();
    const Passport = await ethers.getContractFactory("GarmentPassport");
    passport = await Passport.deploy();
    await passport.waitForDeployment();
    await passport.approveCompany(mill.address, "Anadolu Denim", "Turkey", true);
    await passport.approveCompany(factory.address, "Atelier Bizerte", "Tunisia", false);
    await passport.approveCompany(brand.address, "Maison Lune", "France", false);
  });

  /** The mill records fabric and the factory receives it. Returns the factory's lot id. */
  async function fabricAtFactory(kg = 700n) {
    await passport.connect(mill).record(WEAVING, kg * KG, hash("fabric"));
    const fabric = await passport.lotCount();
    await passport.connect(mill).ship(fabric, factory.address, kg * KG, hash("note"));
    await passport.connect(factory).confirm(await passport.shipmentCount());
    return passport.lotCount();
  }

  describe("companies", function () {
    it("are approved by the owner, with a name and a country", async function () {
      const company = await passport.getCompany(mill.address);
      expect(company.name).to.equal("Anadolu Denim");
      expect(company.country).to.equal("Turkey");
      expect(company.approved).to.equal(true);
      expect(company.source).to.equal(true);
      expect(await passport.getCompanies()).to.deep.equal([mill.address, factory.address, brand.address]);
    });

    it("cannot approve themselves or each other", async function () {
      await expect(passport.connect(stranger).approveCompany(stranger.address, "Fake Mill", "Italy", true))
        .to.be.revertedWith("Only the owner");
      await expect(passport.connect(factory).approveCompany(stranger.address, "Friend", "Italy", true))
        .to.be.revertedWith("Only the owner");
    });

    it("need a usable name and country", async function () {
      await expect(passport.approveCompany(stranger.address, "A", "Italy", false)).to.be.revertedWith("Name must be 2 to 80 characters");
      await expect(passport.approveCompany(stranger.address, "Good Name", "I", false)).to.be.revertedWith("Country must be 2 to 40 characters");
      await expect(passport.approveCompany(ethers.ZeroAddress, "Good Name", "Italy", false)).to.be.revertedWith("Company address missing");
    });

    it("can be updated without being listed twice", async function () {
      await expect(passport.approveCompany(factory.address, "Atelier Bizerte SARL", "Tunisia", false))
        .to.emit(passport, "CompanyApproved").withArgs(factory.address, "Atelier Bizerte SARL", "Tunisia", false);
      expect((await passport.getCompany(factory.address)).name).to.equal("Atelier Bizerte SARL");
      expect((await passport.getCompanies()).length).to.equal(3);
    });

    it("stop writing once removed, and what they wrote stays", async function () {
      const lot = await fabricAtFactory();
      await expect(passport.removeCompany(factory.address)).to.emit(passport, "CompanyRemoved").withArgs(factory.address);
      await expect(passport.connect(factory).transform([lot], [100n * KG], SEWING, 90n * KG, hash("jeans")))
        .to.be.revertedWith("Only an approved company");
      expect((await passport.getLot(lot)).holder).to.equal(factory.address);
      expect((await passport.getCompany(factory.address)).approved).to.equal(false);
      await expect(passport.removeCompany(factory.address)).to.be.revertedWith("Not an approved company");
    });

    it("hand over ownership of the contract only through the owner", async function () {
      await expect(passport.connect(stranger).transferOwnership(stranger.address)).to.be.revertedWith("Only the owner");
      await passport.transferOwnership(brand.address);
      expect(await passport.owner()).to.equal(brand.address);
      await expect(passport.approveCompany(stranger.address, "Late", "Italy", false)).to.be.revertedWith("Only the owner");
    });
  });

  describe("new material", function () {
    it("is recorded by a source of material", async function () {
      await expect(passport.connect(mill).record(WEAVING, 700n * KG, hash("fabric")))
        .to.emit(passport, "LotRecorded").withArgs(1, mill.address, WEAVING, 700n * KG, hash("fabric"));
      const lot = await passport.getLot(1);
      expect(lot.maker).to.equal(mill.address);
      expect(lot.holder).to.equal(mill.address);
      expect(lot.grams).to.equal(700n * KG);
      expect(lot.madeGrams).to.equal(700n * KG);
      expect(lot.shipment).to.equal(0);
      expect(lot.parents).to.deep.equal([]);
      expect(await passport.lotsOf(mill.address)).to.deep.equal([1n]);
    });

    it("cannot be invented by a factory, a brand or a stranger", async function () {
      await expect(passport.connect(factory).record(WEAVING, 700n * KG, hash("fabric"))).to.be.revertedWith("Only a source of material");
      await expect(passport.connect(brand).record(WEAVING, 700n * KG, hash("fabric"))).to.be.revertedWith("Only a source of material");
      await expect(passport.connect(stranger).record(WEAVING, 700n * KG, hash("fabric"))).to.be.revertedWith("Only an approved company");
    });

    it("needs a weight and a known step", async function () {
      await expect(passport.connect(mill).record(WEAVING, 0, hash("fabric"))).to.be.revertedWith("Weight missing");
      await expect(passport.connect(mill).record(5, 1n * KG, hash("fabric"))).to.be.revertedWith("Unknown step");
    });
  });

  describe("handing over", function () {
    beforeEach(async function () {
      await passport.connect(mill).record(WEAVING, 700n * KG, hash("fabric"));
    });

    it("counts only once the receiver confirms", async function () {
      await expect(passport.connect(mill).ship(1, factory.address, 700n * KG, hash("note")))
        .to.emit(passport, "LotShipped").withArgs(1, 1, mill.address, factory.address, 700n * KG);
      expect((await passport.getLot(1)).grams).to.equal(0);
      expect(await passport.lotsOf(factory.address)).to.deep.equal([]);

      await expect(passport.connect(factory).confirm(1)).to.emit(passport, "ShipmentConfirmed").withArgs(1, 2, factory.address);
      const received = await passport.getLot(2);
      expect(received.holder).to.equal(factory.address);
      expect(received.maker).to.equal(mill.address); // still the mill's fabric
      expect(received.step).to.equal(WEAVING);
      expect(received.grams).to.equal(700n * KG);
      expect(received.shipment).to.equal(1);
      expect(received.parents).to.deep.equal([1n]);
      expect(received.detailsHash).to.equal(hash("fabric"));

      const shipment = await passport.getShipment(1);
      expect(shipment.status).to.equal(2);
      expect(shipment.received).to.equal(2);
      expect(shipment.from).to.equal(mill.address);
      expect(shipment.to).to.equal(factory.address);
    });

    it("can be split between two receivers", async function () {
      await passport.connect(mill).ship(1, factory.address, 400n * KG, hash("note 1"));
      await passport.connect(mill).ship(1, brand.address, 300n * KG, hash("note 2"));
      await expect(passport.connect(mill).ship(1, factory.address, 1, hash("note 3"))).to.be.revertedWith("More than this lot holds");
      await passport.connect(factory).confirm(1);
      await passport.connect(brand).confirm(2);
      expect((await passport.getLot(2)).grams).to.equal(400n * KG);
      expect((await passport.getLot(3)).grams).to.equal(300n * KG);
    });

    it("gives the weight back when the receiver refuses", async function () {
      await passport.connect(mill).ship(1, factory.address, 700n * KG, hash("note"));
      await expect(passport.connect(factory).refuse(1)).to.emit(passport, "ShipmentRefused").withArgs(1, factory.address);
      expect((await passport.getLot(1)).grams).to.equal(700n * KG);
      expect((await passport.getShipment(1)).status).to.equal(3);
      expect(await passport.lotCount()).to.equal(1);
      await expect(passport.connect(factory).confirm(1)).to.be.revertedWith("Shipment is not on its way");
    });

    it("is confirmed or refused by the receiver only, and only once", async function () {
      await passport.connect(mill).ship(1, factory.address, 700n * KG, hash("note"));
      await expect(passport.connect(brand).confirm(1)).to.be.revertedWith("Only the receiver");
      await expect(passport.connect(mill).confirm(1)).to.be.revertedWith("Only the receiver");
      await expect(passport.connect(mill).refuse(1)).to.be.revertedWith("Only the receiver");
      await passport.connect(factory).confirm(1);
      await expect(passport.connect(factory).confirm(1)).to.be.revertedWith("Shipment is not on its way");
      await expect(passport.connect(factory).refuse(1)).to.be.revertedWith("Shipment is not on its way");
      await expect(passport.connect(factory).confirm(9)).to.be.revertedWith("Shipment does not exist");
    });

    it("only moves what the sender holds, to an approved company", async function () {
      await expect(passport.connect(factory).ship(1, brand.address, 1n * KG, hash("note"))).to.be.revertedWith("You do not hold this lot");
      await expect(passport.connect(mill).ship(1, stranger.address, 1n * KG, hash("note"))).to.be.revertedWith("The receiver is not an approved company");
      await expect(passport.connect(mill).ship(1, mill.address, 1n * KG, hash("note"))).to.be.revertedWith("A company cannot ship to itself");
      await expect(passport.connect(mill).ship(1, factory.address, 701n * KG, hash("note"))).to.be.revertedWith("More than this lot holds");
      await expect(passport.connect(mill).ship(1, factory.address, 0, hash("note"))).to.be.revertedWith("Weight missing");
      await expect(passport.connect(mill).ship(7, factory.address, 1n * KG, hash("note"))).to.be.revertedWith("Lot does not exist");
    });
  });

  describe("making something", function () {
    it("builds on what the company received", async function () {
      const fabric = await fabricAtFactory(700n);
      await expect(passport.connect(factory).transform([fabric], [700n * KG], SEWING, 610n * KG, hash("jeans")))
        .to.emit(passport, "LotRecorded").withArgs(3, factory.address, SEWING, 610n * KG, hash("jeans"));
      const jeans = await passport.getLot(3);
      expect(jeans.maker).to.equal(factory.address);
      expect(jeans.holder).to.equal(factory.address);
      expect(jeans.step).to.equal(SEWING);
      expect(jeans.parents).to.deep.equal([fabric]);
      expect((await passport.getLot(fabric)).grams).to.equal(0);
    });

    it("refuses more weight out than went in", async function () {
      const fabric = await fabricAtFactory(700n);
      await expect(passport.connect(factory).transform([fabric], [700n * KG], SEWING, 701n * KG, hash("jeans")))
        .to.be.revertedWith("More out than in");
      // 3,000 pairs of jeans cannot come out of fabric for 1,000.
      await expect(passport.connect(factory).transform([fabric], [700n * KG], SEWING, 1800n * KG, hash("jeans")))
        .to.be.revertedWith("More out than in");
      await passport.connect(factory).transform([fabric], [700n * KG], SEWING, 700n * KG, hash("jeans"));
    });

    it("refuses fabric the company never received", async function () {
      await passport.connect(mill).record(WEAVING, 700n * KG, hash("fabric"));
      // The factory names the mill's lot without having received it.
      await expect(passport.connect(factory).transform([1], [700n * KG], SEWING, 600n * KG, hash("jeans")))
        .to.be.revertedWith("You do not hold this lot");
      // The mill shipped it, but the factory has not confirmed yet.
      await passport.connect(mill).ship(1, factory.address, 700n * KG, hash("note"));
      await expect(passport.connect(factory).transform([1], [700n * KG], SEWING, 600n * KG, hash("jeans")))
        .to.be.revertedWith("You do not hold this lot");
    });

    it("cannot use the same fabric twice", async function () {
      const fabric = await fabricAtFactory(700n);
      await passport.connect(factory).transform([fabric], [700n * KG], SEWING, 600n * KG, hash("jeans 1"));
      await expect(passport.connect(factory).transform([fabric], [700n * KG], SEWING, 600n * KG, hash("jeans 2")))
        .to.be.revertedWith("More than this lot holds");
      await expect(passport.connect(factory).transform([fabric, fabric], [1n, 1n], SEWING, 1n, hash("jeans 3")))
        .to.be.revertedWith("More than this lot holds");
    });

    it("can mix several lots, and use only part of one", async function () {
      const first = await fabricAtFactory(400n);
      const second = await fabricAtFactory(300n);
      await passport.connect(factory).transform([first, second], [400n * KG, 100n * KG], SEWING, 450n * KG, hash("jeans"));
      const jeans = await passport.getLot(await passport.lotCount());
      expect(jeans.parents).to.deep.equal([first, second]);
      expect((await passport.getLot(second)).grams).to.equal(200n * KG);
    });

    it("needs a sensible list of lots", async function () {
      const fabric = await fabricAtFactory(700n);
      await expect(passport.connect(factory).transform([], [], SEWING, 1n, hash("x"))).to.be.revertedWith("Use 1 to 8 lots");
      await expect(passport.connect(factory).transform([fabric], [1n, 2n], SEWING, 1n, hash("x"))).to.be.revertedWith("One weight per lot");
      await expect(passport.connect(factory).transform([fabric], [0], SEWING, 1n, hash("x"))).to.be.revertedWith("Weight missing");
      await expect(passport.connect(factory).transform([fabric], [1n * KG], SEWING, 0, hash("x"))).to.be.revertedWith("Weight missing");
      await expect(passport.connect(factory).transform([fabric], [1n * KG], 9, 1n, hash("x"))).to.be.revertedWith("Unknown step");
      await expect(passport.connect(factory).transform(Array(9).fill(fabric), Array(9).fill(1n), SEWING, 1n, hash("x")))
        .to.be.revertedWith("Use 1 to 8 lots");
    });

    it("follows a whole journey from the mill to the brand", async function () {
      await passport.connect(mill).record(DYEING, 720n * KG, hash("yarn"));
      await passport.connect(mill).transform([1], [720n * KG], WEAVING, 700n * KG, hash("fabric"));
      await passport.connect(mill).ship(2, factory.address, 700n * KG, hash("note 1"));
      await passport.connect(factory).confirm(1);
      await passport.connect(factory).transform([3], [700n * KG], SEWING, 610n * KG, hash("jeans"));
      await passport.connect(factory).transform([4], [610n * KG], FINISHING, 600n * KG, hash("washed jeans"));
      await passport.connect(factory).ship(5, brand.address, 600n * KG, hash("note 2"));
      await passport.connect(brand).confirm(2);

      // Walk back from the brand's lot to the first record.
      const steps = [];
      let id = 6n;
      while (id) {
        const lot = await passport.getLot(id);
        steps.push([Number(id), Number(lot.step), lot.maker, lot.holder, Number(lot.shipment)]);
        id = lot.parents.length ? lot.parents[0] : 0n;
      }
      expect(steps).to.deep.equal([
        [6, FINISHING, factory.address, brand.address, 2],
        [5, FINISHING, factory.address, factory.address, 0],
        [4, SEWING, factory.address, factory.address, 0],
        [3, WEAVING, mill.address, factory.address, 1],
        [2, WEAVING, mill.address, mill.address, 0],
        [1, DYEING, mill.address, mill.address, 0],
      ]);
      expect(await passport.lotsOf(brand.address)).to.deep.equal([6n]);
    });
  });

  describe("withdrawing a step", function () {
    it("is done by the company that recorded it", async function () {
      await passport.connect(mill).record(WEAVING, 700n * KG, hash("fabric"));
      await expect(passport.connect(factory).withdraw(1)).to.be.revertedWith("Only the company that recorded this step");
      await expect(passport.connect(mill).withdraw(1)).to.emit(passport, "LotWithdrawn").withArgs(1, mill.address);
      expect((await passport.getLot(1)).withdrawnAt).to.be.greaterThan(0);
      await expect(passport.connect(mill).withdraw(1)).to.be.revertedWith("Already withdrawn");
      await expect(passport.connect(mill).withdraw(4)).to.be.revertedWith("Lot does not exist");
    });

    it("freezes the lot", async function () {
      await passport.connect(mill).record(WEAVING, 700n * KG, hash("fabric"));
      await passport.connect(mill).withdraw(1);
      await expect(passport.connect(mill).ship(1, factory.address, 1n * KG, hash("note"))).to.be.revertedWith("This lot was withdrawn");
      await expect(passport.connect(mill).transform([1], [1n * KG], DYEING, 1n * KG, hash("x"))).to.be.revertedWith("This lot was withdrawn");
    });

    it("cannot be done on goods received from someone else", async function () {
      const received = await fabricAtFactory(700n);
      // Neither the factory that holds the goods nor the mill can withdraw the delivery itself:
      await expect(passport.connect(factory).withdraw(received)).to.be.revertedWith("Only the company that recorded this step");
      await expect(passport.connect(mill).withdraw(received)).to.be.revertedWith("Only the company that recorded this step");
      // the mill withdraws its own record, and the passport shows it.
      await passport.connect(mill).withdraw(1);
      expect((await passport.getLot(1)).withdrawnAt).to.be.greaterThan(0);
    });
  });

  describe("reading", function () {
    it("says clearly when something does not exist", async function () {
      await expect(passport.getLot(0)).to.be.revertedWith("Lot does not exist");
      await expect(passport.getLot(1)).to.be.revertedWith("Lot does not exist");
      await expect(passport.getShipment(1)).to.be.revertedWith("Shipment does not exist");
      expect((await passport.getCompany(stranger.address)).approved).to.equal(false);
      expect(await passport.STEP_COUNT()).to.equal(5);
    });
  });

  describe("the weight of everything", function () {
    it("never exceeds what the mills recorded, whatever the companies do", async function () {
      // A fixed pseudo-random sequence of honest and dishonest moves.
      let seed = 20261113;
      const random = (n) => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed % n;
      };
      const parties = [mill, factory, brand];
      let recorded = 0n;

      for (let round = 0; round < 120; round++) {
        const who = parties[random(3)];
        const lotCount = Number(await passport.lotCount());
        const pick = () => 1 + random(Math.max(lotCount, 1));
        const amount = BigInt(1 + random(900)) * KG;
        const move = random(5);
        try {
          if (move === 0) {
            await passport.connect(who).record(random(5), amount, hash(`m${round}`));
            recorded += amount;
          } else if (move === 1) {
            await passport.connect(who).ship(pick(), parties[random(3)].address, amount, hash(`s${round}`));
          } else if (move === 2) {
            const shipmentCount = Number(await passport.shipmentCount());
            const id = 1 + random(Math.max(shipmentCount, 1));
            if (random(4) === 0) await passport.connect(who).refuse(id);
            else await passport.connect(who).confirm(id);
          } else if (move === 3) {
            await passport.connect(who).transform([pick()], [amount], random(5), amount + BigInt(random(3) - 1) * KG, hash(`t${round}`));
          } else {
            await passport.connect(who).transform([pick(), pick()], [amount, amount], random(5), amount * 2n, hash(`u${round}`));
          }
        } catch (error) {
          // A refused move is part of the test: the contract said no.
        }
      }

      let held = 0n;
      for (let id = 1; id <= Number(await passport.lotCount()); id++) held += (await passport.getLot(id)).grams;
      let onTheRoad = 0n;
      for (let id = 1; id <= Number(await passport.shipmentCount()); id++) {
        const shipment = await passport.getShipment(id);
        if (shipment.status === 1n) onTheRoad += shipment.grams;
      }
      expect(recorded).to.be.greaterThan(0n);
      expect(held + onTheRoad <= recorded).to.equal(true);
    });
  });
});
