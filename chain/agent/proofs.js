// Which transaction recorded what.
//
// The contract announces every record with an event. Reading the events of a
// confirmed transaction tells exactly which lots and shipments it created, so
// the page can link each passport line to the transaction that wrote it.

/**
 * The records a confirmed transaction wrote, as keys like "lot:4" or
 * "shipment:2:closed". Events from any other contract are ignored.
 */
function recordsIn(receipt, contract) {
  const ours = String(contract.target).toLowerCase();
  const keys = [];
  for (const log of receipt.logs || []) {
    if (String(log.address).toLowerCase() !== ours) continue;
    let event = null;
    try {
      event = contract.interface.parseLog({ topics: [...log.topics], data: log.data });
    } catch {
      continue;
    }
    if (!event) continue;
    const { name, args } = event;
    if (name === "LotRecorded") keys.push(`lot:${args.id}`);
    if (name === "LotShipped") keys.push(`shipment:${args.shipmentId}:sent`);
    if (name === "ShipmentConfirmed") keys.push(`shipment:${args.shipmentId}:closed`, `lot:${args.newLot}`);
    if (name === "ShipmentRefused") keys.push(`shipment:${args.shipmentId}:closed`);
    if (name === "LotWithdrawn") keys.push(`lot:${args.id}:withdrawn`);
    if (name === "CompanyApproved") keys.push(`company:${String(args.company).toLowerCase()}`);
  }
  return keys;
}

/** Remembers a confirmed transaction against everything it recorded. Returns the keys. */
function remember(store, receipt, contract) {
  const keys = recordsIn(receipt, contract);
  for (const key of keys) store.putProof(key, receipt.hash);
  return keys;
}

module.exports = { recordsIn, remember };
