export interface Place { id: string; name: string; detail: string; lat: number; lon: number; zoom: number }
export interface MapInfo { source: string; name: string; attribution: string; maxZoom: number }
export interface TileInput { source: string; z: number; x: number; y: number }
export interface SearchInput { query: string; lat: number; lon: number }
export interface BookmarkPage { items: Place[]; offset: number; total: number }
export interface BookmarkCommand { op: string; kind: "save" | "rename" | "remove"; id?: string; place?: Place; name?: string }
export const HOME = { lat: 37.7879, lon: -122.4075, zoom: 14 };
