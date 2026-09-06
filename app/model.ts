import { createSignal, createMemo } from "solid-js";
import { createResourceRuntime, createResourceView } from "@pocketjs/framework/resource-view";
import { createOffloadImageCollection, offloadResource } from "@pocketjs/framework/resource-offload";
import { createTileCamera, planTileWindow } from "@pocketjs/framework/tile-viewport";
import { offload } from "@pocketjs/framework/offload";
import { analogX, analogY, onFrame, onButtonPress } from "@pocketjs/framework/lifecycle";
import { BTN } from "@pocketjs/framework/input";
import { simulationHz, virtualNow } from "@pocketjs/framework/clock";
import { project, unproject, wrapTile } from "./geo.ts";
import { createSavedPlaces, validPlaces, type MapMode } from "./saved.ts";
import { HOME, type TileInput, type MapInfo, type SearchInput, type Place } from "../shared/types.ts";

export interface DrawTile { input: TileInput; column: number; row: number; priority: number }
export interface Layer { level: number; tiles: DrawTile[]; originX: number; originY: number }
export const MENU = {
  places: ["Search places", "Saved places", "Save map center", "Back to pin", "San Francisco"],
  map: ["Zoom in", "Zoom out", "Clear pin", "Retry tiles", "About & controls"],
};
export function createMap(io = offload()) {
  const [info, setInfo] = createSignal<MapInfo>();
  const [online, setOnline] = createSignal(false), [status, setStatus] = createSignal("Waiting for paired Mac");
  const [mode, setMode] = createSignal<MapMode>("map");
  const [query, setQuery] = createSignal(""), [submitted, setSubmitted] = createSignal<SearchInput>();
  const [selection, setSelection] = createSignal(0), [pin, setPin] = createSignal<Place>();
  const [menu, setMenu] = createSignal<"places" | "map">(), [menuIndex, setMenuIndex] = createSignal(0);
  const [shift, setShift] = createSignal<"off" | "once" | "locked">("off"), [symbols, setSymbols] = createSignal(false);
  const [front, setFront] = createSignal<Layer>(), [back, setBack] = createSignal<Layer>();
  const p = project(HOME.lat, HOME.lon);
  const camera = createTileCamera({ width: 400, height: 240, x: p.x, y: p.y, zoom: HOME.zoom, minZoom: 1, maxZoom: 18, bounds: { width: 256, height: 256, wrapX: true } });
  const runtime = createResourceRuntime({ maxConcurrent: 3, startsPerFrame: 1, completionsPerFrame: 1, maxCollections: 4, available: () => io.connected() && !!info() && io.pending() < 3 });
  const tiles = createOffloadImageCollection(runtime, io, { key: (i: TileInput) => `${i.source}/${i.z}/${i.x}/${i.y}`, method: "map.tile", payload: JSON.stringify,
    width: 256, height: 256, maxEntries: 40, maxViews: 2, maxDemandsPerView: 16, retry: { attempts: 3, delayFrames: 90, maxDelayFrames: 360 } });
  const labels = createOffloadImageCollection(runtime, io, { key: (i: Place) => `${i.name}/${i.detail}`, method: "map.label", payload: i => JSON.stringify({ name: i.name, detail: i.detail }),
    width: 256, height: 32, maxEntries: 5, maxViews: 5, maxDemandsPerView: 1 });
  const [lookAhead, setLookAhead] = createSignal<DrawTile[]>([]);
  const frontView = createResourceView(tiles, { demand: () => [...(front()?.tiles.map(t => ({ input: t.input, priority: t.priority, pin: true })) ?? []), ...lookAhead().map(t => ({ input: t.input, priority: 1000 + t.priority, pin: false }))] });
  const backView = createResourceView(tiles, { demand: () => back()?.tiles.map(t => ({ input: t.input, priority: 100, pin: true })) ?? [] });
  const searches = runtime.createCollection({ key: (i: SearchInput) => JSON.stringify(i), maxEntries: 4, maxViews: 1, maxDemandsPerView: 1,
    maxCost: 4 * 8192, cost: () => 8192, maxResponseBytes: 5000, retry: { attempts: 1, delayFrames: 60, maxDelayFrames: 60 },
    load: offloadResource<SearchInput>(io, "map.search", JSON.stringify), materialize(raw: string): Place[] {
      const rows = JSON.parse(raw);
      if (!validPlaces(rows)) throw new Error("Invalid places response");
      return rows;
    },
  });
  const results = createResourceView(searches, { demand: () => submitted() ? [{ input: submitted()!, priority: -10, pin: true }] : [] });
  const places = createMemo(() => submitted() ? results.value(submitted()!) ?? [] : []);
  const saved = createSavedPlaces(io, runtime, mode, setMode);
  const typing = () => mode() === "search" || mode() === "name";
  const listing = () => mode() === "results" || mode() === "saved";
  const rows = () => mode() === "saved" ? saved.page()?.items ?? [] : places();
  const selectedIndex = () => mode() === "saved" ? saved.selection() : selection();
  function select(index: number) { const n = Math.max(0, Math.min(rows().length - 1, index)); if (mode() === "saved") saved.setSelection(n); else setSelection(n); }
  let previousView = camera.view();
  let frame = 0, previousSession = 0, infoRequest = 0, retryAt = 0, shiftAt = -10, levelAge = 0, candidateLevel = HOME.zoom;
  let confirmed = false;
  function search() {
    const text = query().trim(); if (!text) return;
    const pos = unproject(camera.view().x, camera.view().y);
    const next = { query: text, lat: Math.round(pos.lat * 10) / 10, lon: Math.round(pos.lon * 10) / 10 };
    searches.invalidate(i => JSON.stringify(i) === JSON.stringify(next));
    setSubmitted(next); setSelection(0); setMode("results"); camera.stop();
  }
  function openSearch() { if (saved.busy() || saved.modal() || mode() === "name") return; camera.stop(); setMode("search"); setMenu(undefined); }
  function go(place = rows()[selectedIndex()]) {
    if (!place) return;
    const pos = project(place.lat, place.lon); camera.jump(pos.x, pos.y, Math.min(info()?.maxZoom ?? 18, place.zoom));
    setPin(place); setMode("map"); setMenu(undefined);
  }
  function home(name: string, lat: number, lon: number) { go({ id: name, name, detail: "", lat, lon, zoom: 14 }); }
  function zoom(delta: number) {
    if (delta > 0 && camera.view().zoom >= (info()?.maxZoom ?? 18)) return;
    camera.zoomBy(delta);
  }
  function key(value: string) {
    if (!typing() || saved.busy()) return;
    const change = (fn: (value: string) => string) => mode() === "name" ? saved.changeName(fn(saved.name())) : setQuery(fn);
    if (value === "DEL") change(q => q.slice(0, -1));
    else if (value === "SPACE") change(q => q.length < 80 ? q + " " : q);
    else if (value === "GO") mode() === "name" ? saved.submit() : search();
    else if (value === "SHIFT") {
      const now = virtualNow(); setShift(s => s === "locked" ? "off" : now - shiftAt < 0.35 ? "locked" : s === "off" ? "once" : "off"); shiftAt = now;
    } else if (value === "123") setSymbols(s => !s);
    else if (value.length === 1) { change(q => q.length < 80 ? q + (shift() !== "off" ? value.toUpperCase() : value) : q); if (shift() === "once") setShift("off"); }
  }
  function saveCurrent() {
    camera.stop();
    if (mode() === "results") { const selected = places()[selection()]; if (selected) { const p = project(selected.lat, selected.lon); camera.jump(p.x, p.y, selected.zoom); setPin(selected); saved.begin(selected); } return; }
    const view = camera.view(), pos = unproject(view.x, view.y), selected = pin();
    const target = selected && project(selected.lat, selected.lon);
    let dx = target ? target.x - view.x : Infinity; dx -= Math.round(dx / 256) * 256;
    saved.begin(target && Math.hypot(dx, target.y - view.y) * view.scale < 12 ? selected! : { id: "center", name: "Map center", detail: `${pos.lat.toFixed(5)}, ${pos.lon.toFixed(5)}`, ...pos, zoom: Math.round(view.zoom) });
  }
  function dismiss() { if (saved.busy()) return; if (mode() === "name") { saved.cancelName(); return; } setMenu(undefined); setMode("map"); camera.stop(); }
  function runMenu() {
    const i = menuIndex(), bank = menu(); setMenu(undefined); confirmed = true;
    if (bank === "places") {
      if (i === 0) openSearch(); else if (i === 1) saved.open(); else if (i === 2) saveCurrent(); else if (i === 3) go(pin()); else home("San Francisco", HOME.lat, HOME.lon);
    } else if (bank === "map") {
      if (i < 2) zoom(i === 0 ? 1 : -1); else if (i === 2) setPin(undefined); else if (i === 3) tiles.invalidate(); else setMode("about");
    }
  }
  onButtonPress(BTN.CIRCLE, () => { if (saved.modal() || saved.busy()) return; if (menu()) runMenu(); else if (typing()) key("GO"); else if (listing()) go(); });
  onButtonPress(BTN.CROSS, () => { if (saved.modal()) { saved.cancelDelete(); return; } if (saved.busy()) return; if (menu()) { confirmed = true; setMenu(undefined); } else if (typing()) key("DEL"); else dismiss(); });
  onButtonPress(BTN.TRIANGLE, openSearch);
  onButtonPress(BTN.SQUARE, () => { if (mode() === "map") go(pin()); });
  for (const [button, delta] of [[BTN.UP, -1], [BTN.DOWN, 1]] as const) onButtonPress(button, () => {
    if (saved.modal() || saved.busy()) return;
    if (menu()) setMenuIndex(i => Math.max(0, Math.min(4, i + delta)));
    else if (listing()) select(selectedIndex() + delta);
  });
  onButtonPress(BTN.LEFT, () => { if (mode() === "saved" && !menu() && !saved.modal()) saved.turnPage(-1); });
  onButtonPress(BTN.RIGHT, () => { if (mode() === "saved" && !menu() && !saved.modal()) saved.turnPage(1); });
  let previousButtons = 0;
  onFrame(buttons => {
    frame++; const session = io.session(); setOnline(session > 0);
    if (session !== previousSession) {
      if (infoRequest) { io.cancel(infoRequest); infoRequest = 0; }
      runtime.cancel(); retryAt = 0;
      if (session > 0) { tiles.invalidate(); searches.invalidate(); labels.invalidate(); saved.refresh(); setStatus("Connecting map service"); }
      else setStatus("Mac disconnected - cached map");
      previousSession = session;
    }
    if (session > 0 && !infoRequest && frame >= retryAt) {
      infoRequest = io.request("map.info", "{}", result => {
        infoRequest = 0; retryAt = frame + 3600;
        if (!result.ok) { setStatus(result.error); retryAt = frame + 120; return; }
        try {
          const value: MapInfo = JSON.parse(result.value);
          if (typeof value.source !== "string" || !/^[a-f0-9]{16}$/.test(value.source) || typeof value.name !== "string" || typeof value.attribution !== "string" || !Number.isInteger(value.maxZoom) || value.maxZoom < 1 || value.maxZoom > 18) throw new Error("Invalid map provider");
          if (info()?.source !== value.source) { tiles.clear(); setFront(undefined); setBack(undefined); setLookAhead([]); }
          setInfo(value); setStatus("Map ready");
        } catch { setStatus("Unsupported map provider"); retryAt = frame + 120; }
      });
    }
    const shoulders = buttons & (BTN.LTRIGGER | BTN.RTRIGGER);
    if (!shoulders) { confirmed = false; if (menu()) setMenu(undefined); }
    else if (!saved.modal() && !saved.busy() && mode() !== "name" && !confirmed && !menu() && shoulders !== (previousButtons & (BTN.LTRIGGER | BTN.RTRIGGER))) {
      setMenu(shoulders & BTN.LTRIGGER ? "places" : "map"); setMenuIndex(0); camera.stop();
    }
    const canPan = mode() === "map" && !shoulders && !saved.modal();
    const axisX = canPan ? analogX() : 0, axisY = canPan ? analogY() : 0;
    const dx = canPan ? (buttons & BTN.LEFT ? 1 : 0) - (buttons & BTN.RIGHT ? 1 : 0) : 0;
    const dy = canPan ? (buttons & BTN.UP ? 1 : 0) - (buttons & BTN.DOWN ? 1 : 0) : 0;
    camera.step(1 / simulationHz(), dx ? dx * 180 : -axisX * 320, dy ? dy * 180 : -axisY * 320);
    previousButtons = buttons;
    if (!info()) return;
    const view = camera.view(), next = Math.min(info()!.maxZoom, Math.max(1, Math.round(view.zoom)));
    levelAge = next === candidateLevel ? levelAge + 1 : 0; candidateLevel = next;
    let level = front()?.level ?? next;
    if (next !== level && (levelAge >= 8 || Math.abs(next - level) > 1)) {
      const previous = front();
      setBack(previous ? { ...previous, tiles: previous.tiles.filter(t => frontView.state(t.input).status === "ready") } : undefined);
      level = next;
    }
    let leadX = view.x - previousView.x; leadX -= Math.round(leadX / 256) * 256;
    const leadY = view.y - previousView.y;
    const moving = view.moving && Math.hypot(leadX, leadY) * view.scale < 24 && Math.abs(view.zoom - level) < 0.02;
    const planOptions = { ...view, level, width: 400, height: 240, maxTiles: 12, margin: 64,
      leadX: moving ? Math.max(-128, Math.min(128, leadX * view.scale * 18)) : 0,
      leadY: moving ? Math.max(-128, Math.min(128, leadY * view.scale * 18)) : 0, maxExtra: Math.abs(view.zoom - level) < 0.02 ? 4 : 0 };
    let window;
    try { window = planTileWindow(planOptions); }
    catch { level = next; window = planTileWindow({ ...planOptions, level, maxExtra: 0 }); }
    previousView = view;
    const address = (list: typeof window.visible) => list.filter(t => t.row >= 0 && t.row < 2 ** level).map(t => ({ ...t, input: { source: info()!.source, z: level, x: wrapTile(t.column, level), y: t.row } }));
    const draw = address(window.visible), ahead = address(window.lookAhead);
    if (ahead.length !== lookAhead().length || ahead.some((t, i) => { const o = lookAhead()[i]; return !o || t.input.z !== o.input.z || t.input.x !== o.input.x || t.input.y !== o.input.y; })) setLookAhead(ahead);
    const previous = front();
    if (!previous || previous.level !== level || previous.tiles.length !== draw.length || draw.some(t => !previous.tiles.some(o => o.column === t.column && o.row === t.row))) {
      // Solid's For keys by object identity. Keep overlapping tile instances;
      // a one-column pan must not remount every resource/fallback on the screen.
      const retained = draw.map(t => previous?.level === level
        ? previous.tiles.find(o => o.column === t.column && o.row === t.row && o.input.source === t.input.source) ?? t : t);
      setFront({ level, tiles: retained, originX: Math.min(...draw.map(t => t.column)) * 256, originY: Math.min(...draw.map(t => t.row)) * 256 });
    }
    if (back() && front()?.tiles.every(t => frontView.state(t.input).status === "ready")) setBack(undefined);
  });
  return { io, runtime, tiles, labels, frontView, backView, info, online, status, mode, setMode, query, setQuery, submitted, results, places, selection, setSelection, pin, menu, menuIndex,
    shift, symbols, front, back, camera, saved, typing, listing, rows, selectedIndex, select, saveCurrent, lookAhead, search, openSearch, go, zoom, key, dismiss, runMenu,
    clearBack: () => setBack(undefined),
    diagnostics: () => ({ frame, pending: io.pending(), resources: runtime.stats(), tiles: tiles.stats(), camera: camera.view() }),
  };
}
export type MapModel = ReturnType<typeof createMap>;
