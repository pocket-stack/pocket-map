import type { Place } from "../shared/types.ts";

export const OOT_REVISION = "020dab1b787bc18d1990653817765a1024bad43d";
export const OOT_VIEW = "childAngled";
// Upstream Simple CRS uses scale 2^z; Pocket Map uses 256 * 2^z.
export const OOT_LEVEL_OFFSET = 8;
export const OOT_GRIDS = [[1, 1], [2, 1], [4, 2], [7, 4], [13, 8], [25, 16], [49, 31], [98, 61]] as const;
export type AtlasPlace = Extract<Place, { space: "planar" }> & { room: boolean };
type Area = { id: number; name: string; childAngledCoords?: number[][][]; rooms?: Area[] };

/** Read the pinned literal data table; downloaded JavaScript is never executed. */
export function ootPlaces(text: string): AtlasPlace[] {
  const line = text.split("\n").find(l => l.startsWith("var mapData = "));
  if (!line) throw Error("Missing OoT scene table");
  const scenes: Area[] = JSON.parse(line.slice("var mapData = ".length).trim().replace(/;$/, ""));
  if (!Array.isArray(scenes)) throw Error("Invalid OoT scene table");
  const places: AtlasPlace[] = [];
  function add(area: Area, scene?: Area) {
    const polygons = area.childAngledCoords;
    if (!Array.isArray(polygons) || !polygons.length) return;
    if (!Number.isInteger(area.id) || typeof area.name !== "string") throw Error("Invalid OoT area");
    // A scene may span several floors. Search opens its largest mapped section.
    const regions = polygons.map(ring => {
      if (!Array.isArray(ring) || ring.length < 3 || !ring.every(p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite))) throw Error("Invalid OoT polygon");
      let cross = 0, cx = 0, cy = 0;
      for (let n = 0; n < ring.length; n++) {
        const a = ring[n], b = ring[(n + 1) % ring.length], c = a[0] * b[1] - b[0] * a[1];
        cross += c; cx += (a[0] + b[0]) * c; cy += (a[1] + b[1]) * c;
      }
      if (Math.abs(cross) < 1e-12) throw Error("Degenerate OoT polygon");
      return { area: Math.abs(cross), x: cx / (3 * cross) * 256, y: -cy / (3 * cross) * 256 };
    }).sort((a, b) => b.area - a.area);
    const { x, y } = regions[0];
    if (x < 0 || x >= 256 || y < 0 || y >= 256) throw Error("OoT position outside the atlas");
    const clean = (s: string) => s.replace(/<[^>]+>/g, "").replace(/[^\x20-\x7e]/g, "'").trim();
    places.push({ id: `o_${scene ? `${scene.id}_r` : "s"}${area.id}`, name: clean(area.name).slice(0, 36),
      detail: clean(scene ? `${scene.name} - Room ${area.id}` : "Ocarina of Time - Region").slice(0, 60),
      space: "planar", x, y, zoom: scene ? 7 : 5, room: !!scene });
  }
  for (const scene of scenes) { add(scene); for (const room of scene.rooms ?? []) add(room, scene); }
  return places;
}
