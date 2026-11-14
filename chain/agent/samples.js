// The sample papers offered on the "Check a paper" page.
// They come from demo/ and only make sense once "npm run seed" has put the
// demo journeys on the chain: each paper names the passport it is about.

const fs = require("fs");
const path = require("path");
const { codeFor } = require("./passport");

/**
 * @param demoDir  the demo/ folder
 * @param demo     what scripts/seed.js saved (which lot ends each journey), or null
 */
function loadSamples(demoDir, demo) {
  if (!demo || !demo.journeys) return [];
  const seed = JSON.parse(fs.readFileSync(path.join(demoDir, "seed.json"), "utf8"));
  return (seed.samples || [])
    .filter((sample) => demo.journeys[sample.journey])
    .map((sample) => ({
      id: sample.id,
      label: sample.label,
      text: fs
        .readFileSync(path.join(demoDir, sample.file), "utf8")
        .split("{{PASSPORT}}")
        .join(codeFor(demo.journeys[sample.journey].lot))
        .trim(),
      expect: sample.expect || null,
    }));
}

module.exports = { loadSamples };
