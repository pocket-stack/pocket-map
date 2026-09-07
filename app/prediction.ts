import { createTileIntent, planTileWindow, visibleTiles, type createTileCamera } from "@pocketjs/framework/tile-viewport";
import type { MapInfo, TileInput } from "../shared/types.ts";
import { wrapTile } from "./geo.ts";
type View = ReturnType<ReturnType<typeof createTileCamera>["view"]>;
export interface PlannedTile { input: TileInput; column: number; row: number; priority: number }
interface Plan { visible: PlannedTile[]; extra: PlannedTile[]; intent: { x: number; y: number; confidence: number } }
export function createMapPrediction(viewport = { width: 400, height: 240 }) {
  const intent = createTileIntent(); let previous: View | undefined, now = 0, zoomUntil = 0;
  let cached: { info: MapInfo; level: number; zoom: number; target: number; x0: number; x1: number; y0: number; y1: number; at: number; zoomPrediction: boolean; x: number; y: number; plan: Plan } | undefined;
  function reset(view: View) { intent.reset(); previous = view; zoomUntil = 0; cached = undefined; }
  return {
    reset,
    zoom(delta: number) { zoomUntil = delta > 0 ? now + 5 : 0; cached = undefined; },
    sample(view: View, seconds: number, wraps: boolean) {
      if (previous) {
        let dx = view.x - previous.x; if (wraps) dx -= Math.round(dx / 256) * 256;
        intent.sample(dx * view.scale, (view.y - previous.y) * view.scale, seconds);
      }
      previous = view; now += seconds;
    },
    plan(view: View, level: number, info: MapInfo): Plan {
      // Re-sort predictive demand at most 12 times/second while the visible
      // tile set is unchanged. A newly exposed row/column is never delayed.
      const scale = 2 ** level / 256, screen = 2 ** view.zoom;
      const x0 = Math.floor((view.x - viewport.width / 2 / screen) * scale), x1 = Math.ceil((view.x + viewport.width / 2 / screen) * scale) - 1;
      const y0 = Math.floor((view.y - viewport.height / 2 / screen) * scale), y1 = Math.ceil((view.y + viewport.height / 2 / screen) * scale) - 1;
      const stationary = cached?.plan.intent.confidence === 0
        && cached.x === view.x && cached.y === view.y && !view.moving && now >= zoomUntil;
      if (cached && cached.info === info && cached.level === level && cached.zoom === view.zoom && cached.target === view.targetZoom
        && cached.x0 === x0 && cached.x1 === x1 && cached.y0 === y0 && cached.y1 === y1
        && cached.zoomPrediction === (now < zoomUntil)
        && (stationary || now - cached.at < 1 / 12 - 1e-8)) return cached.plan;
      const local = info.local === true, lead = intent.predict(local ? 512 : 128), directional = lead.confidence > .45;
      const options = { ...view, level, ...viewport, maxTiles: 12, margin: local ? 256 : 128,
        leadX: lead.x, leadY: lead.y, directional, maxExtra: info.prefetch === false ? 0 : local ? 12 : 4 };
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
      const plan = { visible: address(window.visible, level), extra, intent: lead };
      cached = { info, level, zoom: view.zoom, target: view.targetZoom, x0, x1, y0, y1, at: now,
        zoomPrediction: now < zoomUntil, x: view.x, y: view.y, plan };
      return plan;
    },
  };
}
