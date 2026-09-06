export type Position = { space?: "mercator"; lat: number; lon: number } | { space: "planar"; x: number; y: number };
export type Place = Position & { id: string; name: string; detail: string; zoom: number };
export interface MapInfo { source: string; name: string; attribution: string; maxZoom: number; minZoom?: number;
  space?: "mercator" | "planar"; home?: Place; local?: boolean }
export interface TileInput { source: string; z: number; x: number; y: number }
export type SearchInput = Position & { query: string };
export interface BookmarkPage { items: Place[]; offset: number; total: number }
export interface BookmarkCommand { op: string; kind: "save" | "rename" | "remove"; id?: string; place?: Place; name?: string }
export const HOME = { lat: 37.7879, lon: -122.4075, zoom: 14 };
export function validPosition(value: unknown): value is Position {
  if (!value || typeof value !== "object") return false;
  const p = value as Record<string, unknown>;
  return p.space === "planar"
    ? typeof p.x === "number" && Number.isFinite(p.x) && p.x >= 0 && p.x <= 256 && typeof p.y === "number" && Number.isFinite(p.y) && p.y >= 0 && p.y <= 256
    : (p.space === undefined || p.space === "mercator") && typeof p.lat === "number" && Number.isFinite(p.lat) && Math.abs(p.lat) <= 90 && typeof p.lon === "number" && Number.isFinite(p.lon) && Math.abs(p.lon) <= 180;
}
