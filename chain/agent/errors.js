// Turning errors into one readable line, and telling a bad connection apart
// from a real refusal.

const CONNECTION_CODES = new Set([
  "ECONNRESET", "ECONNREFUSED", "ECONNABORTED", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "EPIPE",
  "ENETUNREACH", "EHOSTUNREACH", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET", "UND_ERR_HEADERS_TIMEOUT",
  "TIMEOUT", "NETWORK_ERROR",
]);

/** One sentence for any error, including the ones that arrive with a blank message. */
function describeError(error) {
  if (!error) return "Unknown error";
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

module.exports = { describeError, isConnectionError };
