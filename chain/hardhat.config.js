require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

// The key is read from the .env file, never written here.
const rawKey = (process.env.AGENT_PRIVATE_KEY || "").trim();
const agentKey = rawKey && !rawKey.startsWith("0x") ? `0x${rawKey}` : rawKey;

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "paris",
    },
  },
  networks: {
    hederaTestnet: {
      url: process.env.HEDERA_RPC_URL || "https://testnet.hashio.io/api",
      chainId: 296,
      accounts: agentKey ? [agentKey] : [],
    },
  },
};
