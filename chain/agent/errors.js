// Turning errors into one readable line, and telling a bad connection apart
// from a real refusal.

const CONNECTION_CODES = new Set([
  "ECONNRESET", "ECONNREFUSED", "ECONNABORTED", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "EPIPE",
  "ENETUNREACH", "EHOSTUNREACH", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET", "UND_ERR_HEADERS_TIMEOUT",
  "TIMEOUT", "NETWORK_ERROR",
]);

/**
 * What Hedera's relay said when it answered a request with an error instead of
 * a result: { status, code, message }. Null for any other kind of error.
 */
function relayAnswer(error) {
  if (!error || error.code !== "SERVER_ERROR" || !error.info) return null;
  const status = Number.parseInt(String(error.info.responseStatus || ""), 10) || 0;
  if (!status) return null;
  let code = null;
  let message = "";
  try {
    const parsed = JSON.parse(error.info.responseBody);
    const entry = Array.isArray(parsed) ? parsed[0] : parsed;
    if (entry && entry.error) {
      code = typeof entry.error.code === "number" ? entry.error.code : null;
      // The relay starts its messages with "[Request ID: ...]", which says nothing to a reader.
      message = String(entry.error.message || "").replace(/^\[Request ID: [^\]]*\]\s*/i, "").trim();
    }
  } catch {
    // Not JSON: only the status is known.
  }
  return { status, code, message };
}

// Relay answers that mean "not now": its own limit per visitor, the mirror node
// behind it failing or timing out, or records that are not there yet.
const BUSY_CODES = new Set([-32605, -32020, -32010, -32015, -32607]);

/**
 * True when the relay, or the mirror node it reads from, was too busy to answer.
 * The request did nothing, so asking again a little later is safe.
 */
function isBusyError(error) {
  const answer = relayAnswer(error);
  if (!answer) return false;
  if (answer.status === 429 || answer.status >= 500) return true;
  if (answer.status !== 400) return false;
  if (BUSY_CODES.has(answer.code)) return true;
  // A read the mirror node could not run for the relay, most often because of its own rate limit.
  return answer.code === -32000 && /transaction simulation/i.test(answer.message);
}

/** One sentence for any error, including the ones that arrive with a blank message. */
function describeError(error) {
  if (!error) return "Unknown error";
  const answer = relayAnswer(error);
  if (answer) {
    return answer.message
      ? `Hedera's relay answered: ${answer.message}`
      : `Hedera's relay answered with an error and no explanation (HTTP ${answer.status}).`;
  }
  if (error.shortMessage) return error.shortMessage;
  if (error.message) return error.message;

  // Node reports "none of this host's addresses answered" as an error with no message.
  const inner = Array.isArray(error.errors)
    ? [...new Set(error.errors.map((e) => e && (e.message || e.code)).filter(Boolean))]
    : [];
  if (inner.length) return `Could not connect: ${inner.join("; ")}`;
  if (error.cause) return describeError(error.cause);
  if (error.code) return `Could not connect (${error.code})`;
  return String(error.name || "Unknown error");
}

/** True when the request most likely never arrived, so asking again is safe. */
function isConnectionError(error) {
  if (!error) return false;
  if (error.name === "AggregateError" || CONNECTION_CODES.has(error.code)) return true;
  if (Array.isArray(error.errors) && error.errors.some((e) => e && CONNECTION_CODES.has(e.code))) return true;
  if (error.cause && error.cause !== error && isConnectionError(error.cause)) return true;
  if (error.code === "SERVER_ERROR") {
    return /^(502|503|504)\b/.test(String((error.info && error.info.responseStatus) || ""));
  }
  return false;
}

module.exports = { describeError, isConnectionError, isBusyError, relayAnswer };
