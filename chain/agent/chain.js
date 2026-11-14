// Connection to the contract through Hedera's JSON-RPC relay.

const { ethers } = require("ethers");
const { isConnectionError, isBusyError } = require("./errors");
const { agentFor } = require("./http");

const HEDERA_CHAINS = { 295: "mainnet", 296: "testnet", 297: "previewnet" };

/** Inside a Hedera contract amounts are tinybars (8 decimals). Elsewhere, 18. */
function decimalsFor(chainId) {
  return HEDERA_CHAINS[chainId] ? 8 : 18;
}

function explorerFor(chainId) {
  return HEDERA_CHAINS[chainId] ? `https://hashscan.io/${HEDERA_CHAINS[chainId]}` : null;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A provider that asks again when the connection drops, or when Hedera's public
 * relay is too busy to answer, instead of failing at once.
 */
class PatientProvider extends ethers.JsonRpcProvider {
  constructor(url, network, options, retryDelays) {
    super(url, network, options);
    this.retryDelays = retryDelays;
  }

  async _send(payload) {
    let last;
    for (let attempt = 0; attempt <= this.retryDelays.length; attempt++) {
      try {
        return await super._send(payload);
      } catch (error) {
        if (!isConnectionError(error) && !isBusyError(error)) throw error;
        last = error;
        if (attempt < this.retryDelays.length) await sleep(this.retryDelays[attempt]);
      }
    }
    throw last;
  }
}

function connect({ rpcUrl, chainId, privateKey, address, abi, retryDelays = [1000, 2000, 4000, 8000] }) {
  // Slow lines need more than the default 5 seconds to set up a connection (see http.js).
  const request = new ethers.FetchRequest(rpcUrl);
  request.getUrlFunc = ethers.FetchRequest.createGetUrlFunc({ agent: agentFor(rpcUrl) });
  request.timeout = 60000;

  // One request at a time and a fixed network: the simplest thing a public relay can serve.
  // No caching of answers: a read that follows a write must see what was just written.
  const options = { staticNetwork: true, batchMaxCount: 1, cacheTimeout: -1 };
  const provider = new PatientProvider(request, chainId, options, retryDelays);
  const wallet = new ethers.Wallet(privateKey, provider);
  const contract = new ethers.Contract(address, abi, wallet);
  return { provider, wallet, contract };
}

module.exports = { connect, decimalsFor, explorerFor };
