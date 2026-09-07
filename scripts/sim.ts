import { mkdirSync } from "node:fs";
import { createCanvas } from "@napi-rs/canvas";
import { createWasmUi } from "../runtime/hosts/web/wasm-ops.js";
import { NODE_TYPE, PROP, BTN } from "../runtime/contracts/spec/spec.ts";
import { encodePNG } from "../runtime/tests/png.ts";
import { dispatchOffload } from "../runtime/tools/offload-provider.ts";
import { MapProvider, defaultConfig } from "../host/provider.ts";
import { MapService } from "../host/service.ts";
import { AtlasProvider } from "../host/atlas.ts";
import type { MapModel } from "../app/model.ts";
import type { OffloadImage } from "../runtime/contracts/spec/offload.ts";
const live = process.argv.includes("--live");
const hyrule = process.argv.includes("--hyrule");
const fixture = createCanvas(256, 256), c = fixture.getContext("2d");
c.fillStyle = "#e8e5d7"; c.fillRect(0, 0, 256, 256); c.fillStyle = "#b3ced7"; c.fillRect(170, 0, 86, 256);
for (let x = 14; x < 170; x += 30) { c.fillStyle = "#fffdf4"; c.fillRect(x, 0, 5, 256); }
for (let y = 20; y < 256; y += 32) { c.fillStyle = "#fffdf4"; c.fillRect(0, y, 170, 5); }
c.fillStyle = "#b8cfa4"; c.fillRect(50, 70, 55, 48); c.fillStyle = "#5e705e"; c.font = "13px Arial"; c.fillText("Replay fixture", 30, 155);
const provider = hyrule ? new AtlasProvider(".local/hyrule") : new MapProvider({ ...defaultConfig, cache: live ? ".local/cache.sqlite" : ":memory:" }, live ? fetch : (async url => {
  if (String(url).includes("photon")) return new Response(JSON.stringify({ features: [
    { properties: { osm_type: "R", osm_id: 1, name: "San Francisco", city: "San Francisco", country: "United States", type: "city" }, geometry: { coordinates: [-122.4075, 37.7879] } },
    { properties: { osm_type: "N", osm_id: 2, name: "Museum of Modern Art", city: "San Francisco", type: "other" }, geometry: { coordinates: [-122.4007, 37.7859] } },
  ] }));
  return new Response(fixture.toBuffer("image/png"));
}) as typeof fetch);
const service = hyrule ? new MapService({ ...defaultConfig, cache: ":memory:", atlas: ".local/hyrule", kind: "hyrule" }, async () => new Response(fixture.toBuffer("image/png"))) : undefined;
const wasm = await createWasmUi(await Bun.file("runtime/hosts/web/pocketjs.wasm").arrayBuffer(), { width: 400, height: 480 });
const ops = wasm.ops;
ops.hitTestBoundsAuxiliary = (x, y) => ops.hitTestBounds!(x + 40, y + 240);
(ops as any).__viewport = { w: 400, h: 240 };
const auxiliary = ops.createNode(NODE_TYPE.view);
for (const [prop, n] of [[PROP.posType, 1], [PROP.insetL, 40], [PROP.insetT, 240], [PROP.width, 320], [PROP.height, 240]]) ops.setProp(auxiliary, prop, n);
ops.insertBefore(1, auxiliary, 0); ops.__auxiliarySurface = { root: auxiliary, w: 320, h: 240 };
const requests: string[] = [], replies: { at: number; raw: string }[] = [];
const images = new Map<number, OffloadImage>();
let tick = 0, token = 1, session = 1, uploads = 0, maxStaging = 0, maxPending = 0, maxResident = 0, withhold = false, loseCommandAck = false;
let replyDelay = 3;
let hit: number | undefined;
const checks: string[] = [], failures: string[] = [];
Object.assign(globalThis, { ui: ops, __pak: await Bun.file("runtime/dist/3ds/guest/pocketmap-main.pak").arrayBuffer(), __simHz: 60,
  offload: { session: () => session, submit: (raw: string) => { if (requests.length >= 8) return false; requests.push(raw); return true; },
    take: () => { const n = replies.findIndex(r => r.at <= tick && !withhold); return n < 0 ? undefined : replies.splice(n, 1)[0].raw; },
    uploadImage: (id: number) => {
      const image = images.get(id); if (!image || uploads >= 1) return -1; uploads++;
      const bytes = new Uint8Array(8 + image.pixels.length), view = new DataView(bytes.buffer);
      view.setUint16(0, image.width, true); view.setUint16(2, image.height, true); bytes[5] = 2; bytes.set(image.pixels, 8);
      return ops.uploadImgEntry!(bytes);
    },
    releaseImage: (id: number) => { images.delete(id); },
  },
});
(0, eval)(await Bun.file("runtime/dist/3ds/guest/pocketmap-main.js").text());
const s = (globalThis as any).__map as MapModel;
if (!s) throw new Error("Guest did not mount");
function check(value: unknown, text: string) { if (!value) { failures.push(text); throw new Error(text); } checks.push(text); }
async function frames(n: number, buttons = 0, touch?: [number, number], analog = 0x8080) {
  if (touch && hit === undefined) { wasm.render(); hit = ops.hitTestBounds!(touch[0] + 40, touch[1] + 240); }
  if (!touch) hit = undefined;
  for (let i = 0; i < n; i++) {
    tick++; uploads = 0;
    (globalThis as any).frame(buttons, analog, touch ? [touch[0] | touch[1] << 9] : [], touch ? [hit] : [], touch ? [1] : [], 0x8080);
    wasm.tick();
    const d = s.diagnostics(); maxPending = Math.max(maxPending, d.pending); maxResident = Math.max(maxResident, d.tiles.entries);
    while (requests.length && images.size < 8) {
      const raw = requests.shift()!;
      const request = JSON.parse(raw), result = await dispatchOffload(service?.methods() ?? provider.methods(), request);
      if (loseCommandAck && request.method === "bookmarks.command") {
        loseCommandAck = false; replies.push({ at: tick + 3, raw: JSON.stringify({ id: result.id, error: "Simulated lost acknowledgement" }) }); continue;
      }
      if (result.image) {
        const id = token++; images.set(id, result.image); maxStaging = Math.max(maxStaging, images.size);
        replies.push({ at: tick + replyDelay, raw: JSON.stringify({ id: result.id, image: { token: id, width: result.image.width, height: result.image.height } }) });
      } else replies.push({ at: tick + replyDelay, raw: JSON.stringify(result) });
    }
  }
}
async function tap(x: number, y: number) { await frames(1, 0, [x, y]); await frames(1); }
async function press(button: number) { await frames(1, button); await frames(1); }
mkdirSync("dist/qa", { recursive: true });
async function shot(name: string) { await Bun.write(`dist/qa/${hyrule ? "hyrule-" : live ? "live-" : "replay-"}${name}.png`, encodePNG(wasm.render().slice(), 400, 480)); }
await frames(3); await shot("loading"); await frames(75);
if (live && !s.front()!.tiles.every(t => s.frontView.state(t.input).status === "ready")) console.log(s.front()!.tiles.map(t => ({ input: t.input, state: s.frontView.state(t.input) })));
check(s.front()!.tiles.every(t => s.frontView.state(t.input).status === "ready"), "All visible tiles materialize through resource demand and native image tickets");
await shot("map");
await tap(30, 18); check(s.mode() === "search", "Search touch button opens local keyboard");
await shot("keyboard");
if (hyrule) {
  check(s.annotations.rows().length > 0, "Real indexed game markers materialize as bounded map labels");
  check(s.planar() && s.info()?.local, "Hyrule opens as a local finite atlas with its own home and zoom bounds");
  s.setQuery("Kakariko"); s.search(); await frames(40); await shot("results");
  check(s.places().some(p => p.name.includes("Kakariko")), "SQLite place search finds Kakariko without an HTTP request");
  s.go(); await frames(100); await shot("village");
  check(s.pin()?.space === "planar" && s.front()!.tiles.every(t => s.frontView.state(t.input).status === "ready"), "Search navigation places the pin in atlas coordinates and resolves the village tiles");
  s.camera.jump(128, 128, 0); await frames(100); await shot("overview");
  check(s.front()!.tiles.length === 1 && s.front()!.tiles[0].input.z === 0, "Minimum zoom covers the finite world without wrapping copies");
  s.camera.jump(128, 128, 4); await frames(100);
  const zoomPosition = s.camera.view();
  await frames(1, BTN.ZL | BTN.UP); await frames(20, BTN.ZL); await shot("zoom-rail");
  check(s.zoomHeld() && s.camera.view().zoom === 5 && s.camera.view().x === zoomPosition.x && s.camera.view().y === zoomPosition.y, "ZL owns Up/Down zoom without panning the map");
  check(s.lookAhead().some(t => t.input.z === 6), "Zoom in primes the next level through the shared resource collection");
  await frames(1); check(!s.zoomHeld(), "Releasing ZL dismisses its rail");
  const resume = s.camera.view(); await tap(180, 18);
  check(s.mode() === "sources", "Map header opens the live source chooser"); await shot("sources");
  await tap(130, 53 + s.maps().findIndex(m => m.kind === "osm") * 30); await frames(100);
  check(!s.planar() && s.front()!.tiles.every(t => t.input.source === s.info()!.source), "Hyrule switches to synthetic OSM without restarting the guest or daemon");
  await tap(180, 18); await tap(130, 53 + s.maps().findIndex(m => m.kind === "hyrule") * 30); await frames(100);
  check(s.planar() && s.camera.view().x === resume.x && s.camera.view().zoom === resume.zoom, "Switching back restores Hyrule coordinates and zoom");
  s.setMode("layers"); await frames(2); await shot("layers"); s.choose(2); await frames(100);
  check(s.annotations.layer() === "collectibles" && s.annotations.rows().every(m => m[2] !== "seed" && m[2] !== "treasure"), "Koroks and treasures remain hidden below their useful zoom range");
  s.annotations.setLayer("all");
  replyDelay = 30;
  s.camera.jump((32 * 256 - 300) / 64, (32 * 256 + 128) / 64, 6); await frames(180);
  const edge = { source: s.info()!.source, z: 6, x: 32, y: 32 };
  check(s.frontView.state(edge).status === "ready", "Local prefetch prepares a tile 100px beyond the edge with half-second response latency");
  s.camera.drag(-101, 0); await frames(1);
  check(s.front()!.tiles.some(t => t.input.x === 32 && t.input.y === 32) && s.frontView.state(edge).status === "ready", "Crossing the local atlas edge reveals the prefetched tile immediately");
  await frames(180, 0, undefined, 0x80ff); await frames(220);
  check(s.front()!.tiles.every(t => s.frontView.state(t.input).status === "ready"), "The local atlas catches up after sustained motion with delayed replies");
  check(s.lookAhead().length <= 12 && maxResident <= 40 && maxPending <= 4 && maxStaging <= 8, "Larger local prefetch stays within device request, staging and residency budgets");
  replyDelay = 30;
  s.camera.jump(128, 128, 6); await frames(120);
  for (let stroke = 0; stroke < 4; stroke++) {
    await frames(1, 0, [185, 95]);
    for (let n = 1; n <= 6; n++) await frames(1, 0, [185 - n * 10, 95 + n * 8]);
    await frames(30);
  }
  s.camera.stop(); await frames(12);
  const directionView = s.camera.view();
  check(s.lookAhead().length > 3 && s.lookAhead().every(t => t.input.z === 6 &&
    ((t.column + .5) * 256 / 64 - directionView.x) - ((t.row + .5) * 256 / 64 - directionView.y) > 0),
    "Repeated real touch strokes retain northeast-only look-ahead after lifting the stylus");
  replyDelay = 3; await frames(100); await shot("pan");
  check(images.size === 0, "Atlas navigation releases every consumed or cancelled image ticket");
} else if (live) {
  // One requested view and one explicit search. Stress replay never uses public tiles.
  s.setQuery("San Francisco"); s.search(); await frames(35); await shot("results");
  check(s.places().length > 0, "Live Photon search returned places");
} else {
  await tap(20, 50); check(s.query() === "q", "Resistive keyboard hit inserts immediately");
  s.setQuery("San Francisco"); await tap(263, 216); await frames(35);
  check(s.mode() === "results" && s.places().length === 2, "Explicit Find shows bounded search results"); await shot("results");
  await press(BTN.DOWN); check(s.selection() === 1, "D-pad selects a place on the non-touch display");
  await tap(263, 216); await frames(60); check(s.mode() === "map" && s.pin()?.name === "Museum of Modern Art", "Go centers the map on the selected result and adds a pin"); await shot("pin");
  const before = s.camera.view();
  await frames(1, 0, [140, 110]); await frames(1, 0, [155, 123]); await frames(1, 0, [173, 140]); await frames(1);
  const released = s.camera.view(); await frames(10);
  check(released.x < before.x && s.camera.view().x < released.x, "Touchpad follows stylus immediately and continues with inertia");
  s.camera.stop(); const zoomBefore = s.camera.view().zoom;
  await tap(287, 73); await frames(32); check(s.camera.view().zoom > zoomBefore + 0.99, "Zoom control changes scale through a smooth local transition"); await frames(50); await shot("zoom");
  withhold = true; const position = s.camera.view().y;
  await frames(180, 0, undefined, 0x80ff);
  check(s.camera.view().y > position, "Sustained Circle Pad pan continues while all replies are withheld");
  withhold = false; session = -1; await frames(12); await shot("disconnected"); session = 2; await frames(130);
  check(s.online() && s.front()!.tiles.every(t => s.frontView.state(t.input).status === "ready"), "Reconnect fences old responses and refills the current viewport");
  s.camera.jump(255.999, 128, 8); await frames(60); await frames(160, 0, undefined, 0xff80); await frames(100);
  check(s.camera.view().x >= 0 && s.camera.view().x < 256, "Date-line navigation keeps coordinates and tile demand bounded");
  await frames(1, BTN.LTRIGGER); await shot("places-menu"); await frames(1);
  await frames(1, BTN.RTRIGGER); await shot("map-menu"); await frames(1);
  console.log({ maxPending, maxResident, maxStaging });
  check(maxPending <= 4 && maxResident <= 40 && maxStaging <= 8, "Request credit, texture residency and staging remain within their independent budgets");
  await frames(100); check(images.size === 0, "Consumed and cancelled image staging is released after churn");
  await tap(155, 216); check(s.mode() === "name", "Save view opens a separate local naming keyboard");
  await shot("save-name"); await tap(40, 216); await tap(20, 50); check(s.saved.name() === "q", "Naming input updates locally without a host round trip");
  s.saved.changeName("My coffee stop"); loseCommandAck = true;
  await tap(240, 216); await frames(20);
  check(!!s.saved.error() && provider.bookmarks.list(0).total === 1, "A lost save acknowledgement leaves a visible retry state after the Mac commits");
  await tap(240, 216); await frames(35);
  check(s.mode() === "saved" && s.saved.page()?.total === 1 && provider.bookmarks.list(0).total === 1, "Retry confirms the same save without duplicating user data"); await shot("saved");
  await tap(50, 216); check(s.mode() === "name" && !!s.saved.editing(), "Rename starts from the selected saved place");
  s.saved.changeName("Morning coffee"); await tap(240, 216); await frames(35);
  check(s.saved.selected()?.name === "Morning coffee", "Rename updates the saved list after persistence");
  const savedPoint = s.saved.selected()!; await tap(263, 216); await frames(35);
  check(s.mode() === "map" && s.pin()?.id === savedPoint.id, "Go to saved place restores coordinates, zoom and pin");
  await tap(263, 216); await frames(35); await tap(155, 216); await frames(16); await shot("delete");
  check(!!s.saved.deleting() && s.saved.modal(), "Delete opens the animated modal confirmation");
  await press(BTN.CROSS); await frames(15); check(provider.bookmarks.list(0).total === 1 && !s.saved.modal(), "B cancels deletion and keeps the place");
  for (let n = 0; n < 5; n++) provider.bookmarks.command({ op: `replay_place_000${n}`, kind: "save", place: { ...savedPoint, name: `Place ${n}` } });
  s.saved.refresh(); await frames(35); await tap(286, 152); await frames(35);
  check(s.saved.page()?.offset === 5 && s.saved.selected()?.name === "Morning coffee", "Saved places paginate through the same right-hand control rail");
  await tap(155, 216); await frames(16); await tap(150, 180); await frames(35);
  check(s.saved.page()?.offset === 0 && s.saved.page()?.total === 5 && !s.saved.modal(), "Deleting the last row of a page returns to a populated page");
  await tap(30, 18); await frames(50);
  const oldTiles = s.front()!.tiles;
  s.camera.stop(); s.camera.drag(256, 0); await frames(1);
  const overlapping = s.front()!.tiles.filter(t => oldTiles.some(o => o.column === t.column && o.row === t.row));
  check(overlapping.length > 0 && overlapping.every(t => oldTiles.includes(t)), "Crossing a tile column retains existing component identities");
  await frames(40);
  s.camera.jump(128, 128, 8); await frames(80);
  const ahead = s.lookAhead(); check(ahead.length > 0 && ahead.length <= 4 && ahead.every(t => s.frontView.state(t.input).status === "ready"), "Modest look-ahead materializes no more than four adjacent tiles");
  if (ahead.length) {
    const t = ahead[0], scale = 2 ** t.input.z;
    s.camera.jump((t.column + 0.5) * 256 / scale, (t.row + 0.5) * 256 / scale, t.input.z); await frames(1);
    check(s.frontView.state(t.input).status === "ready", "Entering a prefetched tile reveals its resident texture without waiting for the network");
    await frames(50);
  }
}
const receipt = { mode: hyrule ? "complete local Hyrule atlas, compiled guest + Wasm" : live ? "live OSM DE / Photon, compiled guest + Wasm" : "deterministic synthetic provider, compiled guest + Wasm", frames: tick, checks, maxPending, maxResident, maxStaging, ...(service ? service.diagnostics() : provider.diagnostics()),
  hardwareAcceptance: "pending", performance: "Replay validates behavior and budgets, not device frame time" };
await Bun.write(`dist/qa/${hyrule ? "hyrule" : live ? "live" : "replay"}.json`, JSON.stringify(receipt, null, 2)); console.log(receipt); service?.close(); provider.close();
