import { expect, test } from "bun:test";
import { createCanvas } from "@napi-rs/canvas";
import { HttpCache, type NetworkFetch } from "../host/cache.ts";
import { MapProvider, defaultConfig, packRGB } from "../host/provider.ts";
const png = () => { const c = createCanvas(256, 256), ctx = c.getContext("2d"); ctx.fillStyle = "red"; ctx.fillRect(0, 0, 128, 256); ctx.fillStyle = "blue"; ctx.fillRect(128, 0, 128, 256); return c.toBuffer("image/png"); };
test("host decodes PNGs, keeps exact PSM color order, deduplicates and rejects arbitrary URLs", async () => {
  let calls = 0;
  const provider = new MapProvider({ ...defaultConfig, format: "raster", tileURL:"https://tile.openstreetmap.de/{z}/{x}/{y}.png", cache: ":memory:" }, (async () => { calls++; return new Response(png()); }) as NetworkFetch);
  try {
    const input = { source: provider.info.source, z: 1, x: 0, y: 0 };
    const [a, b] = await Promise.all([provider.tile(input), provider.tile(input)]);
    expect(a).toBe(b); expect(calls).toBe(1); expect(a.pixels.length).toBe(131072);
    expect([...a.pixels.slice(0, 2)]).toEqual([31, 0]); expect([...a.pixels.slice(256, 258)]).toEqual([0, 248]);
    await provider.tile(input); expect(calls).toBe(1);
    await expect(provider.tile({ ...input, x: -1 })).rejects.toThrow();
    await expect(provider.tile({ ...input, source: "other" })).rejects.toThrow();
    await expect(provider.tile({ ...input, z: 99 })).rejects.toThrow();
    expect(calls).toBe(1);
    expect([...packRGB(new Uint8Array([0, 0, 0, 0]), 1, 1).pixels]).toEqual([255, 255]);
  } finally { provider.close(); }
});
test("host cache persists reuse and conditional expiry, bounds bodies and honors no-store", async () => {
  let calls = 0, conditional = false;
  const cache = new HttpCache(":memory:", (async (_url, options) => {
    calls++; conditional = !!(options?.headers as Record<string, string>)["If-None-Match"];
    return calls === 1 ? new Response("cached", { headers: { etag: "one", "cache-control": "max-age=0" } }) : new Response(null, { status: 304, headers: { "cache-control": "max-age=3600" } });
  }) as NetworkFetch);
  try {
    const opts = { maxBytes: 20, ttl: 1000 };
    await cache.get("https://example.com/tile", opts); const b = await cache.get("https://example.com/tile", opts); await cache.get("https://example.com/tile", opts);
    expect(conditional).toBe(true); expect(calls).toBe(2); expect(new TextDecoder().decode(b)).toBe("cached");
  } finally { cache.close(); }
  const huge = new HttpCache(":memory:", (async () => new Response(new Uint8Array(40))) as NetworkFetch);
  await expect(huge.get("https://example.com", { maxBytes: 20, ttl: 1000 })).rejects.toThrow("budget"); huge.close();
  let n = 0;
  const noStore = new HttpCache(":memory:", (async () => { n++; return new Response("ok", { headers: { "cache-control": "no-store" } }); }) as NetworkFetch);
  await noStore.get("https://example.com", { maxBytes: 20, ttl: 1000 }); await noStore.get("https://example.com", { maxBytes: 20, ttl: 1000 }); expect(n).toBe(2); noStore.close();
});
test("malformed dimensions cannot trigger an unbounded host image decode", async () => {
  const bytes = png(); bytes.writeUInt32BE(100000, 16);
  const provider = new MapProvider({ ...defaultConfig, format: "raster", tileURL:"https://tile.openstreetmap.de/{z}/{x}/{y}.png", cache: ":memory:" }, (async () => new Response(bytes)) as NetworkFetch);
  await expect(provider.tile({ source: provider.info.source, z: 1, x: 0, y: 0 })).rejects.toThrow("256px"); provider.close();
});
test("real Bun fetch accepts conditional 304 without following redirects", async () => {
  let calls = 0, followed = 0;
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch(request) {
    if (new URL(request.url).pathname === "/redirect") return new Response(null, { status: 302, headers: { location: "/forbidden" } });
    if (new URL(request.url).pathname === "/forbidden") { followed++; return new Response("unexpected"); }
    calls++;
    return request.headers.has("if-none-match") ? new Response(null, { status: 304, headers: { "cache-control": "max-age=3600" } }) : new Response("tile", { headers: { etag: "v1", "cache-control": "max-age=0" } });
  } });
  const cache = new HttpCache(":memory:"); const options = { maxBytes: 20, ttl: 1000 }, url = `http://127.0.0.1:${server.port}`;
  try {
    await cache.get(url, options); expect(new TextDecoder().decode(await cache.get(url, options))).toBe("tile");
    await cache.get(url, options); expect(calls).toBe(2);
    await expect(cache.get(url + "/redirect", options)).rejects.toThrow("302"); expect(followed).toBe(0);
  } finally { cache.close(); server.stop(true); }
});
test("search handles empty, malformed and duplicate results with a bounded response", async () => {
  const feature = { properties: { name: "Tokyo", osm_type: "N", osm_id: 1, country: "Japan", type: "city" }, geometry: { coordinates: [139.76, 35.68] } };
  const provider = new MapProvider({ ...defaultConfig, format: "raster", tileURL:"https://tile.openstreetmap.de/{z}/{x}/{y}.png", cache: ":memory:" }, (async url => {
    expect(new URL(String(url)).searchParams.get("limit")).toBe("5");
    return new Response(JSON.stringify({ features: [feature, feature, { ...feature, geometry: { coordinates: [500, 1000] } }] }));
  }) as NetworkFetch);
  expect(await provider.search({ query: " ", lat: 0, lon: 0 })).toEqual([]);
  expect(await provider.search({ query: "Tokyo", lat: 0, lon: 0 })).toEqual([{ id: "N1", name: "Tokyo", detail: "Japan", lat: 35.68, lon: 139.76, zoom: 13 }]);
  await expect(provider.search({ query: "x".repeat(81), lat: 0, lon: 0 })).rejects.toThrow(); provider.close();
});
