// Fingerprints. The contract stores these, never the text itself.

const { ethers } = require("ethers");

/** keccak256 of the exact text. */
function hashText(text) {
  return ethers.keccak256(ethers.toUtf8Bytes(text));
}

module.exports = { hashText };
