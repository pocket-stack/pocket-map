import { validPosition, type MapInfo, type AtlasKind } from "./types.ts";

export const ATLAS_FORMAT = "pocket-map-atlas-rgb565-v1";
export interface AtlasManifest { format: string; revision: string; tiles: number; places: number; info: MapInfo }
export const atlasTileCount = (maxZoom: number) => (4 ** (maxZoom + 1) - 1) / 3;
export const atlasPackName = (kind: AtlasKind, source: string) => `${kind}-${source}-v1`;

/** A complete square pyramid fits the native pack's bounded index (65,536 entries). */
export function validAtlas(value: unknown): value is AtlasManifest {
  if (!value || typeof value !== "object") return false;
  const a = value as AtlasManifest, i = a.info;
  return a.format === ATLAS_FORMAT && !!i && i.space === "planar" && i.minZoom === 0
    && Number.isInteger(i.maxZoom) && i.maxZoom >= 1 && i.maxZoom <= 7
    && a.tiles === atlasTileCount(i.maxZoom) && typeof i.source === "string" && /^[a-f0-9]{16}$/.test(i.source)
    && typeof i.name === "string" && i.name.length <= 40 && typeof i.attribution === "string"
    && (i.pack === undefined || /^[a-z0-9-]{1,48}$/.test(i.pack))
    && (i.worldUnits === undefined || Number.isFinite(i.worldUnits) && i.worldUnits > 0)
    && (i.home === undefined || validPosition(i.home) && i.home.space === "planar"
      && Number.isFinite(i.home.zoom) && i.home.zoom >= 0 && i.home.zoom <= i.maxZoom);
}
