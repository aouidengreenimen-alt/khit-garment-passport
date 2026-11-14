// Patient HTTP for everything the agent calls over the web.
//
// Node's built-in defaults drop a connection that takes more than 5 seconds to
// set up. On a slow line that is not enough, and the failure looks like the
// service being down. These agents allow 30 seconds and keep connections open
// between calls, so most calls skip the set-up entirely.

const http = require("http");
const https = require("https");

const CONNECT_MS = 30000;

const agents = {
  "http:": new http.Agent({ keepAlive: true, timeout: CONNECT_MS }),
  "https:": new https.Agent({ keepAlive: true, timeout: CONNECT_MS }),
};

function agentFor(url) {
  const agent = agents[new URL(url).protocol];
  if (!agent) throw new Error(`Unsupported address: ${url}`);
  return agent;
}

/**
 * One request. Resolves { status, text } for any answer from the server and
 * rejects only when no answer arrives.
 */
function requestText(url, { method = "GET", headers = {}, body = null, timeoutMs = 90000 } = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const lib = target.protocol === "http:" ? http : https;
    const allHeaders = { ...headers };
    if (body !== null) allHeaders["Content-Length"] = Buffer.byteLength(body);

    const req = lib.request(target, { method, headers: allHeaders, agent: agentFor(url) }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode || 0, text: Buffer.concat(chunks).toString("utf8") }));
      res.on("error", reject);
    });

    const giveUp = (what) =>
      req.destroy(Object.assign(new Error(`${what} (${target.host})`), { code: "ETIMEDOUT" }));

    // Silence on the line: 30 seconds while connecting, then `timeoutMs` while waiting for the answer.
    req.setTimeout(timeoutMs);
    req.on("timeout", () => giveUp("The connection went silent"));
    // A hard limit on the whole call.
    const timer = setTimeout(() => giveUp("No answer in time"), timeoutMs + CONNECT_MS);

    req.on("error", reject);
    req.on("close", () => clearTimeout(timer));
    if (body !== null) req.write(body);
    req.end();
  });
}

module.exports = { agentFor, requestText, CONNECT_MS };
