import { test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Bookmarks } from "../host/bookmarks.ts";
import type { BookmarkCommand } from "../shared/types.ts";
const place = { id: "N1", name: "Coffee", detail: "Market Street", lat: 37.7, lon: -122.4, zoom: 16 };
test("saved places survive reopening, paginate and retain idempotent mutation receipts", () => {
  const dir = mkdtempSync(join(tmpdir(), "pocket-map-saved-")); let db = new Bookmarks(join(dir, "places.sqlite"));
  try {
    const save: BookmarkCommand = { op: "save_receipt_0001", kind: "save", place };
    const reply = db.command(save); const id = JSON.parse(reply).id;
    db.close(); db = new Bookmarks(join(dir, "places.sqlite"));
    expect(db.command(save)).toBe(reply); expect(db.list(0).total).toBe(1);
    const rename: BookmarkCommand = { op: "rename_receipt_01", kind: "rename", id, name: "Morning coffee" };
    expect(db.command(rename)).toBe(reply); expect(db.list(0).items[0].name).toBe("Morning coffee");
    for (let n = 0; n < 6; n++) db.command({ op: `save_next_item_0${n}`, kind: "save", place: { ...place, name: `Place ${n}` } });
    expect(db.list(0).items.map(p => p.name)).toEqual(["Place 5", "Place 4", "Place 3", "Place 2", "Place 1"]);
    expect(db.list(5).items.map(p => p.name)).toEqual(["Place 0", "Morning coffee"]);
    const remove: BookmarkCommand = { op: "remove_receipt_01", kind: "remove", id };
    db.command(remove); db.close(); db = new Bookmarks(join(dir, "places.sqlite"));
    expect(db.command(remove)).toBe(reply); expect(db.command(save)).toBe(reply); expect(db.list(0).total).toBe(6);
    expect(db.list(5).items).toHaveLength(1); // delayed save cannot resurrect a deleted place
    db.command({ op: "remove_last_page", kind: "remove", id: db.list(5).items[0].id });
    expect(db.list(5).offset).toBe(0); expect(db.list(5).items).toHaveLength(5);
    expect(() => db.command({ ...save, place: { ...place, name: "Different" } })).toThrow("reused");
    expect(() => db.command({ op: "bad_coordinates_1", kind: "save", place: { ...place, lat: NaN } })).toThrow("Invalid");
    expect(() => db.list(1)).toThrow("Invalid"); expect(() => db.list(1000)).toThrow("Invalid");
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});
