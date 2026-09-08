import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { deflateRawSync } from "node:zlib";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AtlasProvider, ATLAS_FORMAT } from "../host/atlas.ts";
import { atlasTileCount, validAtlas } from "../shared/atlas.ts";
import { ootPlaces } from "../host/oot-format.ts";
import { MapService } from "../host/service.ts";
import { defaultConfig } from "../host/config.ts";
import { mkdirSync } from "node:fs";

test("OoT Simple CRS coordinates match baked tile indices and source data is parsed as literals", () => {
  const polygon = [[[.25, -.125], [.5, -.125], [.5, -.375], [.25, -.375]]];
  const scenes = [{ id: 1, name: "Kakariko Village", childAngledCoords: polygon,
    rooms: [{ id: 2, name: "Windmill", childAngledCoords: polygon }] }];
  const places = ootPlaces(`throw new Error('must never execute');\nvar mapData = ${JSON.stringify(scenes)};\n`);
  expect(places).toHaveLength(2);
  expect(places[0]).toMatchObject({ x: 96, y: 64, space: "planar", room: false });
  expect(places[1]).toMatchObject({ id: "o_1_r2", name: "Windmill", detail: "Kakariko Village - Room 2", zoom: 7, room: true });
  // Upstream z15 and app z7 point at the same source pixels.
  expect(places[0].x * 2 ** 7).toBe(.375 * 2 ** 15);
  expect(places[0].y * 2 ** 7).toBe(.25 * 2 ** 15);
  expect(() => ootPlaces("var mapData = (() => [])();")).toThrow();
  expect(() => ootPlaces(`var mapData = ${JSON.stringify([{ ...scenes[0], childAngledCoords: [[[0, 0], [1, 1], [2, 2]]] }])};`)).toThrow("Degenerate");
});

test("three providers keep tiles, search, and saved-place retries scoped to their own source", async () => {
  const root = mkdtempSync(join(tmpdir(), "map-catalog-"));
  const ids = { hyrule: "123456789abcdef0", oot: "abcdef0123456789" };
  try {
    for (const kind of ["hyrule", "oot"] as const) {
      const path = join(root, kind); mkdirSync(path);
      const db = new Database(join(path, "atlas.sqlite")), maxZoom = kind === "oot" ? 3 : 7;
      db.exec(`CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT);
        CREATE TABLE tiles(z INTEGER,x INTEGER,y INTEGER,pixels BLOB,PRIMARY KEY(z,x,y));
        CREATE VIRTUAL TABLE place_search USING fts5(id UNINDEXED,name,detail,x UNINDEXED,y UNINDEXED,zoom UNINDEXED);`);
      const manifest = { format: ATLAS_FORMAT, tiles: atlasTileCount(maxZoom), info: {
        source: ids[kind], name: kind, attribution: "Fixture", kind, space: "planar", minZoom: 0, maxZoom, local: true } };
      expect(validAtlas(manifest)).toBe(true);
      expect(validAtlas({ ...manifest, tiles: manifest.tiles + 1 })).toBe(false);
      expect(validAtlas({ ...manifest, info: { ...manifest.info, maxZoom: 8 } })).toBe(false);
      db.query("INSERT INTO metadata VALUES ('manifest',?)").run(JSON.stringify(manifest));
      const pixels = new Uint8Array(131072).fill(kind === "oot" ? 17 : 29);
      db.query("INSERT INTO tiles VALUES (0,0,0,?)").run(deflateRawSync(pixels));
      db.query("INSERT INTO place_search VALUES (?,?,?,?,?,?)").run("village", "Kakariko Village", kind, kind === "oot" ? 70 : 150, 80, 3);
      db.close();
    }
    const service = new MapService({ ...defaultConfig, cache: ":memory:", kind: "oot", atlases: { hyrule: join(root, "hyrule"), oot: join(root, "oot") } }, () => { throw Error("Unexpected HTTP"); });
    try {
      const m = service.methods(), info = JSON.parse(m["map.info"]("{}"));
      expect(info.kind).toBe("oot"); expect(info.maps.map((v: any) => v.kind)).toEqual(["osm", "hyrule", "oot"]);
      for (const kind of ["hyrule", "oot"] as const) {
        const place = JSON.parse(await m["map.search"](JSON.stringify({ source: ids[kind], query: "Kakariko", space: "planar", x: 0, y: 0 })))[0];
        expect(place.detail).toBe(kind);
        const image = await m["map.tile"](JSON.stringify({ source: ids[kind], z: 0, x: 0, y: 0 }));
        expect(image.pixels[0]).toBe(kind === "oot" ? 17 : 29);
        const command = JSON.stringify({ source: ids[kind], kind: "save", op: "shared_retry_token", place });
        const receipt = m["bookmarks.command"](command);
        m["map.info"]('{"kind":"osm"}');
        expect(m["bookmarks.command"](command)).toBe(receipt);
        expect(JSON.parse(m["bookmarks.list"](JSON.stringify({ source: ids[kind], offset: 0 }))).total).toBe(1);
      }
      expect(() => m["map.tile"](JSON.stringify({ source: ids.oot, z: 4, x: 0, y: 0 }))).toThrow("Invalid atlas tile");
      expect(() => m["map.info"]('{"kind":"missing"}')).toThrow();
    } finally { service.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

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
