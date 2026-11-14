// The agent's public log: a Hedera Consensus Service topic.
// Every check is written there with its outcome, so anyone can audit the
// agent later. Only the agent's key can write to the topic.

const fs = require("fs");
const path = require("path");
const { describeError } = require("./errors");
const { requestText } = require("./http");
const {
  Client,
  PrivateKey,
  AccountId,
  TopicCreateTransaction,
  TopicMessageSubmitTransaction,
} = require("@hiero-ledger/sdk");

/** The agent's Hedera account ID (0.0.x). Read from .env, or looked up from its 0x address. */
async function resolveAccountId({ accountId, evmAddress, mirrorUrl }) {
  if (accountId) return accountId;
  let res;
  try {
    res = await requestText(`${mirrorUrl}/api/v1/accounts/${evmAddress}`, { timeoutMs: 30000 });
  } catch (cause) {
    throw new Error(`Could not look up the agent's Hedera account ID (${describeError(cause)}). Set AGENT_ACCOUNT_ID in .env.`);
  }
  if (res.status !== 200) {
    throw new Error(`Could not look up the agent's Hedera account ID (mirror node answered ${res.status}). Set AGENT_ACCOUNT_ID in .env.`);
  }
  const body = JSON.parse(res.text);
  if (!body.account) throw new Error("The mirror node returned no account ID. Set AGENT_ACCOUNT_ID in .env.");
  return body.account;
}

function createHederaLog({ accountId, privateKey, topicId = null }) {
  const key = PrivateKey.fromStringECDSA(privateKey.replace(/^0x/, ""));
  const client = Client.forTestnet();
  client.setOperator(AccountId.fromString(accountId), key);
  let topic = topicId;

  return {
    kind: "hedera",
    get topicId() {
      return topic;
    },

    /** Creates the topic the first time. Returns { topicId, created }. */
    async ensureTopic(memo) {
      if (topic) return { topicId: topic, created: false };
      const response = await new TopicCreateTransaction()
        .setTopicMemo(memo.slice(0, 100))
        .setSubmitKey(key.publicKey)
        .execute(client);
      const receipt = await response.getReceipt(client);
      topic = receipt.topicId.toString();
      return { topicId: topic, created: true };
    },

    /** Writes one message. Returns where it landed. */
    async submit(message) {
      if (!topic) throw new Error("The log topic does not exist yet");
      const response = await new TopicMessageSubmitTransaction()
        .setTopicId(topic)
        .setMessage(message)
        .execute(client);
      const receipt = await response.getReceipt(client);
      return {
        topicId: topic,
        sequenceNumber: Number(receipt.topicSequenceNumber),
        transactionId: response.transactionId.toString(),
      };
    },

    close() {
      client.close();
    },
  };
}

/**
 * Local development only: writes the same messages to a file instead of Hedera,
 * so the agent can run against a local test chain.
 */
function createFileLog(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let sequence = fs.existsSync(file) ? fs.readFileSync(file, "utf8").split("\n").filter(Boolean).length : 0;
  return {
    kind: "file",
    topicId: "local-file",
    async ensureTopic() {
      return { topicId: "local-file", created: false };
    },
    async submit(message) {
      sequence += 1;
      fs.appendFileSync(file, JSON.stringify({ sequenceNumber: sequence, message }) + "\n");
      return { topicId: "local-file", sequenceNumber: sequence, transactionId: null };
    },
    close() {},
  };
}

module.exports = { resolveAccountId, createHederaLog, createFileLog };
