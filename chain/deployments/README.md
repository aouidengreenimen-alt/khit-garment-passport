# Deployments

`npm run deploy:testnet` writes `hederaTestnet.json` here: the contract's
address, its owner and its interface. `npm run seed` adds
`hederaTestnet.demo.json`: the demo companies' addresses and the passports of
the two demo journeys. The agent adds the id of its public log to the first
file the first time it starts.

These files hold public addresses only, never a key. They are meant to be
committed, so anyone can find the contract on HashScan.
