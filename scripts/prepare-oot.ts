import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { deflateRawSync } from "node:zlib";
import { Database } from "bun:sqlite";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { packRGB } from "../host/provider.ts";
import { OOT_REVISION, OOT_VIEW, OOT_GRIDS, OOT_LEVEL_OFFSET, ootPlaces } from "../host/oot-format.ts";
import { ATLAS_FORMAT, atlasTileCount, atlasPackName, validAtlas, type AtlasManifest } from "../shared/atlas.ts";
import type { MapInfo } from "../shared/types.ts";

const root = resolve(import.meta.dir, ".."), source = join(root, ".local/oot-source/repo"),
  directory = join(root, ".local/oot"), output = join(directory, "atlas.sqlite");
const revision = `${OOT_REVISION}/${OOT_VIEW}/v1`;
mkdirSync(directory, { recursive: true });
if (existsSync(output) && existsSync(join(directory, "markers.sqlite")) && !process.argv.includes("--rebuild")) {
  const db = new Database(output, { readonly: true });
  const manifest = JSON.parse((db.query("SELECT value FROM metadata WHERE key='manifest'").get() as { value: string }).value); db.close();
  if (!validAtlas(manifest) || manifest.revision !== revision) throw Error("Atlas version differs; use --rebuild");
  console.log(`Ocarina of Time ready: ${manifest.tiles} tiles, ${manifest.places} searchable regions and rooms`);
  process.exit(0);
}
async function git(...args: string[]) {
  const child = Bun.spawn(["git", ...args], { stdout: "pipe", stderr: "inherit" });
  const text = await new Response(child.stdout).text();
  if (await child.exited) throw Error("OoT source checkout failed");
  return text.trim();
}
if (!existsSync(join(source, ".git"))) await git("clone", "--depth", "1", "--filter=blob:none", "--no-checkout", "https://github.com/Ecksters/OoT-Interactive-Map.git", source);
await git("-C", source, "sparse-checkout", "set", `maps/${OOT_VIEW}`, "js");
if (await git("-C", source, "rev-parse", "HEAD") !== OOT_REVISION) await git("-C", source, "fetch", "--depth", "1", "origin", OOT_REVISION);
await git("-C", source, "checkout", "--detach", OOT_REVISION);
const assets = join(source, "maps", OOT_VIEW);
for (let z = 0; z < OOT_GRIDS.length; z++) {
  const [w, h] = OOT_GRIDS[z], files = new Set(readdirSync(join(assets, String(z + OOT_LEVEL_OFFSET))).filter(f => f.endsWith(".png")));
  if (files.size !== w * h) throw Error(`Incomplete source level ${z}`);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (!files.has(`map_tile_${x}_${y}.png`)) throw Error("Missing source tile");
}
const places = ootPlaces(await Bun.file(join(source, "js/mapdata.js")).text());
const home = places.find(p => p.name === "Hyrule Field" && !p.room);
if (!home || places.length < 400) throw Error("Incomplete OoT place index");
const pending = join(directory, "atlas.build.sqlite"), markerPending = join(directory, "markers.build.sqlite");
for (const path of [pending, markerPending]) if (existsSync(path)) rmSync(path);
const db = new Database(pending), markers = new Database(markerPending);
db.exec(`PRAGMA journal_mode=DELETE; PRAGMA synchronous=NORMAL;
  CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
  CREATE TABLE tiles(z INTEGER,x INTEGER,y INTEGER,pixels BLOB NOT NULL,PRIMARY KEY(z,x,y)) WITHOUT ROWID;
  CREATE VIRTUAL TABLE place_search USING fts5(id UNINDEXED,name,detail,x UNINDEXED,y UNINDEXED,zoom UNINDEXED,tokenize='unicode61 remove_diacritics 2');`);
markers.exec(`CREATE TABLE metadata(version TEXT,count INTEGER);
  CREATE TABLE markers(id INTEGER PRIMARY KEY,name TEXT,kind TEXT,x REAL,y REAL,minZoom INTEGER,maxZoom INTEGER,priority INTEGER);
  CREATE VIRTUAL TABLE bounds USING rtree(id,x0,x1,y0,y1);`);
const canvas = createCanvas(256, 256), ctx = canvas.getContext("2d"),
  insert = db.query("INSERT INTO tiles VALUES (?,?,?,?)"), blank = deflateRawSync(new Uint8Array(131072), { level: 1 });
let tiles = 0;
try {
  for (let z = 0; z <= 7; z++) {
    const [w, h] = OOT_GRIDS[z];
    for (let y = 0; y < 2 ** z; y++) {
      const row: Uint8Array[] = [];
      for (let x = 0; x < 2 ** z; x++) {
        let pixels = blank;
        if (x < w && y < h) {
          const image = await loadImage(join(assets, String(z + OOT_LEVEL_OFFSET), `map_tile_${x}_${y}.png`));
          if (image.width !== 256 || image.height !== 256) throw Error("Invalid OoT source dimensions");
          ctx.fillStyle = "#000"; ctx.fillRect(0, 0, 256, 256); ctx.drawImage(image, 0, 0);
          pixels = deflateRawSync(packRGB(ctx.getImageData(0, 0, 256, 256).data, 256, 256).pixels, { level: 1 });
        }
        row.push(pixels);
      }
      db.transaction(() => { row.forEach((pixels, x) => { insert.run(z, x, y, pixels); tiles++; }); })();
    }
    console.log(`OoT level ${z}: ${tiles}/${atlasTileCount(7)} tiles`);
  }
  const putPlace = db.query("INSERT INTO place_search VALUES (?,?,?,?,?,?)"), putMarker = markers.query("INSERT INTO markers VALUES (?,?,?,?,?,?,?,?)"), putBounds = markers.query("INSERT INTO bounds VALUES (?,?,?,?,?)");
  db.transaction(() => { for (const p of places) putPlace.run(p.id, p.name, p.detail, p.x, p.y, p.zoom); })();
  markers.transaction(() => {
    places.forEach((p, n) => { putMarker.run(n + 1, p.name.slice(0, 24), /Village|Kokiri Forest/.test(p.name) ? "village" : "landmark", p.x, p.y, p.room ? 6 : 2, 7, p.room ? 5 : 0); putBounds.run(n + 1, p.x, p.x, p.y, p.y); });
    markers.query("INSERT INTO metadata VALUES (?,?)").run(revision, places.length);
  })();
  const identity = createHash("sha256").update(`${ATLAS_FORMAT}/${revision}`).digest("hex").slice(0, 16);
  const { room, ...start } = home;
  const info: MapInfo = { source: identity, kind: "oot", name: "Ocarina of Time", attribution: "Nintendo | Peardian | Ecksters",
    minZoom: 0, maxZoom: 7, space: "planar", local: true, worldUnits: 32768,
    pack: atlasPackName("oot", identity), home: { ...start, zoom: 4 } };
  const manifest: AtlasManifest = { format: ATLAS_FORMAT, revision, tiles, places: places.length, info };
  if (!validAtlas(manifest)) throw Error("Incomplete OoT bake");
  db.query("INSERT INTO metadata VALUES ('manifest',?)").run(JSON.stringify(manifest));
  db.close(); markers.close(); renameSync(markerPending, join(directory, "markers.sqlite")); renameSync(pending, output);
  await Bun.write(join(directory, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`Ocarina of Time ready: ${tiles} textures and ${places.length} searchable regions and rooms`);
} catch (error) { db.close(); markers.close(); throw error; }
