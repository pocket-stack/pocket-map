import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { deflateRawSync } from "node:zlib";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AtlasProvider, ATLAS_FORMAT } from "../host/atlas.ts";

test("local atlas reads packed textures and searches planar places without an HTTP provider", () => {
  const dir = mkdtempSync(join(tmpdir(), "pocket-map-atlas-")), db = new Database(join(dir, "atlas.sqlite"));
  const source = "123456789abcdef0";
  db.exec(`CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE tiles (z INTEGER,x INTEGER,y INTEGER,pixels BLOB,PRIMARY KEY(z,x,y));
    CREATE VIRTUAL TABLE place_search USING fts5(id UNINDEXED,name,detail,x UNINDEXED,y UNINDEXED,zoom UNINDEXED);`);
  db.query("INSERT INTO metadata VALUES ('manifest',?)").run(JSON.stringify({ format: ATLAS_FORMAT, tiles: 21845,
    info: { source, name: "Fixture atlas", attribution: "Test", minZoom: 0, maxZoom: 7, space: "planar", local: true } }));
  const pixels = new Uint8Array(131072);
  for (let n = 0; n < pixels.length; n++) pixels[n] = n % 251;
  db.query("INSERT INTO tiles VALUES (0,0,0,?)").run(deflateRawSync(pixels));
  db.query("INSERT INTO tiles VALUES (7,127,127,?)").run(deflateRawSync(pixels));
  db.query("INSERT INTO tiles VALUES (1,0,0,?)").run(deflateRawSync(new Uint8Array(131073)));
  const place = db.query("INSERT INTO place_search VALUES (?,?,?,?,?,?)");
  place.run("h1", "Kakariko Village", "Village", 151, 130, 5);
  place.run("h2", "Kakariko Bridge", "Landmark", 151, 140, 6);
  for (let n = 0; n < 8; n++) place.run("s" + n, "Test Shrine " + n, "Shrine", 100 + n, 100, 6);
  db.close();
  let atlas = new AtlasProvider(dir);
  try {
    expect(atlas.tile({ source, z: 0, x: 0, y: 0 }).pixels).toEqual(pixels);
    expect(atlas.tile({ source, z: 0, x: 0, y: 0 }).pixels).toEqual(pixels);
    expect(atlas.tile({ source, z: 7, x: 127, y: 127 }).pixels).toEqual(pixels);
    expect(atlas.diagnostics()).toEqual({ atlasReads: 2, memoryHits: 1, downloads: 0 });
    expect(() => atlas.tile({ source: "wrong", z: 0, x: 0, y: 0 })).toThrow();
    expect(() => atlas.tile({ source, z: 8, x: 0, y: 0 })).toThrow();
    expect(() => atlas.tile({ source, z: 1, x: 1, y: 1 })).toThrow("Missing installed");
    expect(() => atlas.tile({ source, z: 1, x: 0, y: 0 })).toThrow();
    const query = { space: "planar" as const, x: 150, y: 130 };
    const rows = atlas.search({ ...query, query: "kak vil" });
    expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ name: "Kakariko Village", space: "planar", x: 151, y: 130 });
    expect(atlas.search({ ...query, query: "shrine" })).toHaveLength(5);
    expect(atlas.search({ ...query, query: "\" * -" })).toEqual([]);
    expect(() => atlas.search({ query: "Kakariko", lat: 0, lon: 0 })).toThrow();
    const save = { op: "atlas_saved_place_1", kind: "save" as const, place: rows[0] };
    const receipt = atlas.bookmarks.command(save); atlas.close(); atlas = new AtlasProvider(dir);
    expect(atlas.bookmarks.command(save)).toBe(receipt);
    expect(atlas.bookmarks.list(0).items[0]).toMatchObject({ space: "planar", x: 151, y: 130 });
  } finally { atlas.close(); rmSync(dir, { recursive: true, force: true }); }
});
