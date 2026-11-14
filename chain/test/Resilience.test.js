// How the agent behaves when the network or the model service misbehaves.

const { expect } = require("chai");
const http = require("http");
const { ethers } = require("ethers");

const { describeError, isConnectionError } = require("../agent/errors");
const { connect } = require("../agent/chain");
const { createGroq: createGroqSlow, chooseModel } = require("../agent/llm");
const { agentFor, requestText } = require("../agent/http");

// Same client, with short pauses between retries so the tests stay quick.
const createGroq = (options) => createGroqSlow({ retryDelays: [5, 5], ...options });

/** A tiny local server for the test to talk to. */
async function serve(handler) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const parsed = body ? JSON.parse(body) : null;
      requests.push({ method: req.method, url: req.url, body: parsed });
      handler({ req, res, body: parsed, count: requests.length });
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

const json = (res, code, value) => {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(value));
};

describe("errors", function () {
  it("gives a readable line even when the error arrives blank", function () {
    // What Node reports when none of a host's addresses answers in time.
    const blank = new AggregateError(
      [
        Object.assign(new Error("connect ETIMEDOUT 34.1.2.3:443"), { code: "ETIMEDOUT" }),
        Object.assign(new Error("connect ENETUNREACH 2600::1:443"), { code: "ENETUNREACH" }),
      ],
      ""
    );
    blank.code = "ETIMEDOUT";
    expect(blank.message).to.equal("");
    expect(describeError(blank)).to.equal("Could not connect: connect ETIMEDOUT 34.1.2.3:443; connect ENETUNREACH 2600::1:443");

    expect(describeError(Object.assign(new Error(""), { code: "ECONNRESET" }))).to.equal("Could not connect (ECONNRESET)");
    expect(describeError(new Error("plain message"))).to.equal("plain message");
    expect(describeError({ shortMessage: "server response 502", message: "long text" })).to.equal("server response 502");
    expect(describeError(Object.assign(new Error(""), { cause: new Error("inner reason") }))).to.equal("inner reason");
    expect(describeError(null)).to.equal("Unknown error");
  });

  it("tells a bad connection apart from a real refusal", function () {
    expect(isConnectionError(new AggregateError([], ""))).to.equal(true);
    expect(isConnectionError(Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }))).to.equal(true);
    expect(isConnectionError(Object.assign(new TypeError("fetch failed"), { cause: { code: "UND_ERR_CONNECT_TIMEOUT" } }))).to.equal(true);
    expect(isConnectionError({ code: "SERVER_ERROR", info: { responseStatus: "503 Service Unavailable" } })).to.equal(true);

    expect(isConnectionError({ code: "SERVER_ERROR", info: { responseStatus: "401 Unauthorized" } })).to.equal(false);
    expect(isConnectionError(Object.assign(new Error("execution reverted"), { code: "CALL_EXCEPTION" }))).to.equal(false);
    expect(isConnectionError(new Error("anything else"))).to.equal(false);
    expect(isConnectionError(null)).to.equal(false);
  });
});

describe("patient connections", function () {
  it("allow far more than Node's default 5 seconds to set up a connection, and reuse it", function () {
    for (const url of ["https://testnet.hashio.io/api", "http://127.0.0.1:8545"]) {
      const agent = agentFor(url);
      expect(agent.options.timeout).to.be.at.least(30000);
      expect(agent.keepAlive).to.equal(true);
    }
    expect(() => agentFor("ftp://example.org")).to.throw("Unsupported address");
  });

  it("return any answer the server gives, and reject only on silence", async function () {
    const site = await serve(({ req, res, count }) => {
      if (count === 1) return json(res, 503, { busy: true });
      req.socket.destroy();
    });
    try {
      const first = await requestText(`${site.url}/x`, { method: "POST", body: JSON.stringify({ a: 1 }), headers: { "Content-Type": "application/json" } });
      expect(first.status).to.equal(503);
      expect(JSON.parse(first.text)).to.deep.equal({ busy: true });
      expect(site.requests[0].body).to.deep.equal({ a: 1 });

      let caught = null;
      try {
        await requestText(`${site.url}/x`);
      } catch (error) {
        caught = error;
      }
      expect(isConnectionError(caught)).to.equal(true);
    } finally {
      await site.close();
    }
  });
});

describe("connection to the network", function () {
  const settings = (url) => ({
    rpcUrl: url,
    chainId: 296,
    privateKey: ethers.Wallet.createRandom().privateKey,
    address: ethers.ZeroAddress,
    abi: [],
    retryDelays: [5, 5, 5],
  });

  it("asks again when the connection drops, and succeeds", async function () {
    const node = await serve(({ req, res, body, count }) => {
      if (count <= 2) return req.socket.destroy();
      json(res, 200, { jsonrpc: "2.0", id: body.id, result: "0x128" });
    });
    try {
      const { provider } = connect(settings(node.url));
      expect(await provider.send("eth_chainId", [])).to.equal("0x128");
      expect(node.requests.length).to.equal(3);
    } finally {
      await node.close();
    }
  });

  it("gives up after a few tries, with a reason", async function () {
    const node = await serve(({ req }) => req.socket.destroy());
    try {
      const { provider } = connect(settings(node.url));
      let caught = null;
      try {
        await provider.send("eth_chainId", []);
      } catch (error) {
        caught = error;
      }
      expect(isConnectionError(caught)).to.equal(true);
      expect(describeError(caught)).to.not.equal("");
      expect(node.requests.length).to.equal(4);
    } finally {
      await node.close();
    }
  });

  it("does not repeat a request the network answered with a refusal", async function () {
    const node = await serve(({ res, body }) => {
      json(res, 200, { jsonrpc: "2.0", id: body.id, error: { code: -32000, message: "nonce too low" } });
    });
    try {
      const { provider } = connect(settings(node.url));
      let caught = null;
      try {
        await provider.send("eth_sendRawTransaction", ["0x00"]);
      } catch (error) {
        caught = error;
      }
      expect(caught).to.not.equal(null);
      expect(node.requests.length).to.equal(1);
    } finally {
      await node.close();
    }
  });
});

describe("language model service", function () {
  const reply = (content) => ({ choices: [{ message: { role: "assistant", content } }] });

  it("keeps the configured model when the key is offered it", function () {
    expect(chooseModel("qwen/qwen3.8-27b", ["openai/gpt-oss-120b", "qwen/qwen3.8-27b"])).to.equal("qwen/qwen3.8-27b");
  });

  it("falls back to a model the key is offered, never to a non-chat one", function () {
    const offered = ["allam-2-7b", "openai/gpt-oss-20b", "openai/gpt-oss-120b", "whisper-large-v3"];
    expect(chooseModel("llama-3.3-70b-versatile", offered)).to.equal("openai/gpt-oss-120b");
    expect(chooseModel("llama-3.3-70b-versatile", ["openai/gpt-oss-20b", "whisper-large-v3"])).to.equal("openai/gpt-oss-20b");
    expect(chooseModel("llama-3.3-70b-versatile", ["whisper-large-v3", "allam-2-7b"])).to.equal(null);
  });

  it("switches model at start-up and says which one it left", async function () {
    const groq = await serve(({ res }) => json(res, 200, { data: [{ id: "openai/gpt-oss-120b" }, { id: "whisper-large-v3" }] }));
    try {
      const llm = createGroq({ apiKey: "k", model: "llama-3.3-70b-versatile", baseUrl: groq.url });
      expect(await llm.ready()).to.deep.equal({ model: "openai/gpt-oss-120b", replaced: "llama-3.3-70b-versatile" });
      expect(llm.model).to.equal("openai/gpt-oss-120b");
      expect(await llm.ready()).to.deep.equal({ model: "openai/gpt-oss-120b", replaced: null });
    } finally {
      await groq.close();
    }
  });

  it("explains what to do when no usable model is offered", async function () {
    const groq = await serve(({ res }) => json(res, 200, { data: [{ id: "whisper-large-v3" }] }));
    try {
      const llm = createGroq({ apiKey: "k", model: "llama-3.3-70b-versatile", baseUrl: groq.url });
      let caught = null;
      try {
        await llm.ready();
      } catch (error) {
        caught = error;
      }
      expect(caught.message).to.include("Set GROQ_MODEL in .env to one of: whisper-large-v3");
    } finally {
      await groq.close();
    }
  });

  it("asks a thinking model to keep its reasoning short and out of the reply", async function () {
    const groq = await serve(({ res }) => json(res, 200, reply('{"results":[]}')));
    try {
      const llm = createGroq({ apiKey: "k", model: "openai/gpt-oss-120b", baseUrl: groq.url });
      expect(await llm.complete([{ role: "user", content: "json please" }])).to.equal('{"results":[]}');
      const sent = groq.requests[0].body;
      expect(sent).to.include({ model: "openai/gpt-oss-120b", temperature: 0, reasoning_effort: "low", include_reasoning: false });
      expect(sent.response_format).to.deep.equal({ type: "json_object" });

      const other = createGroq({ apiKey: "k", model: "qwen/qwen3.8-27b", baseUrl: groq.url });
      await other.complete([{ role: "user", content: "json please" }]);
      expect(groq.requests[1].body).to.not.have.property("reasoning_effort");
    } finally {
      await groq.close();
    }
  });

  it("retries with the plainest request when the service refuses an option", async function () {
    const groq = await serve(({ res, count }) => {
      if (count === 1) return json(res, 400, { error: { message: "unsupported parameter" } });
      json(res, 200, reply("plain answer"));
    });
    try {
      const llm = createGroq({ apiKey: "k", model: "openai/gpt-oss-120b", baseUrl: groq.url });
      expect(await llm.complete([{ role: "user", content: "json please" }])).to.equal("plain answer");
      const second = groq.requests[1].body;
      expect(second).to.not.have.property("response_format");
      expect(second).to.not.have.property("reasoning_effort");
      expect(second).to.not.have.property("include_reasoning");
    } finally {
      await groq.close();
    }
  });

  it("marks an unreachable service as worth retrying, with a reason", async function () {
    const groq = await serve(({ req }) => req.socket.destroy());
    try {
      const llm = createGroq({ apiKey: "k", model: "openai/gpt-oss-120b", baseUrl: groq.url });
      let caught = null;
      try {
        await llm.complete([{ role: "user", content: "json please" }]);
      } catch (error) {
        caught = error;
      }
      expect(caught.transient).to.equal(true);
      expect(caught.message).to.match(/^Could not reach the language model: .+/);
      expect(groq.requests.length).to.equal(3);
    } finally {
      await groq.close();
    }
  });

  it("marks a wrong key as not worth retrying", async function () {
    const groq = await serve(({ res }) => json(res, 401, { error: { message: "Invalid API Key" } }));
    try {
      const llm = createGroq({ apiKey: "wrong", model: "openai/gpt-oss-120b", baseUrl: groq.url });
      let caught = null;
      try {
        await llm.listModels();
      } catch (error) {
        caught = error;
      }
      expect(caught.status).to.equal(401);
      expect(caught.transient).to.equal(false);
      expect(caught.message).to.include("Invalid API Key");
    } finally {
      await groq.close();
    }
  });
});
