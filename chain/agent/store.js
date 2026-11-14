// What the agent keeps off the chain:
//   - the wording behind each fingerprint (product name, batch number, pieces);
//   - the transaction that recorded each line, so the page can link to its proof.
// One JSON file per contract, in agent/data/ (never committed).
// Papers are not kept: a check reads the paper, answers, and forgets it.

const fs = require("fs");
const path = require("path");

function createStore(dir, contractAddress = "local") {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `details-${String(contractAddress).toLowerCase()}.json`);

  const empty = () => ({ details: {}, proofs: {} });
  let db = empty();
  let loaded = null;

  // Each save replaces the file, so its identity tells whether it has changed.
  function signature() {
    if (!fs.existsSync(file)) return "none";
    const stat = fs.statSync(file);
    return `${stat.ino}:${stat.size}:${stat.mtimeMs}`;
  }

  // "npm run seed" writes to the same file while the agent runs, so read it again whenever it has changed.
  function refresh() {
    const current = signature();
    if (current === loaded) return;
    db = empty();
    if (current !== "none") db = { ...db, ...JSON.parse(fs.readFileSync(file, "utf8")) };
    loaded = current;
  }

  function save() {
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
    fs.renameSync(tmp, file);
    loaded = signature();
  }

  refresh();
  return {
    file,
    putDetails(hash, details) {
      refresh();
      if (!db.details[hash]) {
        db.details[hash] = details;
        save();
      }
    },
    getDetails(hash) {
      refresh();
      return db.details[hash] || null;
    },
    count() {
      refresh();
      return Object.keys(db.details).length;
    },
    /** Remembers which transaction recorded something, for example "lot:4". */
    putProof(key, transactionHash) {
      refresh();
      if (db.proofs[key] !== transactionHash) {
        db.proofs[key] = transactionHash;
        save();
      }
    },
    getProof(key) {
      refresh();
      return db.proofs[key] || null;
    },
  };
}

module.exports = { createStore };
