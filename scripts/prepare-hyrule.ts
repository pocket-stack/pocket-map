import { prepareMarkers } from "../host/markers.ts";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, renameSync, rmSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { deflateRawSync } from "node:zlib";
import { Database } from "bun:sqlite";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { packRGB } from "../host/provider.ts";
import { ATLAS_FORMAT, HYRULE_REVISION, type AtlasManifest } from "../host/atlas.ts";
import type { MapInfo } from "../shared/types.ts";

const root = resolve(import.meta.dir, ".."), source = join(root, ".local/hyrule-source");
const directory = join(root, ".local/hyrule"), output = join(directory, "atlas.sqlite");
async function git(...args: string[]) {
  const child = Bun.spawn(["git", ...args], { stdout: "pipe", stderr: "inherit" });
  const text = await new Response(child.stdout).text();
  if (await child.exited) throw new Error("Hyrule source checkout failed");
  return text.trim();
}
mkdirSync(directory, { recursive: true });
if (!existsSync(join(source, ".git"))) await git("clone", "--depth", "1", "--filter=blob:none", "--sparse", "--branch", "develop", "https://github.com/zeldadungeon/maps.git", source);
if (await git("-C", source, "rev-parse", "HEAD") !== HYRULE_REVISION) {
  await git("-C", source, "fetch", "--depth", "1", "origin", HYRULE_REVISION);
  await git("-C", source, "checkout", "--detach", HYRULE_REVISION);
}
await git("-C", source, "sparse-checkout", "set", "public/botw");
const assets = join(source, "public/botw");
if (existsSync(output) && !process.argv.includes("--rebuild")) {
  const db = new Database(output, { readonly: true });
  const manifest = JSON.parse((db.query("SELECT value FROM metadata WHERE key='manifest'").get() as { value: string }).value) as AtlasManifest;
  db.close();
  if (manifest.revision !== HYRULE_REVISION || manifest.format !== ATLAS_FORMAT) throw new Error("Atlas version differs; use --rebuild");
  const markers = await prepareMarkers(directory, join(source, "public/botw"));
  console.log(`Marker index ready: ${markers} annotations`);
  console.log(`Hyrule ready: ${manifest.tiles} local textures, ${manifest.places} searchable places`);
  process.exit(0);
}

for (let z = 0; z <= 5; z++) {
  if (readdirSync(join(assets, `tiles/${z}`)).filter(file => file.endsWith(".jpg")).length !== 4 ** z) throw new Error("Incomplete source tile pyramid");
}
console.log("Source verified: 1,365 JPEG tiles, full 24,000px map pyramid; baking on the Mac");
const pending = join(directory, "atlas.build.sqlite");
if (existsSync(pending)) rmSync(pending);
const db = new Database(pending);
db.exec(`PRAGMA journal_mode=DELETE; PRAGMA synchronous=NORMAL;
  CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE tiles (z INTEGER, x INTEGER, y INTEGER, pixels BLOB NOT NULL, PRIMARY KEY(z,x,y)) WITHOUT ROWID;
  CREATE VIRTUAL TABLE place_search USING fts5(id UNINDEXED,name,detail,x UNINDEXED,y UNINDEXED,zoom UNINDEXED,tokenize='unicode61 remove_diacritics 2');`);
let tiles = 0, places = 0;
const insertTile = db.query("INSERT INTO tiles VALUES (?,?,?,?)");
const canvas = createCanvas(256, 256), ctx = canvas.getContext("2d");
ctx.imageSmoothingEnabled = true;
try {
  for (let z = 0; z <= 7; z++) {
    const sourceZ = Math.max(0, z - 2), divide = 2 ** (z - sourceZ), crop = 750 / divide;
    for (let y = 0; y < 2 ** sourceZ; y++) for (let x = 0; x < 2 ** sourceZ; x++) {
      const image = await loadImage(join(assets, `tiles/${sourceZ}/${x}_${y}.jpg`));
      if (image.width !== 750 || image.height !== 750) throw new Error("Invalid source tile dimensions");
      db.transaction(() => {
        for (let dy = 0; dy < divide; dy++) for (let dx = 0; dx < divide; dx++) {
          ctx.drawImage(image, dx * crop, dy * crop, crop, crop, 0, 0, 256, 256);
          const image565 = packRGB(ctx.getImageData(0, 0, 256, 256).data, 256, 256);
          insertTile.run(z, x * divide + dx, y * divide + dy, deflateRawSync(image565.pixels, { level: 1 })); tiles++;
        }
      })();
      if (tiles % 1024 < 16) console.log(`Baked ${tiles}/21845 textures`);
    }
    console.log(`Level ${z} complete (${tiles} textures)`);
  }
  const insertPlace = db.query("INSERT INTO place_search VALUES (?,?,?,?,?,?)");
  const seen = new Set<string>();
  for (const file of ["locations", "pins", "seeds", "treasures"]) {
    const groups = await Bun.file(join(assets, `markers/${file}.json`)).json();
    db.transaction(() => {
      for (const group of groups) for (const layer of group.layers ?? []) for (const marker of layer.markers ?? []) {
        if (!Array.isArray(marker.coords) || marker.coords.length !== 2 || !marker.coords.every(Number.isFinite)) continue;
        const [north, east] = marker.coords;
        const x = (east + 12000) / 24000 * 256, y = (12000 - north) / 24000 * 256;
        if (x < 0 || y < 0 || x > 256 || y > 256) continue;
        const kind = file === "seeds" ? "Korok seed" : file === "treasures" ? "Treasure" : group.name;
        const name = String(marker.name ?? `${kind} ${marker.id ?? places + 1}`).replace(/<[^>]+>/g, "").slice(0, 36);
        const key = `${name}/${x.toFixed(3)}/${y.toFixed(3)}`;
        if (seen.has(key)) continue; seen.add(key);
        const id = "h_" + createHash("sha256").update(key).digest("hex").slice(0, 24);
        const detail = String(file === "seeds" || file === "treasures" ? `${kind} - ${group.name}` : kind).slice(0, 60);
        insertPlace.run(id, name, detail, x, y, group.name === "Region" ? 3 : group.name === "Subregion" ? 4 : 6); places++;
      }
    })();
  }
  const info: MapInfo = { source: createHash("sha256").update(`${ATLAS_FORMAT}/${HYRULE_REVISION}`).digest("hex").slice(0, 16),
    name: "Hyrule - Breath of the Wild", attribution: "Nintendo | Zelda Dungeon", minZoom: 0, maxZoom: 7, space: "planar", local: true,
    home: { id: "hyrule-home", name: "Great Plateau", detail: "Breath of the Wild", space: "planar", x: (12000 - 1900) / 24000 * 256, y: (12000 + 3750) / 24000 * 256, zoom: 4 } };
  const manifest: AtlasManifest = { format: ATLAS_FORMAT, revision: HYRULE_REVISION, tiles, places, info };
  if (tiles !== 21845) throw new Error("Incomplete atlas bake");
  db.query("INSERT INTO metadata VALUES ('manifest',?)").run(JSON.stringify(manifest));
  db.close(); renameSync(pending, output);
  await Bun.write(join(directory, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`Marker index ready: ${await prepareMarkers(directory, assets)} annotations`);
  console.log(`Hyrule ready: ${tiles} textures and ${places} searchable places, no runtime internet access`);
} catch (error) { db.close(); throw error; }
