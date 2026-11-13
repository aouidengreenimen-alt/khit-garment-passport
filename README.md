# Khit Garment Passport

Build the front end of "Khit", a web app that shows the passport of a batch of clothes: every manufacturing step, recorded on the Hedera blockchain by the company that did it. Three companies are in the demo: a mill in Turkey that makes the fabric, a factory in Bizerte (Tunisia) that sews the jeans, and a brand in Paris that sells them.

Rules for this project:
- Front end only. No backend, no database, no Supabase, no login.
- All data access goes in one file, src/lib/api.ts, with these async functions: getPassport(code), listPassports(), getCompanies(), getSamples(), checkPaper(text). For now they return the mock data from src/data/mock.ts. Every page must get its data only through these functions, because this file will be replaced later by real API calls.
- Language: English. Works on phone and laptop.
- Never use the words "fake" or "fraud" anywhere.

Pages:
1. Home ("/"): a short explanation in three steps (each company records its own step; each handover is confirmed by both sides; anyone can check the journey), a field to type a passport code (example KHIT-6) with a button "See the passport", and the passports from listPassports() as cards to click.
2. Passport ("/passport/:code"):
   - header with product, number of pieces, weight, passport code and current holder;
   - a "Where it was made" summary from `origins`: Woven in, Dyed in, Sewn in, Washed in, each with country and company;
   - the journey as a vertical timeline from `lines`, oldest first. A line with type "step" shows the step, company, country, date, weight, pieces and batch reference. A line with type "handover" shows from company to company, sent date, received date, weight, and a "confirmed by both sides" mark;
   - a line whose standing is "withdrawn" or "company_removed" gets a clear warning style, and `warnings` are shown at the top;
   - each line has a small link "Proof on Hedera" (href "#" for now).
3. Check a paper ("/check"): a large text area to paste a delivery note, buttons to load the samples from getSamples(), and a button "Check this paper". After checking, show the report from checkPaper(): the counts at the top, then one row per statement with its status, the quoted words, the note, and the number of the passport line it was compared with. Status labels: verified = "On Hedera", differs = "Chain says otherwise", withdrawn = "Step withdrawn", not_found = "No record".
4. Companies ("/companies"): the list from getCompanies() with name, country, whether it can record new material, and approved or removed.

Mock data for src/data/mock.ts (keep these exact shapes; "at" and "sentAt" are Unix times in seconds):

const mill = { name: "Anadolu Denim (demo)", country: "Turkey", address: "0x1111111111111111111111111111111111111111", approved: true };
const factory = { name: "Atelier Bizerte (demo)", country: "Tunisia", address: "0x2222222222222222222222222222222222222222", approved: true };
const brand = { name: "Maison Lune (demo)", country: "France", address: "0x3333333333333333333333333333333333333333", approved: true };

export const companies = [
  { ...mill, source: true, since: 1793577600 },
  { ...factory, source: false, since: 1793577600 },
  { ...brand, source: false, since: 1793577600 },
];

export const passport = {
  lot: 6, code: "KHIT-6", holder: brand, kg: 600, madeKg: 600,
  product: "Men's jeans, stone washed", reference: "J-507-W", pieces: 1000,
  origins: {
    weaving: [{ country: "Turkey", company: "Anadolu Denim (demo)", standing: "valid", n: 2 }],
    dyeing: [{ country: "Turkey", company: "Anadolu Denim (demo)", standing: "valid", n: 1 }],
    sewing: [{ country: "Tunisia", company: "Atelier Bizerte (demo)", standing: "valid", n: 4 }],
    finishing: [{ country: "Tunisia", company: "Atelier Bizerte (demo)", standing: "valid", n: 5 }],
  },
  lines: [
    { n: 1, type: "step", lot: 1, step: "dyeing", company: mill, at: 1793577600, kg: 780, product: "Cotton yarn, indigo dyed", reference: "Y-118", pieces: null, note: "", standing: "valid", withdrawnAt: null },
    { n: 2, type: "step", lot: 2, step: "weaving", company: mill, at: 1793750400, kg: 760, product: "Indigo denim, 12 oz", reference: "F-21", pieces: null, note: "", standing: "valid", withdrawnAt: null },
    { n: 3, type: "handover", lot: 3, shipment: 1, from: mill, to: factory, sentAt: 1793836800, at: 1794182400, kg: 760, reference: "BL-0457", standing: "valid" },
    { n: 4, type: "step", lot: 4, step: "sewing", company: factory, at: 1794268800, kg: 610, product: "Men's jeans, model Rafraf", reference: "J-507", pieces: 1000, note: "", standing: "valid", withdrawnAt: null },
    { n: 5, type: "step", lot: 5, step: "finishing", company: factory, at: 1794355200, kg: 600, product: "Men's jeans, stone washed", reference: "J-507-W", pieces: 1000, note: "", standing: "valid", withdrawnAt: null },
    { n: 6, type: "handover", lot: 6, shipment: 2, from: factory, to: brand, sentAt: 1794355200, at: 1794441600, kg: 600, reference: "BL-0911", standing: "valid" },
  ],
  warnings: [],
};

export const passports = [
  { code: "KHIT-6", lot: 6, product: "Men's jeans, stone washed", pieces: 1000, kg: 600, holder: "Maison Lune (demo)", holderCountry: "France" },
];

export const samples = [
  { id: "honest", label: "A correct delivery note", text: "DELIVERY NOTE BL-0911\nFrom: Atelier Bizerte, Bizerte, Tunisia\nTo: Maison Lune, Paris, France\nPassport: KHIT-6\n\nGoods: 1,000 pairs of men's jeans, stone washed\nNet weight: 600 kg\n\nFabric dyed in Turkey\nFabric woven in Turkey\nSewn in Tunisia\nWashed in Tunisia" },
  { id: "changed", label: "A note that says something else", text: "DELIVERY NOTE BL-0911\nFrom: Atelier Bizerte, Bizerte, Tunisia\nTo: Maison Lune, Paris, France\nPassport: KHIT-6\n\nGoods: 1,200 pairs of men's jeans, stone washed\n100% organic cotton, GOTS certified\n\nFabric woven in Italy\nSewn in Tunisia" },
];

export const report = {
  lot: 6, code: "KHIT-6",
  counts: { verified: 1, differs: 2, withdrawn: 0, not_found: 1 },
  claims: [
    { n: 1, kind: "quantity", claim: "1,200 pairs of jeans delivered", quote: "1,200 pairs of men's jeans", status: "differs", note: "The paper says 1,200 pieces. The passport says 1,000.", by: "code", line: 5 },
    { n: 2, kind: "other", claim: "100% organic cotton, GOTS certified", quote: "100% organic cotton, GOTS certified", status: "not_found", note: "The passport does not record fibre certificates.", by: "model", line: null },
    { n: 3, kind: "weaving", claim: "Fabric woven in Italy", quote: "Fabric woven in Italy", status: "differs", note: "The paper says Italy. The passport says Turkey, recorded by Anadolu Denim (demo).", by: "code", line: 2 },
    { n: 4, kind: "sewing", claim: "Sewn in Tunisia", quote: "Sewn in Tunisia", status: "verified", note: "Sewn in Tunisia, recorded by Atelier Bizerte (demo).", by: "code", line: 4 },
  ],
  notes: [], model: "openai/gpt-oss-120b", checkedAt: "2026-11-13T16:00:00.000Z",
  log: { topicId: "0.0.1234567", sequenceNumber: 12 },
};

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/4c7d1d5b-9aed-5085-8107-7a95c76986f1).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
