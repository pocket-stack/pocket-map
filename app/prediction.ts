import { createTileIntent, planTileWindow, visibleTiles, type createTileCamera } from "@pocketjs/framework/tile-viewport";
import type { MapInfo, TileInput } from "../shared/types.ts";
import { wrapTile } from "./geo.ts";
type View = ReturnType<ReturnType<typeof createTileCamera>["view"]>;
export interface PlannedTile { input: TileInput; column: number; row: number; priority: number }
export function createMapPrediction() {
  const intent = createTileIntent(); let previous: View | undefined, now = 0, zoomUntil = 0;
  function reset(view: View) { intent.reset(); previous = view; zoomUntil = 0; }
  return {
    reset,
    zoom(delta: number) { zoomUntil = delta > 0 ? now + 5 : 0; },
    sample(view: View, seconds: number, wraps: boolean) {
      if (previous) {
        let dx = view.x - previous.x; if (wraps) dx -= Math.round(dx / 256) * 256;
        intent.sample(dx * view.scale, (view.y - previous.y) * view.scale, seconds);
      }
      previous = view; now += seconds;
    },
    plan(view: View, level: number, info: MapInfo) {
      const local = info.local === true, lead = intent.predict(local ? 512 : 128), directional = lead.confidence > .45;
      const options = { ...view, level, width: 400, height: 240, maxTiles: 12, margin: local ? 256 : 128,
        leadX: lead.x, leadY: lead.y, directional, maxExtra: local ? 12 : 4 };
      const window = planTileWindow(options);
      const address = (list: typeof window.visible, z: number): PlannedTile[] => list
        .filter(t => t.row >= 0 && t.row < 2 ** z && (info.space !== "planar" || t.column >= 0 && t.column < 2 ** z))
        .map(t => ({ ...t, input: { source: info.source, z, x: wrapTile(t.column, z), y: t.row } }));
      const next = Math.round(view.targetZoom) + 1;
      // Only the complete local atlas predicts another zoom level. Public OSM
      // retains modest same-level look-ahead rather than multi-level pre-seeding.
      const zoomTiles = local && now < zoomUntil && next > level && next <= info.maxZoom
        ? address(visibleTiles({ ...options, zoom: next, level: next }), next).slice(0, 6) : [];
      const extra = [...zoomTiles.map(t => ({ ...t, priority: 300 + t.priority })),
        ...address(window.lookAhead, level).map(t => ({ ...t, priority: 1000 + t.priority }))].slice(0, local ? 12 : 4);
      return { visible: address(window.visible, level), extra, intent: lead };
    },
  };
}
