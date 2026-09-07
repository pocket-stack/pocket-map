import { createMemo, createSignal } from "solid-js";
import { createResourceView, type createResourceRuntime } from "@pocketjs/framework/resource-view";
import { offloadResource } from "@pocketjs/framework/resource-offload";
import { visibleTiles } from "@pocketjs/framework/tile-viewport";
import type { offload } from "@pocketjs/framework/offload";
import { MARKER_KINDS, type MapInfo, type MapMarker, type MarkerInput, type MarkerLayer } from "../shared/types.ts";
export const LAYERS: { id: MarkerLayer; name: string }[] = [
  { id: "all", name: "All map labels" }, { id: "travel", name: "Places, shrines & towers" },
  { id: "collectibles", name: "Koroks & treasures" }, { id: "enemies", name: "Enemies" }, { id: "off", name: "Hide labels" },
];
export function createAnnotations(io: ReturnType<typeof offload>, runtime: ReturnType<typeof createResourceRuntime>) {
  const [layer, setLayer] = createSignal<MarkerLayer>("all"), [demand, setDemand] = createSignal<MarkerInput[]>([]);
  const collection = runtime.createCollection({ key: (i: MarkerInput) => `${i.source}/${i.layer}/${i.z}/${i.x}/${i.y}`, maxEntries: 12, maxViews: 1, maxDemandsPerView: 4,
    cost: () => 8192, maxCost: 12 * 8192, maxResponseBytes: 5000, load: offloadResource<MarkerInput>(io, "map.markers", JSON.stringify),
    materialize(raw: string): MapMarker[] {
      const rows = JSON.parse(raw);
      if (!Array.isArray(rows) || rows.length > 12 || !rows.every(m => Array.isArray(m) && m.length === 5 && Number.isSafeInteger(m[0]) && typeof m[1] === "string" && m[1].length <= 24 && MARKER_KINDS.includes(m[2]) && Number.isFinite(m[3]) && Number.isFinite(m[4]) && m[3] >= 0 && m[3] < 256 && m[4] >= 0 && m[4] < 256)) throw new Error("Invalid map annotations");
      return rows;
    } });
  const view = createResourceView(collection, { demand: () => demand().map(input => ({ input, priority: 25, pin: true })) });
  const rows = createMemo(() => demand().flatMap(i => view.value(i) ?? []));
  return { layer, setLayer, rows,
    reset() { setDemand([]); collection.clear(); },
    update(camera: { x: number; y: number; zoom: number }, level: number, info: MapInfo) {
      const cells = Math.max(1, 2 ** (level - 1));
      const next: MarkerInput[] = info.markers && layer() !== "off" ? visibleTiles({ ...camera, zoom: level, level, width: 400, height: 240, tileSize: 512, maxTiles: 4 })
        .filter(t => t.column >= 0 && t.row >= 0 && t.column < cells && t.row < cells)
        .map(t => ({ source: info.source, z: level, x: t.column, y: t.row, layer: layer() })) : [];
      const old = demand(); if (next.length !== old.length || next.some((v, n) => JSON.stringify(v) !== JSON.stringify(old[n]))) setDemand(next);
    },
  };
}
