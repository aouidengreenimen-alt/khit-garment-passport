// The wording behind each fingerprint on the chain.
//
// The contract stores who, where, when and how much. What the product is
// called, its batch number and its number of pieces are kept off the chain,
// and only their fingerprint (a hash) is recorded. A random salt in each
// record keeps anyone from guessing the wording from the fingerprint.

const { ethers } = require("ethers");
const { hashText } = require("./hashes");

// The position in this list is the step number used by the contract.
const STEPS = [
  { name: "weaving", label: "Weaving", past: "Woven" },
  { name: "dyeing", label: "Dyeing", past: "Dyed" },
  { name: "sewing", label: "Sewing", past: "Sewn" },
  { name: "finishing", label: "Washing and finishing", past: "Washed and finished" },
  { name: "other", label: "Other step", past: "Processed" },
];
const STEP_NAMES = STEPS.map((step) => step.name);

class InvalidDetails extends Error {}

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const newSalt = () => ethers.hexlify(ethers.randomBytes(16)).slice(2);

/** Kilograms as typed ("700", "12.5", "12,5") to grams, the unit the contract counts in. */
function toGrams(value) {
  const text = String(value ?? "").trim().replace(",", ".");
  if (!/^\d{1,9}(\.\d{1,3})?$/.test(text)) {
    throw new InvalidDetails("The weight must be a number of kilograms, for example 700 or 12.5.");
  }
  const [whole, part = ""] = text.split(".");
  const grams = BigInt(whole) * 1000n + BigInt((part + "000").slice(0, 3));
  if (grams <= 0n) throw new InvalidDetails("The weight must be more than zero.");
  return grams;
}

const toKg = (grams) => Number(grams) / 1000;

/** The wording of a manufacturing step, checked and tidied. */
function buildStepDetails(input, salt = newSalt()) {
  const step = clean(input.step).toLowerCase();
  if (!STEP_NAMES.includes(step)) throw new InvalidDetails("Choose the step.");

  const product = clean(input.product);
  if (product.length < 3 || product.length > 120) throw new InvalidDetails("The product description must be 3 to 120 characters.");

  const reference = clean(input.reference);
  if (reference.length < 1 || reference.length > 40) throw new InvalidDetails("The batch reference must be 1 to 40 characters.");

  let pieces = null;
  if (input.pieces !== undefined && input.pieces !== null && String(input.pieces).trim() !== "") {
    pieces = Number(input.pieces);
    if (!Number.isInteger(pieces) || pieces < 0 || pieces > 100000000) {
      throw new InvalidDetails("The number of pieces must be a whole number.");
    }
  }

  const note = clean(input.note);
  if (note.length > 160) throw new InvalidDetails("The note can be at most 160 characters.");

  return { v: 1, step, product, reference, pieces, note, salt };
}

/** The wording of a delivery note. */
function buildNoteDetails(input, salt = newSalt()) {
  const reference = clean(input.reference);
  if (reference.length < 1 || reference.length > 40) throw new InvalidDetails("The delivery note number must be 1 to 40 characters.");
  const note = clean(input.note);
  if (note.length > 160) throw new InvalidDetails("The note can be at most 160 characters.");
  return { v: 1, reference, note, salt };
}

/** One fixed text form, so the same details always give the same fingerprint. */
function canonicalDetails(details) {
  return JSON.stringify(Object.keys(details).sort().map((key) => [key, details[key]]));
}

function hashDetails(details) {
  return hashText(canonicalDetails(details));
}

module.exports = {
  STEPS,
  STEP_NAMES,
  InvalidDetails,
  toGrams,
  toKg,
  buildStepDetails,
  buildNoteDetails,
  canonicalDetails,
  hashDetails,
};
