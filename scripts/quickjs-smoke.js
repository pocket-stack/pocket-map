// QuickJS execution/stack check with host stubs. Pixels are covered by sim.ts.
let node = 3, texture = 1, session = -1, ticks = 0, token = 1;
const replies = [], tickets = new Set(), saved = [];
globalThis.ui = { __host: "3ds-dev", __hostAbi: 8, __viewport: { w: 400, h: 240 }, __auxiliarySurface: { root: 2, w: 320, h: 240 },
  __textures: { "shift.svg": 0, "shift-lock.svg": 1, "map-pad.svg": 2, "map-pin.svg": 3 }, __sprites: {}, createNode: () => node++, measureText: text => text.length * 7 };
for (const name of ["destroyNode", "insertBefore", "removeChild", "setStyle", "setProp", "setPropBatch", "setText", "replaceText", "uploadTexture", "setImage", "setSprite", "animate", "cancelAnim", "setFocus", "setActive", "hitTest", "hitTestBounds", "hitTestAuxiliary", "hitTestBoundsAuxiliary", "setCursor", "setCursorPos", "loadStyles", "loadFontAtlas", "loadTileTexture", "freeTexture", "uploadImgEntry", "debugInspect", "debugRectXY", "debugRectWH", "debugPause", "debugStep", "debugStats", "__dbgActive", "__dbgPoll", "__dbgSend", "__dbgShot"]) ui[name] = () => 0;
globalThis.offload = {
  session: () => session, take: () => replies.shift(),
  uploadImage: id => tickets.has(id) ? texture++ : -1, releaseImage: id => tickets.delete(id),
  submit(raw) {
    const r = JSON.parse(raw);
    if (r.response === "image") { const id = token++; tickets.add(id); replies.push(JSON.stringify({ id: r.id, image: { token: id, width: 256, height: r.method === "map.label" ? 32 : 256 } })); }
    else {
      let value;
      if (r.method === "bookmarks.list") value = { items: saved, offset: 0, total: saved.length };
      else if (r.method === "bookmarks.command") {
        const c = JSON.parse(r.payload), id = "b_0123456789abcdef01234567";
        if (c.kind === "save") saved.push({ ...c.place, id });
        else if (c.kind === "rename") saved[0].name = c.name;
        else saved.length = 0;
        value = { id };
      } else value = r.method === "map.info" ? { source: "0123456789abcdef", name: "Smoke map", attribution: "Test", maxZoom: 18 } : [{ id: "one", name: "Tokyo", detail: "Japan", lat: 35.68, lon: 139.76, zoom: 14 }];
      replies.push(JSON.stringify({ id: r.id, payload: JSON.stringify(value) }));
    }
    return true;
  },
};
globalThis.__simHz = 60;
function frames(n, buttons = 0, analog = 0x8080) { for (let i = 0; i < n; i++) { frame(buttons, analog, [], [], [], 0x8080); ticks++; } }
function check(value, message) { if (!value) throw new Error(message); }
try {
  std.loadScript(scriptArgs[1] || "runtime/dist/3ds/guest/pocketmap-main.js");
  const s = globalThis.__map; frames(30); check(s.mode() === "map", "offline mount");
  session = 1; frames(90); check(s.front().tiles.every(t => s.frontView.state(t.input).status === "ready"), "tile reveal");
  frames(300, 0, 0x80ff); s.zoom(1); frames(90); s.zoom(-1); frames(90);
  s.openSearch(); s.key("t"); check(s.query() === "t", "local typing"); s.search(); frames(60); check(s.places().length === 1, "search");
  s.go(); frames(90); check(s.pin().name === "Tokyo", "place navigation");
  s.saveCurrent(); check(s.mode() === "name", "save naming mount"); s.saved.changeName("Saved in QuickJS"); s.key("GO"); frames(60);
  check(s.mode() === "saved" && s.saved.page().total === 1, "saved list mount");
  s.saved.begin(s.saved.selected(), true); s.saved.changeName("Renamed"); s.key("GO"); frames(60);
  check(s.saved.selected().name === "Renamed", "rename mount");
  s.saved.askRemove(); frames(20); s.saved.remove(); frames(60); check(s.saved.page().total === 0, "delete sheet lifecycle"); s.dismiss();
  frames(1, 0x100); frames(1); frames(1, 0x200); frames(1);
  session = -1; frames(30); session = 2; frames(100);
  check(s.diagnostics().tiles.entries <= 40 && tickets.size === 0, "resource ownership");
  std.puts(JSON.stringify({ ok: true, frames: ticks, nodeIds: node, uploads: texture, pendingTickets: tickets.size }) + "\n");
} catch (error) { std.puts(String(error) + "\n" + error.stack + "\n"); std.exit(1); }
