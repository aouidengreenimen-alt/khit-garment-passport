// Reads the chain and builds a passport: one lot and everything it was made from.
//
// Everything returned here is a fact from the contract, joined with the wording
// kept off the chain when its fingerprint matches.

const { ethers } = require("ethers");
const { STEPS, hashDetails, toKg } = require("./details");

const AT_ONCE = 6; // questions sent to the network together: quicker than one by one, and gentle on a public relay
const MAX_LOTS = 200; // the most lots one passport may stand on
const SHIPMENT_STATUS = ["none", "sent", "received", "refused"];
const PASSPORT_CODE = /\bKHIT[-\s]?(\d{1,9})\b/i;

const codeFor = (lot) => `KHIT-${lot}`;

/** The passport number written in a text ("KHIT-12"), or null. */
function findCode(text) {
  const match = PASSPORT_CODE.exec(String(text || ""));
  return match ? Number(match[1]) : null;
}

/** Like Promise.all over a list, a few at a time, keeping the order. */
async function each(list, fn) {
  const out = [];
  for (let i = 0; i < list.length; i += AT_ONCE) {
    out.push(...(await Promise.all(list.slice(i, i + AT_ONCE).map(fn))));
  }
  return out;
}

const brief = (company) => ({
  name: company.name,
  country: company.country,
  address: company.address,
  approved: company.approved,
});

function createReader({ contract, store }) {
  // The cache holds the question in flight, so a company is asked about once however many lots it made.
  function company(address, cache = new Map()) {
    const key = address.toLowerCase();
    if (!cache.has(key)) {
      cache.set(
        key,
        contract.getCompany(address).then((entry) => ({
          address,
          name: entry.name || "Unknown company",
          country: entry.country || "",
          approved: entry.approved,
          source: entry.source,
          since: Number(entry.since),
        }))
      );
    }
    return cache.get(key);
  }

  /** The wording behind a fingerprint, only when it hashes to exactly what the chain holds. */
  function wording(hash) {
    if (!hash || hash === ethers.ZeroHash) return null;
    const stored = store.getDetails(hash);
    return stored && hashDetails(stored) === hash ? stored : null;
  }

  async function shipment(id, cache) {
    const raw = await contract.getShipment(id);
    const [from, to] = await Promise.all([company(raw.from, cache), company(raw.to, cache)]);
    return {
      id: Number(id),
      lot: Number(raw.lot),
      from,
      to,
      kg: toKg(raw.grams),
      sentAt: Number(raw.sentAt),
      closedAt: Number(raw.closedAt),
      status: SHIPMENT_STATUS[Number(raw.status)] || "none",
      received: Number(raw.received),
      details: wording(raw.detailsHash),
    };
  }

  async function lot(id, cache) {
    const raw = await contract.getLot(id);
    const shipmentId = Number(raw.shipment);
    const [maker, holder, delivery] = await Promise.all([
      company(raw.maker, cache),
      company(raw.holder, cache),
      shipmentId ? shipment(shipmentId, cache) : null,
    ]);
    return {
      id: Number(id),
      maker,
      holder,
      step: (STEPS[Number(raw.step)] || STEPS[STEPS.length - 1]).name,
      createdAt: Number(raw.createdAt),
      withdrawnAt: Number(raw.withdrawnAt),
      kg: toKg(raw.grams),
      madeKg: toKg(raw.madeGrams),
      shipment: delivery,
      detailsHash: raw.detailsHash,
      details: wording(raw.detailsHash),
      parents: raw.parents.map(Number),
    };
  }

  /** One line of a passport: a manufacturing step, or a handover between two companies. */
  function lineOf(entry, n) {
    if (entry.shipment) {
      return {
        n,
        type: "handover",
        lot: entry.id,
        shipment: entry.shipment.id,
        from: brief(entry.shipment.from),
        to: brief(entry.shipment.to),
        sentAt: entry.shipment.sentAt,
        at: entry.shipment.closedAt,
        kg: entry.shipment.kg,
        reference: entry.shipment.details ? entry.shipment.details.reference : null,
        standing: "valid",
      };
    }
    const d = entry.details;
    return {
      n,
      type: "step",
      lot: entry.id,
      step: entry.step,
      company: brief(entry.maker),
      at: entry.createdAt,
      kg: entry.madeKg,
      product: d ? d.product : null,
      reference: d ? d.reference : null,
      pieces: d ? d.pieces : null,
      note: d ? d.note : "",
      // "valid": stands today. "withdrawn": the company took it back.
      // "company_removed": the company is no longer approved.
      standing: entry.withdrawnAt ? "withdrawn" : entry.maker.approved ? "valid" : "company_removed",
      withdrawnAt: entry.withdrawnAt || null,
    };
  }

  return {
    /**
     * The passport of one lot: every step and handover behind it, oldest first.
     * Returns null when the lot does not exist.
     */
    async passport(lotId) {
      const count = Number(await contract.lotCount());
      if (!Number.isInteger(lotId) || lotId < 1 || lotId > count) return null;

      const cache = new Map();
      const found = new Map();
      let frontier = [lotId];
      while (frontier.length) {
        if (found.size + frontier.length > MAX_LOTS) {
          throw new Error(`This passport stands on more than ${MAX_LOTS} lots, which is more than the agent reads at once.`);
        }
        const loaded = await each(frontier, (id) => lot(id, cache));
        for (const entry of loaded) found.set(entry.id, entry);
        frontier = [...new Set(loaded.flatMap((entry) => entry.parents))].filter((id) => !found.has(id));
      }

      // Lot numbers are given in order of recording, so sorting by number is sorting by time.
      const lines = [...found.values()].sort((a, b) => a.id - b.id).map((entry, index) => lineOf(entry, index + 1));
      const top = found.get(lotId);

      // Where each step was done: what a brand has to tell its customers.
      const origins = {};
      for (const step of STEPS.slice(0, 4)) {
        origins[step.name] = [];
        for (const line of lines) {
          if (line.type !== "step" || line.step !== step.name) continue;
          const known = origins[step.name].some((o) => o.country === line.company.country && o.company === line.company.name);
          if (!known) origins[step.name].push({ country: line.company.country, company: line.company.name, standing: line.standing, n: line.n });
        }
      }

      const warnings = [];
      for (const line of lines) {
        if (line.type !== "step") continue;
        const label = STEPS.find((s) => s.name === line.step).label;
        if (line.standing === "withdrawn") warnings.push(`Line ${line.n} (${label.toLowerCase()} by ${line.company.name}) was withdrawn by the company that recorded it.`);
        if (line.standing === "company_removed") warnings.push(`Line ${line.n}: ${line.company.name} is no longer an approved company.`);
        if (!line.product) warnings.push(`Line ${line.n}: this agent holds only the fingerprint of this step, not its wording.`);
      }

      return {
        lot: top.id,
        code: codeFor(top.id),
        holder: brief(top.holder),
        kg: top.kg,
        madeKg: top.madeKg,
        product: top.details ? top.details.product : null,
        reference: top.details ? top.details.reference : null,
        pieces: top.details ? top.details.pieces : null,
        origins,
        lines,
        warnings,
      };
    },

    /** Every lot on the chain, newest first, for the page's list. */
    async lots() {
      const count = Math.min(Number(await contract.lotCount()), MAX_LOTS);
      const cache = new Map();
      const ids = Array.from({ length: count }, (_, i) => count - i);
      const loaded = await each(ids, (id) => lot(id, cache));
      return loaded.map((entry) => ({
        lot: entry.id,
        code: codeFor(entry.id),
        step: entry.step,
        maker: entry.maker.name,
        holder: entry.holder.name,
        holderCountry: entry.holder.country,
        kg: entry.kg,
        madeKg: entry.madeKg,
        received: Boolean(entry.shipment),
        withdrawn: Boolean(entry.withdrawnAt),
        product: entry.details ? entry.details.product : null,
        reference: entry.details ? entry.details.reference : null,
        pieces: entry.details ? entry.details.pieces : null,
        at: entry.createdAt,
      }));
    },

    /**
     * What one company sees when it opens its page: who it is, the lots it
     * holds, and the deliveries on their way to it or sent by it.
     * @param owner the address that owns the contract
     */
    async workspace(address, owner) {
      const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
      const cache = new Map();
      const me = await company(address, cache);

      const lotCache = new Map();
      const getLot = (id) => {
        if (!lotCache.has(id)) lotCache.set(id, lot(id, cache));
        return lotCache.get(id);
      };

      const [held, shipmentCount] = await Promise.all([contract.lotsOf(address), contract.shipmentCount()]);
      const mine = await each(held.map(Number), getLot);
      const ids = Array.from({ length: Math.min(Number(shipmentCount), MAX_LOTS) }, (_, i) => i + 1);
      const shipments = (await each(ids, (id) => shipment(id, cache))).filter((s) => same(s.from.address, address) || same(s.to.address, address));
      const sources = await each(shipments, (s) => getLot(s.lot));
      const delivery = (s, index, other) => ({
        shipment: s.id,
        [other]: { name: s[other].name, country: s[other].country },
        kg: s.kg,
        reference: s.details ? s.details.reference : "",
        product: sources[index].details ? sources[index].details.product : "",
        sentAt: s.sentAt,
        status: s.status,
      });

      const lots = mine
        // What it can still use, plus its own steps, which it may want to withdraw.
        .filter((entry) => entry.kg > 0 || (!entry.shipment && !entry.withdrawnAt))
        .sort((a, b) => Number(b.kg > 0) - Number(a.kg > 0) || b.id - a.id)
        .map((entry) => ({
          lot: entry.id,
          code: codeFor(entry.id),
          step: entry.step,
          product: entry.details ? entry.details.product : "",
          reference: entry.details ? entry.details.reference : "",
          pieces: entry.details ? entry.details.pieces : null,
          kg: entry.kg,
          madeKg: entry.madeKg,
          received: Boolean(entry.shipment),
          withdrawn: Boolean(entry.withdrawnAt),
          canWithdraw: !entry.shipment && !entry.withdrawnAt && same(entry.maker.address, address),
        }));

      return {
        // A company that was never approved has no page of its own.
        company: me.since > 0 ? { name: me.name, country: me.country, address: me.address, approved: me.approved, source: me.source } : null,
        isOwner: same(address, owner),
        lots,
        incoming: shipments.map((s, i) => [s, i]).filter(([s]) => s.status === "sent" && same(s.to.address, address)).map(([s, i]) => delivery(s, i, "from")),
        outgoing: shipments.map((s, i) => [s, i]).filter(([s]) => same(s.from.address, address)).map(([s, i]) => delivery(s, i, "to")).reverse(),
      };
    },

    async companies() {
      const cache = new Map();
      return each([...(await contract.getCompanies())], (address) => company(address, cache));
    },

    async stats() {
      const [list, lots, shipments] = await Promise.all([contract.getCompanies(), contract.lotCount(), contract.shipmentCount()]);
      return { companies: list.length, lots: Number(lots), shipments: Number(shipments) };
    },
  };
}

module.exports = { createReader, codeFor, findCode, MAX_LOTS };
