// The pictures the pages use.
//
// The front end was designed in Lovable, which keeps uploaded pictures on its
// own servers and gives the pages an address like /__l5e/assets-v1/<id>/<file>.
// When the pages are served from here, that address has to answer too. So the
// agent fetches each picture once from the Lovable site, keeps a copy in
// agent/data/pictures/, and serves the copy from then on.
//
// A picture file placed by hand in pictures/ (next to this folder), under the
// same file name, comes first and needs no network at all.
//
// If a picture cannot be found either way, the page simply shows without it.

const fs = require("fs");
const path = require("path");

const ADDRESS = /^\/__l5e\/assets-v1\/([0-9a-f-]{36})\/([A-Za-z0-9._-]{1,120})$/;
const MAX_BYTES = 10 * 1024 * 1024;

/** The pictures the front end describes in src/assets/*.asset.json, by id. */
function knownPictures(frontendDir) {
  const dir = path.join(frontendDir, "src", "assets");
  const known = new Map();
  if (!fs.existsSync(dir)) return known;
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".asset.json")) continue;
    try {
      const asset = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
      if (asset.asset_id) known.set(asset.asset_id, asset);
    } catch {
      // A file that is not valid JSON describes no picture.
    }
  }
  return known;
}

/**
 * @param frontendDir  the top of the repository, where src/assets is
 * @param cacheDir     where fetched pictures are kept
 * @param localDir     where pictures placed by hand are looked for first (optional)
 * @param site         the published Lovable site (optional), tried first
 * @param fetcher      for tests
 */
function createPictures({ frontendDir, cacheDir, localDir = "", site = "", fetcher = fetch, logger = console }) {
  const known = knownPictures(frontendDir);
  const warned = new Set();

  let siteHost = "";
  try {
    siteHost = site ? new URL(site.includes("://") ? site : `https://${site}`).host : "";
  } catch {
    siteHost = "";
  }

  return async function pictures(req, res, next) {
    const match = ADDRESS.exec(req.path);
    if (req.method !== "GET" || !match) return next();
    const [, id, name] = match;
    const asset = known.get(id);
    if (!asset || /^\.+$/.test(name)) return res.status(404).end();

    const type = asset.content_type || "image/jpeg";
    const local = localDir ? path.join(localDir, name) : "";
    if (local && fs.existsSync(local) && fs.statSync(local).isFile()) return res.type(type).sendFile(local);
    const cached = path.join(cacheDir, `${id}-${name}`);
    if (fs.existsSync(cached)) return res.type(type).sendFile(cached);

    const hosts = [siteHost, asset.project_id ? `id-preview--${asset.project_id}.lovable.app` : ""].filter(Boolean);
    for (const host of hosts) {
      try {
        const answer = await fetcher(`https://${host}${req.path}`, { signal: AbortSignal.timeout(20000) });
        const answered = String(answer.headers.get("content-type") || "");
        if (!answer.ok || !answered.startsWith("image/")) continue;
        const bytes = Buffer.from(await answer.arrayBuffer());
        if (!bytes.length || bytes.length > MAX_BYTES) continue;
        fs.mkdirSync(cacheDir, { recursive: true });
        fs.writeFileSync(cached, bytes);
        return res.type(answered).send(bytes);
      } catch {
        // Try the next place.
      }
    }
    if (!warned.has(name)) {
      warned.add(name);
      logger.warn(`Picture ${name} could not be fetched from Lovable, so the pages show without it. To add it, save the picture as pictures/${name} in this folder.`);
    }
    res.status(404).end();
  };
}

module.exports = { createPictures, knownPictures };
