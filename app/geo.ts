export const MAX_LATITUDE = 85.0511287798066;
export function project(lat: number, lon: number) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error("Invalid coordinate");
  lat = Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, lat));
  const sine = Math.sin(lat * Math.PI / 180);
  return { x: (((lon + 180) % 360 + 360) % 360) / 360 * 256,
    y: (0.5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI)) * 256 };
}
export function unproject(x: number, y: number) {
  return { lon: x / 256 * 360 - 180, lat: Math.atan(Math.sinh(Math.PI * (1 - 2 * y / 256))) * 180 / Math.PI };
}
export function wrapTile(x: number, z: number) { const n = 2 ** z; return ((x % n) + n) % n; }
export function scaleBar(lat: number, zoom: number) {
  const metersPerPixel = 156543.03392804097 * Math.cos(lat * Math.PI / 180) / 2 ** zoom;
  const target = metersPerPixel * 70, base = 10 ** Math.floor(Math.log10(target));
  const meters = [5, 2, 1].map(n => n * base).find(n => n <= target) ?? base / 2;
  return { pixels: meters / metersPerPixel, label: meters >= 1000 ? `${meters / 1000} km` : `${meters} m` };
}
import type { Position } from "../shared/types.ts";
export function worldPosition(position: Position) {
  return position.space === "planar" ? { x: position.x, y: position.y } : project(position.lat, position.lon);
}
export function positionAt(x: number, y: number, planar: boolean): Position {
  return planar ? { space: "planar", x, y } : unproject(x, y);
}
