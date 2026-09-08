// QuickJS execution/stack check with host stubs. Pixels are covered by sim.ts.
let node = 3, texture = 1, session = -1, ticks = 0, token = 1;
let currentHyrule; const hyrule = scriptArgs[2] === "hyrule";
const replies = [], tickets = new Set(), saved = [];
globalThis.ui = { __host: "3ds-dev", __hostAbi: 8, __viewport: { w: 400, h: 240 }, __auxiliarySurface: { root: 2, w: 320, h: 240 },
  __textures: { "shift.svg": 0, "shift-lock.svg": 1, "map-pad.svg": 2, "map-pin.svg": 3 }, __sprites: {}, createNode: () => node++, measureText: text => text.length * 7 };
for (const name of ["landmark", "tower", "shrine", "stable", "village", "seed", "treasure", "enemy", "special"]) ui.__textures[`marker-${name}.svg`] = 4 + Object.keys(ui.__textures).length;
for (const name of ["destroyNode", "insertBefore", "removeChild", "setStyle", "setProp", "setPropBatch", "setText", "replaceText", "uploadTexture", "setImage", "setMesh", "freeMesh", "setSprite", "animate", "cancelAnim", "setFocus", "setActive", "hitTest", "hitTestBounds", "hitTestAuxiliary", "hitTestBoundsAuxiliary", "setCursor", "setCursorPos", "loadStyles", "loadFontAtlas", "loadTileTexture", "freeTexture", "uploadImgEntry", "debugInspect", "debugRectXY", "debugRectWH", "debugPause", "debugStep", "debugStats", "__dbgActive", "__dbgPoll", "__dbgSend", "__dbgShot"]) ui[name] = () => 0;
globalThis.offload = {
  session: () => session, take: () => replies.shift(),
  uploadMesh: id => tickets.has(id) ? texture++ : -1, releaseMesh: id => tickets.delete(id),
  uploadImage: id => tickets.has(id) ? texture++ : -1, releaseImage: id => tickets.delete(id),
  submit(raw) {
    const r = JSON.parse(raw);
    if (r.response === "mesh") { const id=token++;tickets.add(id);replies.push(JSON.stringify({id:r.id,mesh:{token:id,width:256,height:256,bytes:16}})); }
    else if (r.response === "image") { const id = token++; tickets.add(id); replies.push(JSON.stringify({ id: r.id, image: { token: id, width: 256, height: r.method === "map.label" ? 32 : 256 } })); }
    else {
      let value;
      if (r.method === "map.info") currentHyrule = JSON.parse(r.payload).kind ? JSON.parse(r.payload).kind === "hyrule" : hyrule;
      if (r.method === "bookmarks.list") value = { items: saved, offset: 0, total: saved.length };
      else if (r.method === "bookmarks.command") {
        const c = JSON.parse(r.payload), id = "b_0123456789abcdef01234567";
        if (c.kind === "save") saved.push({ ...c.place, id });
        else if (c.kind === "rename") saved[0].name = c.name;
        else saved.length = 0;
        value = { id };
      } else if (r.method === "map.markers") value = [[1, "Sheikah Tower", "tower", 108, 168], [2, "Shrine of Resurrection", "shrine", 108.5, 168.5]];
      else value = r.method === "map.info" ? { source: currentHyrule ? "0123456789abcdef" : "abcdef0123456789", kind: currentHyrule ? "hyrule" : "osm", markers: true, maps: [{ kind: "hyrule", name: "Hyrule" }, { kind: "osm", name: "OSM" }], name: "Smoke map", attribution: "Test", maxZoom: currentHyrule ? 7 : 18,
        ...(currentHyrule ? { minZoom: 0, space: "planar", local: true, home: { id: "home", name: "Plateau", detail: "Test", space: "planar", x: 108, y: 168, zoom: 4 } } : {render:"mesh",dataZoom:14}) }
        : [hyrule ? { id: "one", name: "Kakariko", detail: "Hyrule", space: "planar", x: 166, y: 149, zoom: 6 } : { id: "one", name: "Tokyo", detail: "Japan", lat: 35.68, lon: 139.76, zoom: 14 }];
      replies.push(JSON.stringify({ id: r.id, payload: JSON.stringify(value) }));
    }
    return true;
  },
};
globalThis.__simHz = 60;
function frames(n, buttons = 0, analog = 0x8080, elapsedUs) { for (let i = 0; i < n; i++) { frame(buttons, analog, [], [], [], 0x8080, elapsedUs); ticks++; } }
function check(value, message) { if (!value) throw new Error(message); }
try {
  std.loadScript(scriptArgs[1] || "runtime/dist/3ds/guest/pocketmap-main.js");
  const s = globalThis.__map; frames(30); check(s.mode() === "map", "offline mount");
  session = 1; frames(90); check(s.front().tiles.every(t => s.frontView.state(t.input).status === "ready"), "tile reveal");
  const center = s.camera.view(), motion = [];
  for (const cadence of [Array(60).fill(16667), Array(30).fill(33333), Array.from({ length: 30 }, (_, i) => [16667, 33333, 50000][i % 3])]) {
    s.camera.jump(center.x, center.y, center.zoom);
    frames(60, 0, 0xff80, 16667); const start = s.camera.view();
    for (const us of cadence) frames(1, 0, 0xff80, us);
    motion.push((s.camera.view().x - start.x) * start.scale);
  }
  std.puts(JSON.stringify({ motionPixelsPerSecond: motion }) + "\n");
  check(motion.every(px => Math.abs(px - 320) < .02), "held stick speed depends on presentation cadence");
  s.camera.jump(center.x, center.y, center.zoom);
  frames(300, 0, 0x80ff); s.zoom(1); frames(90); s.zoom(-1); frames(90);
  s.openSearch(); s.key("t"); check(s.query() === "t", "local typing"); s.search(); frames(60); check(s.places().length === 1, "search");
  s.go(); frames(90); check(s.pin().name === (hyrule ? "Kakariko" : "Tokyo"), "place navigation");
  s.saveCurrent(); check(s.mode() === "name", "save naming mount"); s.saved.changeName("Saved in QuickJS"); s.key("GO"); frames(60);
  check(s.mode() === "saved" && s.saved.page().total === 1, "saved list mount");
  s.saved.begin(s.saved.selected(), true); s.saved.changeName("Renamed"); s.key("GO"); frames(60);
  check(s.saved.selected().name === "Renamed", "rename mount");
  s.saved.askRemove(); frames(20); s.saved.remove(); frames(60); check(s.saved.page().total === 0, "delete sheet lifecycle"); s.dismiss();
  frames(1, 0x100); frames(1); frames(1, 0x200); frames(1);
  frames(1, 0x400); frames(1, 0x400 | 0x10); frames(20, 0x400); check(s.zoomHeld(), "ZL rail mount"); frames(1);
  s.openSources(); frames(2); check(s.mode() === "sources", "source picker mount"); s.choose(hyrule ? 1 : 0); frames(80);
  check(s.planar() !== hyrule, "hot source switch"); s.openSources(); s.choose(hyrule ? 0 : 1); frames(80);
  s.setMode("layers"); frames(2); s.choose(s.vector()?1:4); frames(1); check(s.annotations.layer() === "off", "label filter mount");
  session = -1; frames(30); session = 2; frames(100);
  check(s.diagnostics().tiles.entries <= 40 && tickets.size === 0, "resource ownership");
  std.puts(JSON.stringify({ ok: true, frames: ticks, nodeIds: node, uploads: texture, pendingTickets: tickets.size }) + "\n");
} catch (error) { std.puts(String(error) + "\n" + error.stack + "\n"); std.exit(1); }
