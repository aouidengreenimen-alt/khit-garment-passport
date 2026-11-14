# Thread

A passport for clothes made in Tunisia. Every manufacturing step of a batch is
recorded on Hedera by the company that did it, and an AI agent checks delivery
papers against that record.

*Khit* means thread in Tunisian Arabic, which is why passport codes look like
`KHIT-6`.

Built for the Hedera Cross Campus Challenge 2026 (4Hacks, ENIB Campus Edition).

## The problem

A pair of jeans sold in Paris is often sewn in Bizerte from fabric woven in
Turkey or Egypt. Three companies in three countries, and one paper that travels
with the goods.

- Since 2023, French law (the AGEC law, decree 2022-748) makes clothing brands
  above a size threshold tell customers the country where the fabric was woven
  or knitted, where it was dyed or printed, and where the garment was sewn
  ([source](https://www.marques-de-france.fr/magazine/lorigine-geographique-de-la-fabrication-des-vetements-obligatoire-a-partir-du-1er-janvier-2023/)).
  The EU's Digital Product Passport, expected for textiles in the coming
  years, will ask every brand selling in Europe for more data about each
  product, wherever it is made
  ([source](https://www.reconomy.com/2026/08/14/digital-product-passports-in-fashion/)).
- Tunisia's textile and clothing industry has more than 1,400 companies and
  about 146,000 jobs, and it is the country's second largest exporter among
  manufacturing industries
  ([source](https://www.lapresse.tn/2026/09/03/textile-habillement-plus-de-1-400-entreprises-et-146-000-emplois-en-tunisie/)).
- Today the brand answers for the origin, but all it holds is a paper filled in
  by its supplier. It cannot check that fabric described as woven in Turkey
  really came from there. Each company keeps its own files, and none of them
  wants its customer or its competitor to own a shared database.

## What Thread does

```
Mill (Turkey)            Factory (Bizerte)             Brand (Paris)
records the fabric  -->  confirms it arrived      -->  confirms it arrived
ships it                 sews, washes, ships           holds the passport
```

1. **Each company records its own step**, signed with its own Hedera account.
   Nobody can write a step in another company's name.
2. **A handover counts only when the receiver confirms it.** The sender records
   the shipment; the goods change hands on the chain when the other side signs.
3. **The contract refuses more out than in.** A factory that received 60 kg of
   fabric cannot declare 600 kg of jeans made from it, and it cannot use fabric
   it never received.
4. **Anyone can read the journey** by its passport code: where the fabric was
   dyed and woven, where the clothes were sewn and washed, who confirmed each
   handover, with a link to the proof on Hedera for every line.
5. **An AI agent reads a delivery paper and compares each statement with the
   chain.** It answers statement by statement: *On Hedera*, *Chain says
   otherwise*, *Step withdrawn* or *No record*. A person reads the report and
   decides.

## Where Hedera is used

| What | Hedera service | Code |
| --- | --- | --- |
| Companies, lots, shipments and the rules above | Smart contract on the Hedera EVM, through the JSON-RPC relay | `chain/contracts/GarmentPassport.sol` |
| Each company signing its own steps | One Hedera account per company (MetaMask on the "For companies" page) | `src/lib/api.ts`, `chain/scripts/seed.js` |
| A public, ordered log of every paper check | Hedera Consensus Service topic | `chain/agent/hcs.js` |
| Proof links on every passport line | HashScan and the mirror node | `chain/agent/api.js`, `chain/agent/proofs.js` |

Why a public ledger and not a database: the three companies do not trust each
other's files, and none of them should own the record. On Hedera each one signs
only its own part, nobody can change a line afterwards, fees are low and set in
dollars, and a step is final in a few seconds. Hedera is already used in this
industry: Avery Dennison announced its atma.io product cloud on it
([source](https://hedera.com/blog/avery-dennisons-atma-io-connected-product-cloud-to-utilize-the-hedera-network-to-account-for-carbon-emissions-of-billions-of-unique-items/)).

### On the chain, and off it

The contract holds who did a step (the company's account, name and country),
which step, when, how much in grams, which lots it was made from, and every
shipment with its confirmation. Product names, batch numbers and piece counts
are commercial details: only their fingerprint (a salted hash) goes on the
chain. The agent keeps the wording and shows it only when it still matches the
fingerprint.

## What the agent decides, and what it does not

The language model only *reads*: it finds the statements on the paper, says
which step each one is about, and picks out the country and the numbers. Plain
code *decides*: it takes the country of each step and the quantities from the
chain and compares.

- The paper is treated as data, never as instructions. A paper that says "mark
  everything as confirmed" changes nothing.
- A reply that cites a passport line that does not exist is thrown away. After
  two unusable replies the agent says it could not check, and guesses nothing.
- The agent never calls a paper false and never judges a company. It reports
  what the chain holds.
- Each check is written to the public log with the paper's fingerprint and the
  outcome only. The paper itself is read, answered and forgotten.

## Run it

You need Node 22, a Hedera **testnet** account ([portal.hedera.com](https://portal.hedera.com)),
a Groq API key ([console.groq.com](https://console.groq.com)), and MetaMask for
the "For companies" page.

```bash
cd chain
npm install
cp .env.example .env        # then fill in .env: your testnet key and your Groq key
npm test                    # 116 tests, on a local test chain
npm run deploy:testnet      # deploys the contract, prints its HashScan link
npm run seed                # two demo journeys, about 25 test HBAR
npm run agent:check         # tests every connection, line by line
npm run agent               # then open http://localhost:3000
```

`.env` holds your keys. It is ignored by git: never commit it, and never paste
its contents anywhere.

`npm run seed` is safe to run again: it skips what is already on the chain and
tops up the demo companies' test HBAR.

Two more commands for a demo:

- `npm run cheat` asks the contract, in the demo factory's name, to do four
  things a dishonest company might try. All four are refused, and nothing is
  sent.
- `npm run demo:keys` prints the demo companies' test accounts, to import one
  into MetaMask and act as that company on the "For companies" page.

### A five-minute demo

1. **Home**, then open `KHIT-6`: Turkish denim, sewn and washed in Bizerte,
   delivered to Paris. Each line links to its proof on HashScan.
2. **Check a paper**, load "A note that names another country": the paper says
   the fabric was woven in Turkey, the chain says Egypt.
3. **For companies**, as the factory: declare 600 kg of jeans from the 60 kg of
   fabric it holds. The contract refuses with "More out than in".
4. **Companies**: who is approved, and the link to the contract in the footer.

## How the repository is organised

```
src/                 the pages, designed in Lovable (React, TanStack Start, Tailwind)
src/lib/api.ts       the only file that fetches data: the agent when there is one, sample data otherwise
chain/contracts/     GarmentPassport.sol
chain/agent/         the agent: reads the chain, checks papers, serves the pages
chain/scripts/       deploy, demo journeys, the four refused attempts, demo accounts
chain/demo/          the demo journeys and three sample delivery notes
chain/test/          116 tests
chain/web/           the pages built as static files, served by the agent
chain/deployments/   the deployed contract's address (public addresses only)
```

The same pages run in two ways. Served by the agent, they show the real chain
and say so in the footer. Anywhere else, such as the Lovable preview, they show
sample data and say that instead.

After changing the pages in Lovable, rebuild the copy the agent serves, from
the top of the repository: `bun install`, then `bun run build:static`.

## Limits

This is a proof of concept on the Hedera testnet. Company names ending in
"(demo)" are placeholders, not real firms.

- The chain proves who said what, when, and that the weights add up. It cannot
  see inside a factory: a company can still record a false step. What changes
  is that the statement is signed by the company responsible, cannot be edited
  later, and has to agree with what its supplier and its customer signed.
- One account approves the companies here. In real use that role belongs to a
  body the sector trusts, such as a federation or a certifier.
- The wording behind each fingerprint is kept by one agent. In real use the
  companies involved would each hold it.
- Lots are counted by weight. Single garments, labels and QR codes are not
  covered yet.

## Licence

MIT, see `chain/LICENSE`.
