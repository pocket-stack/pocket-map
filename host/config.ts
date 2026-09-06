export interface ProviderConfig { tileURL: string; searchURL: string; name: string; attribution: string; maxZoom: number; cache: string }
export const defaultConfig: ProviderConfig = {
  tileURL: "https://tile.openstreetmap.de/{z}/{x}/{y}.png", searchURL: "https://photon.komoot.io/api/",
  name: "OpenStreetMap DE", attribution: "OpenStreetMap contributors", maxZoom: 18, cache: ".local/cache.sqlite",
};
