import { createHash } from "node:crypto";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import type { OffloadImage } from "@pocketjs/framework/offload/provider";
import { HttpCache, type NetworkFetch } from "./cache.ts";
import { Bookmarks } from "./bookmarks.ts";
import { join, dirname } from "node:path";
import type { MapInfo, Place, SearchInput, TileInput } from "../shared/types.ts";

import type { ProviderConfig } from "./config.ts";
export { defaultConfig, type ProviderConfig } from "./config.ts";
export function packRGB(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): OffloadImage {
  if (rgba.byteLength !== width * height * 4) throw new Error("Invalid pixel plane");
  const pixels = new Uint8Array(width * height * 2);
  for (let i = 0; i < width * height; i++) {
    const alpha = rgba[i * 4 + 3] / 255;
    const r = Math.round(rgba[i * 4] * alpha + 255 * (1 - alpha));
    const g = Math.round(rgba[i * 4 + 1] * alpha + 255 * (1 - alpha));
    const b = Math.round(rgba[i * 4 + 2] * alpha + 255 * (1 - alpha));
    const rgb = (r >> 3) | ((g >> 2) << 5) | ((b >> 3) << 11);
    pixels[i * 2] = rgb & 255; pixels[i * 2 + 1] = rgb >> 8;
  }
  return { width, height, pixels, format: "r5g6b5" };
}
export class MapProvider {
  readonly info: MapInfo;
  readonly cache: HttpCache;
  readonly bookmarks: Bookmarks;
  private decoded = new Map<string, { image: OffloadImage; expires: number }>();
  private loading = new Map<string, Promise<OffloadImage>>();
  private searching = false;
  private nextSearch = 0;
  constructor(readonly config: ProviderConfig, network: NetworkFetch = fetch) {
    for (const url of [config.tileURL, config.searchURL]) if (new URL(url).protocol !== "https:" && !/^http:\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(url)) throw new Error("Use HTTPS or a local provider");
    if (!["{z}", "{x}", "{y}"].every(part => config.tileURL.includes(part)) || !Number.isInteger(config.maxZoom) || config.maxZoom < 1 || config.maxZoom > 18) throw new Error("Invalid tile source");
    this.info = { source: createHash("sha256").update(JSON.stringify([config.tileURL, "r5g6b5-v1"])).digest("hex").slice(0, 16), name: config.name.slice(0, 40), attribution: config.attribution.slice(0, 100), maxZoom: config.maxZoom };
    this.cache = new HttpCache(config.cache, network);
    this.bookmarks = new Bookmarks(config.cache === ":memory:" ? ":memory:" : join(dirname(config.cache), "places.sqlite"));
  }
  methods() { return {
    "map.info": () => JSON.stringify(this.info),
    "map.tile": (raw: string) => this.tile(JSON.parse(raw)),
    "map.search": async (raw: string) => JSON.stringify(await this.search(JSON.parse(raw))),
    "map.label": (raw: string) => this.label(JSON.parse(raw)),
    "bookmarks.list": (raw: string) => JSON.stringify(this.bookmarks.list(JSON.parse(raw).offset)),
    "bookmarks.command": (raw: string) => this.bookmarks.command(JSON.parse(raw)),
  }; }
  tile(input: TileInput): Promise<OffloadImage> {
    const { source, z, x, y } = input;
    if (source !== this.info.source || ![z, x, y].every(Number.isInteger) || z < 0 || z > this.config.maxZoom || x < 0 || x >= 2 ** z || y < 0 || y >= 2 ** z) return Promise.reject(new Error("Invalid tile address or source"));
    const key = `${z}/${x}/${y}`, hit = this.decoded.get(key);
    if (hit && hit.expires > Date.now()) { this.decoded.delete(key); this.decoded.set(key, hit); return Promise.resolve(hit.image); }
    const pending = this.loading.get(key); if (pending) return pending;
    if (this.loading.size >= 3) return Promise.reject(new Error("Tile decode budget exhausted"));
    const url = this.config.tileURL.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));
    const work = this.decode(url)
      .then(image => { this.decoded.set(key, { image, expires: this.cache.expires(url) }); if (this.decoded.size > 64) this.decoded.delete(this.decoded.keys().next().value!); return image; })
      .finally(() => this.loading.delete(key));
    this.loading.set(key, work); return work;
  }
  private async decode(url: string) {
    const bytes = await this.cache.get(url, { maxBytes: 512 * 1024, ttl: 7 * 86400_000 });
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.length < 24 || view.getUint32(0) !== 0x89504e47 || view.getUint32(4) !== 0x0d0a1a0a || view.getUint32(12) !== 0x49484452 || view.getUint32(16) !== 256 || view.getUint32(20) !== 256) throw new Error("Expected a 256px PNG tile");
    const image = await loadImage(Buffer.from(bytes));
    if (image.width !== 256 || image.height !== 256) throw new Error("Invalid decoded tile size");
    const canvas = createCanvas(256, 256), ctx = canvas.getContext("2d"); ctx.drawImage(image, 0, 0);
    return packRGB(ctx.getImageData(0, 0, 256, 256).data, 256, 256);
  }
  async search(input: SearchInput): Promise<Place[]> {
    if (typeof input.query !== "string" || input.query.length > 80 || !Number.isFinite(input.lat) || Math.abs(input.lat) > 90 || !Number.isFinite(input.lon) || Math.abs(input.lon) > 180) throw new Error("Invalid place search");
    const query = input.query.trim(); if (!query) return [];
    if (this.searching) throw new Error("A search is already running");
    this.searching = true;
    try {
      // Explicit submits only, at most one outgoing search per second.
      await Bun.sleep(Math.max(0, this.nextSearch - Date.now())); this.nextSearch = Date.now() + 1100;
      const url = new URL(this.config.searchURL); url.searchParams.set("q", query); url.searchParams.set("limit", "5"); url.searchParams.set("lang", "en");
      url.searchParams.set("lat", input.lat.toFixed(1)); url.searchParams.set("lon", input.lon.toFixed(1));
      const bytes = await this.cache.get(url.toString(), { maxBytes: 64 * 1024, ttl: 86400_000 });
      const result = JSON.parse(new TextDecoder().decode(bytes));
      if (!Array.isArray(result.features)) throw new Error("Invalid search response");
      const seen = new Set<string>(), places: Place[] = [];
      for (const feature of result.features.slice(0, 5)) {
        const p = feature.properties, xy = feature.geometry?.coordinates;
        if (!p || typeof p.name !== "string" || !Array.isArray(xy) || !xy.slice(0, 2).every(Number.isFinite) || Math.abs(xy[0]) > 180 || Math.abs(xy[1]) > 90) continue;
        const id = `${String(p.osm_type).slice(0, 1)}${String(p.osm_id).slice(0, 20)}`;
        if (seen.has(id)) continue; seen.add(id);
        const detail = [...new Set([p.street, p.city, p.state, p.country].filter(n => typeof n === "string" && n !== p.name))].join(", ").slice(0, 60);
        places.push({ id, name: p.name.slice(0, 36), detail, lon: xy[0], lat: xy[1], zoom: ["city", "town", "village", "state", "country"].includes(p.type) ? p.type === "country" ? 5 : 13 : 16 });
      }
      return places;
    } finally { this.searching = false; }
  }
  label(input: { name: string; detail: string }) {
    if (typeof input.name !== "string" || input.name.length > 80 || typeof input.detail !== "string" || input.detail.length > 120) throw new Error("Invalid label");
    const canvas = createCanvas(256, 32), c = canvas.getContext("2d");
    c.fillStyle = "#f7f9fc"; c.fillRect(0, 0, 256, 32);
    c.fillStyle = "#263748"; c.font = "bold 13px Arial"; c.fillText(input.name, 5, 13, 246);
    c.fillStyle = "#627387"; c.font = "11px Arial"; c.fillText(input.detail, 5, 28, 246);
    return packRGB(c.getImageData(0, 0, 256, 32).data, 256, 32);
  }
  close() { this.cache.close(); this.bookmarks.close(); }
}
