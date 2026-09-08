import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { BookmarkPage, BookmarkCommand, Place } from "../shared/types.ts";
import { validPosition } from "../shared/types.ts";

/** User data has its own database: evicting the HTTP cache cannot erase it.
 * Mutation receipts and changes commit together, including deletion receipts. */
export class Bookmarks {
  private db: Database;
  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.exec("PRAGMA journal_mode=WAL");
    this.db.transaction(() => {
      const migrated = this.db.query("SELECT name FROM sqlite_master WHERE name='locations'").get();
      this.db.exec(`CREATE TABLE IF NOT EXISTS locations (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, name TEXT NOT NULL, detail TEXT NOT NULL, position TEXT NOT NULL, zoom INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS receipts (op TEXT PRIMARY KEY, body TEXT NOT NULL, result TEXT NOT NULL);`);
      if (!migrated && this.db.query("SELECT name FROM sqlite_master WHERE name='places'").get()) {
        this.db.exec("INSERT INTO locations SELECT seq,id,name,detail,json_object('lat',lat,'lon',lon),zoom FROM places");
      }
    })();
  }
  list(offset: number): BookmarkPage {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 995 || offset % 5) throw new Error("Invalid saved places page");
    const total = (this.db.query("SELECT count(*) AS n FROM locations").get() as { n: number }).n;
    offset = Math.min(offset, Math.max(0, Math.ceil(total / 5) - 1) * 5);
    const rows = this.db.query("SELECT id,name,detail,position,zoom FROM locations ORDER BY seq DESC LIMIT 5 OFFSET ?").all(offset) as { id: string; name: string; detail: string; position: string; zoom: number }[];
    const items: Place[] = rows.map(({ position, ...row }) => ({ ...row, ...JSON.parse(position) }));
    return { items, offset, total };
  }
  command(command: BookmarkCommand): string {
    if (!command || typeof command.op !== "string" || !/^[a-zA-Z0-9_-]{12,80}$/.test(command.op)) throw new Error("Invalid operation ID");
    const body = JSON.stringify(command);
    if (body.length > 1200) throw new Error("Saved place exceeds budget");
    return this.db.transaction(() => {
      const previous = this.db.query("SELECT body,result FROM receipts WHERE op=?").get(command.op) as { body: string; result: string } | null;
      if (previous) { if (previous.body !== body) throw new Error("Operation ID reused with different data"); return previous.result; }
      let id = command.id;
      if (command.kind === "save") {
        const p = command.place;
        if (!p || typeof p.name !== "string" || !p.name.trim() || p.name.length > 36 || typeof p.detail !== "string" || p.detail.length > 60 || !validPosition(p) || !Number.isInteger(p.zoom) || p.zoom < 0 || p.zoom > 18) throw new Error("Invalid saved place");
        if (this.list(0).total >= 1000) throw new Error("Saved places limit reached (1000)");
        id = "b_" + createHash("sha256").update(command.op).digest("hex").slice(0, 24);
        const position = p.space === "planar" ? { space: p.space, x: p.x, y: p.y } : { lat: p.lat, lon: p.lon };
        this.db.query("INSERT INTO locations (id,name,detail,position,zoom) VALUES (?,?,?,?,?)").run(id, p.name.trim(), p.detail, JSON.stringify(position), p.zoom);
      } else {
        if (typeof id !== "string" || !/^b_[a-f0-9]{24}$/.test(id)) throw new Error("Invalid saved place ID");
        if (!this.db.query("SELECT id FROM locations WHERE id=?").get(id)) throw new Error("Saved place no longer exists");
        if (command.kind === "rename") {
          if (typeof command.name !== "string" || !command.name.trim() || command.name.length > 36) throw new Error("Name must contain 1-36 characters");
          this.db.query("UPDATE locations SET name=? WHERE id=?").run(command.name.trim(), id);
        } else if (command.kind === "remove") this.db.query("DELETE FROM locations WHERE id=?").run(id);
        else throw new Error("Unknown saved place command");
      }
      const result = JSON.stringify({ id });
      this.db.query("INSERT INTO receipts VALUES (?,?,?)").run(command.op, body, result);
      return result;
    })();
  }
  close() { this.db.close(); }
}
