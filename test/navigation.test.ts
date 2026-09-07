import { expect, test } from "bun:test";
import { createRoot } from "solid-js";
import { createTileCamera } from "@pocketjs/framework/tile-viewport";
import { createMapPrediction } from "../app/prediction.ts";
import { createMap } from "../app/model.ts";
import { createOffloadClient } from "@pocketjs/framework/offload";
import { runFrameHooks, resetFrameHooks } from "../runtime/framework/src/frame.ts";
import { BTN } from "@pocketjs/framework/input";
import { Database } from "bun:sqlite";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareMarkers, MarkerIndex } from "../host/markers.ts";
import { MapService } from "../host/service.ts";
import { ATLAS_FORMAT } from "../host/atlas.ts";
import { defaultConfig } from "../host/config.ts";
import type { MapInfo } from "../shared/types.ts";
const atlas: MapInfo = { source: "123456789abcdef0", name: "Hyrule", attribution: "Test", kind: "hyrule", space: "planar", local: true, minZoom: 0, maxZoom: 7,
  home: { id: "home", name: "Plateau", detail: "", space: "planar", x: 128, y: 128, zoom: 4 }, maps: [{ kind: "hyrule", name: "Hyrule" }, { kind: "osm", name: "OSM" }] };
const osm: MapInfo = { source: "abcdef0123456789", name: "OSM", attribution: "Test", kind: "osm", maxZoom: 18, maps: atlas.maps };
test("repeated diagonal strokes keep their forward corridor across lifts; zoom predicts only one next local level", () => {
  const c = createTileCamera({ width: 400, height: 240, x: 128, y: 128, zoom: 4, minZoom: 0, maxZoom: 7 });
  const p = createMapPrediction(); p.reset(c.view());
  for (let stroke = 0; stroke < 4; stroke++) {
    c.beginDrag(); for (let n = 0; n < 20; n++) { c.drag(-3, 3); p.sample(c.view(), 1 / 60, false); }
    c.endDrag(0, 0); for (let n = 0; n < 40; n++) p.sample(c.view(), 1 / 60, false);
  }
  let plan = p.plan(c.view(), 4, atlas);
  expect(plan.intent.x).toBeGreaterThan(350); expect(plan.intent.y).toBeLessThan(-350);
  expect(plan.extra.length).toBeGreaterThan(4); expect(plan.extra.length).toBeLessThanOrEqual(12);
  expect(plan.extra.every(t => ((t.column + .5) * 256 / 16 - c.view().x) * plan.intent.x + ((t.row + .5) * 256 / 16 - c.view().y) * plan.intent.y > 0)).toBe(true);
  c.zoomBy(1); p.zoom(1); for (let n = 0; n < 60; n++) { c.step(1 / 60); p.sample(c.view(), 1 / 60, false); }
  plan = p.plan(c.view(), 5, atlas); expect(plan.extra.some(t => t.input.z === 6)).toBe(true);
  expect(plan.extra.every(t => t.input.z === 5 || t.input.z === 6)).toBe(true);
  expect(p.plan(c.view(), 5, osm).extra.every(t => t.input.z === 5)).toBe(true);
  expect(p.plan(c.view(), 5, osm).extra.length).toBeLessThanOrEqual(4);
  p.zoom(-1); expect(p.plan(c.view(), 5, atlas).extra.every(t => t.input.z === 5)).toBe(true);
  p.zoom(1); for (let n = 0; n < 301; n++) p.sample(c.view(), 1 / 60, false);
  expect(p.plan(c.view(), 5, atlas).extra.every(t => t.input.z === 5)).toBe(true);
});
test("ZL chord owns the D-pad; source changes fence old reads and restore each camera", () => {
  resetFrameHooks();
  createRoot(dispose => {
    const replies: string[] = [], sent: any[] = []; let withheld = false;
    const io = createOffloadClient({ session: () => 1, submit(raw) {
      const r = JSON.parse(raw), payload = JSON.parse(r.payload); sent.push({ ...r, payload });
      if (r.method === "map.info") replies.push(JSON.stringify({ id: r.id, payload: JSON.stringify(payload.kind === "osm" ? osm : atlas) }));
      else if (!withheld) replies.push(JSON.stringify({ id: r.id, error: "Fixture has no images" }));
      return true;
    }, take: () => replies.shift(), uploadImage: () => 1, releaseImage() {} });
    const s = createMap(io), frames = (n: number, buttons = 0) => { for (let i = 0; i < n; i++) { runFrameHooks(buttons); io.step(); } };
    frames(10); expect(s.planar()).toBe(true);
    const at = s.camera.view(); frames(1, BTN.ZL | BTN.UP); frames(20, BTN.ZL);
    expect(s.zoomHeld()).toBe(true); expect(s.camera.view().zoom).toBe(5);
    expect(s.camera.view().x).toBe(at.x); expect(s.camera.view().y).toBe(at.y);
    frames(1); expect(s.zoomHeld()).toBe(false);
    frames(1, BTN.ZL | BTN.DOWN); frames(50, BTN.ZL | BTN.DOWN); frames(20);
    expect(s.camera.view().zoom).toBeLessThan(4);
    s.camera.jump(100, 130, 5); withheld = true; frames(4);
    s.switchMap("osm"); frames(10); expect(s.info()?.kind).toBe("osm"); expect(s.planar()).toBe(false);
    expect(s.lookAhead().every(t => t.input.source === osm.source)).toBe(true);
    s.camera.jump(200, 100, 12); s.switchMap("hyrule"); frames(10);
    expect(s.camera.view()).toMatchObject({ x: 100, y: 130, zoom: 5 });
    expect(s.submitted()).toBeUndefined(); expect(s.pin()).toBeUndefined();
    s.saveCurrent(); s.saved.changeName("Home"); s.saved.submit(); frames(1);
    const command = sent.findLast(r => r.method === "bookmarks.command"); expect(command.payload.source).toBe(atlas.source);
    s.switchMap("osm"); expect(s.info()?.kind).toBe("hyrule"); // In-flight write owns its source.
    dispose(); io.dispose();
  }); resetFrameHooks();
});
test("marker index filters zoom/category and bounds replies; delayed bookmarks retain their original source", async () => {
  const dir = mkdtempSync(join(tmpdir(), "map-navigation-")); mkdirSync(join(dir, "markers"));
  try {
    const group = (name: string, count: number) => [{ name, layers: [{ markers: Array.from({ length: count }, (_, n) => ({ id: n, name: name + n, coords: [-n * 35, n * 45] })) }] }];
    for (const [file, groups] of [["locations", group("Landmark", 40)], ["pins", group("Shrine", 40)], ["seeds", group("Central", 40)], ["treasures", group("Gems", 40)]] as const) await Bun.write(join(dir, `markers/${file}.json`), JSON.stringify(groups));
    expect(await prepareMarkers(dir, dir)).toBe(160);
    const index = new MarkerIndex(join(dir, "markers.sqlite"));
    const all = index.query({ source: atlas.source, z: 6, x: 16, y: 16, layer: "all" });
    expect(all.length).toBeGreaterThan(0); expect(all.length).toBeLessThanOrEqual(12); expect(JSON.stringify(all).length).toBeLessThan(2500);
    expect(index.query({ source: atlas.source, z: 6, x: 16, y: 16, layer: "collectibles" }).every(m => m[2] === "seed" || m[2] === "treasure")).toBe(true);
    expect(index.query({ source: atlas.source, z: 2, x: 1, y: 1, layer: "collectibles" })).toEqual([]);
    expect(index.query({ source: atlas.source, z: 6, x: 16, y: 16, layer: "off" })).toEqual([]);
    expect(() => index.query({ source: atlas.source, z: 6, x: 32, y: 0, layer: "all" })).toThrow(); index.close();
    const db = new Database(join(dir, "atlas.sqlite")); db.exec("CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT)");
    db.query("INSERT INTO metadata VALUES ('manifest',?)").run(JSON.stringify({ format: ATLAS_FORMAT, tiles: 21845, info: atlas })); db.close();
    const service = new MapService({ ...defaultConfig, format: "raster", tileURL:"https://tile.openstreetmap.de/{z}/{x}/{y}.png", cache: ":memory:", atlas: dir, kind: "hyrule" }, () => { throw new Error("Network must not run"); });
    try {
      const methods = service.methods(), before = JSON.parse(methods["map.info"]('{}'));
      const command = JSON.stringify({ source: before.source, op: "source_saved_1", kind: "save", place: atlas.home });
      const receipt = methods["bookmarks.command"](command);
      const other = JSON.parse(methods["map.info"]('{"kind":"osm"}'));
      expect(other.kind).toBe("osm"); expect(methods["bookmarks.command"](command)).toBe(receipt);
      expect(JSON.parse(methods["bookmarks.list"](JSON.stringify({ source: other.source, offset: 0 }))).total).toBe(0);
      expect(JSON.parse(methods["bookmarks.list"](JSON.stringify({ source: before.source, offset: 0 }))).total).toBe(1);
      expect(() => methods["bookmarks.command"](JSON.stringify({ ...JSON.parse(command), source: "wrong" }))).toThrow();
    } finally { service.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
