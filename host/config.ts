import type { AtlasKind, MapKind } from "../shared/types.ts";
export interface ProviderConfig { tileURL: string; format?: "raster" | "vector"; dataZoom?: number; searchURL: string; name: string; attribution: string; maxZoom: number; cache: string; kind?: MapKind; atlas?: string; atlases?: Partial<Record<AtlasKind, string>> }
export const defaultConfig: ProviderConfig = {
  tileURL: "https://tiles.versatiles.org/tiles/osm/{z}/{x}/{y}", format: "vector", dataZoom: 14, searchURL: "https://photon.komoot.io/api/",
  name: "OpenStreetMap", attribution: "OpenStreetMap contributors", maxZoom: 18, cache: ".local/cache.sqlite",
};
