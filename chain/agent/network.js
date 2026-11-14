// Makes the agent patient on slow or distant connections. Load this first.
//
// By default Node gives each address of a host only 250 ms to answer before it
// moves to the next one, and reports a blank "AggregateError" when none is that
// fast. From far away, or on a busy line, 250 ms is too tight.

const net = require("net");
const dns = require("dns");

if (typeof net.setDefaultAutoSelectFamilyAttemptTimeout === "function") {
  net.setDefaultAutoSelectFamilyAttemptTimeout(3000);
}
dns.setDefaultResultOrder("ipv4first");
