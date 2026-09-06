import { createSignal, createMemo, onCleanup } from "solid-js";
import { createResourceRuntime, createResourceView } from "@pocketjs/framework/resource-view";
import { offloadResource } from "@pocketjs/framework/resource-offload";
import type { offload } from "@pocketjs/framework/offload";
import type { Place, BookmarkPage, BookmarkCommand } from "../shared/types.ts";
import { validPosition } from "../shared/types.ts";

export type MapMode = "map" | "search" | "results" | "about" | "saved" | "name";
export function validPlaces(rows: unknown): rows is Place[] {
  return Array.isArray(rows) && rows.length <= 5 && rows.every(p => p && typeof p.id === "string" && p.id.length <= 80 && typeof p.name === "string" && p.name.length <= 36 && typeof p.detail === "string" && p.detail.length <= 60 && Number.isInteger(p.zoom) && p.zoom >= 0 && p.zoom <= 18 && validPosition(p));
}
export function createSavedPlaces(io: ReturnType<typeof offload>, runtime: ReturnType<typeof createResourceRuntime>, mode: () => MapMode, setMode: (mode: MapMode) => void) {
  const [offset, setOffset] = createSignal(0), [selection, setSelection] = createSignal(0);
  const [name, setName] = createSignal(""), [editing, setEditing] = createSignal<Place>();
  const [busy, setBusy] = createSignal(false), [error, setError] = createSignal("");
  const [deleting, setDeleting] = createSignal<Place>(), [modal, setModal] = createSignal(false);
  let target: Place | undefined, returnMode: MapMode = "map", request = 0, last: BookmarkCommand | undefined;
  const collection = runtime.createCollection({ key: (offset: number) => String(offset), maxEntries: 4, maxViews: 1, maxDemandsPerView: 1,
    maxCost: 4 * 8192, cost: () => 8192, maxResponseBytes: 5000, retry: { attempts: 2, delayFrames: 60, maxDelayFrames: 120 },
    load: offloadResource<number>(io, "bookmarks.list", offset => JSON.stringify({ offset })), materialize(raw: string): BookmarkPage {
      const page = JSON.parse(raw);
      if (!page || !validPlaces(page.items) || !Number.isSafeInteger(page.offset) || page.offset < 0 || page.offset > 995 || page.offset % 5 || !Number.isSafeInteger(page.total) || page.total < 0 || page.total > 1000 || page.items.length !== Math.min(5, Math.max(0, page.total - page.offset))) throw new Error("Invalid saved places response");
      return page;
    } });
  const view = createResourceView(collection, { demand: () => mode() === "saved" || mode() === "name" ? [{ input: offset(), priority: -10, pin: true }] : [] });
  const page = createMemo(() => view.value(offset()));
  const selected = () => page()?.items[Math.min(selection(), (page()?.items.length ?? 1) - 1)];
  function open() { if (busy()) return; collection.invalidate(); setSelection(0); setOffset(0); setMode("saved"); }
  function begin(place: Place, rename = false) {
    if (busy()) return;
    target = place; returnMode = mode(); setEditing(rename ? place : undefined); setName(place.name); setError(""); last = undefined; setMode("name");
  }
  function changeName(value: string) { if (busy()) return; setName(value.slice(0, 36)); last = undefined; setError(""); }
  function perform(command: BookmarkCommand) {
    if (busy()) return;
    last = command; setBusy(true); setError("");
    request = io.request("bookmarks.command", JSON.stringify(command), result => {
      request = 0; setBusy(false);
      if (!result.ok) { setError("No confirmation. Retry is safe."); return; }
      try { const reply = JSON.parse(result.value); if (!/^b_[a-f0-9]{24}$/.test(reply.id)) throw new Error(); }
      catch { setError("No confirmation. Retry is safe."); return; }
      collection.invalidate(undefined, true); last = undefined; setDeleting(undefined);
      if (command.kind === "save") { setOffset(0); setSelection(0); }
      else if (command.kind === "remove") setSelection(i => Math.max(0, i - 1));
      setMode("saved");
    });
    if (!request) { setBusy(false); setError("Mac unavailable. Tap Retry."); }
  }
  const operation = () => `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
  function submit() {
    if (!target || !name().trim() || busy()) return;
    if (last) { perform(last); return; }
    perform(editing() ? { op: operation(), kind: "rename", id: editing()!.id, name: name().trim() }
      : { op: operation(), kind: "save", place: { ...target, name: name().trim() } });
  }
  function remove() { const p = deleting(); if (p) perform(last?.kind === "remove" ? last : { op: operation(), kind: "remove", id: p.id }); }
  function askRemove() { const p = selected(); if (p && !busy()) { setError(""); last = undefined; setDeleting(p); } }
  function cancelDelete() { if (!busy()) { setDeleting(undefined); setError(""); last = undefined; collection.invalidate(); } }
  function cancelName() { if (busy()) return; collection.invalidate(); setMode(returnMode); setError(""); last = undefined; }
  function turnPage(delta: number) {
    const p = page(); if (!p || busy()) return;
    const next = p.offset + delta * 5;
    if (next >= 0 && next < p.total) { setOffset(next); setSelection(0); }
  }
  onCleanup(() => { if (request) io.cancel(request); });
  return { page, selected, selection, setSelection, name, changeName, editing, busy, error, deleting, modal, setModal,
    open, begin, submit, askRemove, remove, cancelDelete, cancelName, turnPage, refresh: () => collection.invalidate(),
    state: () => view.state(offset()),
  };
}
