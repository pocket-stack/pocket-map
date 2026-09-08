import { resolve } from "node:path";
import { connectOffloadProvider } from "@pocketjs/framework/offload/provider";
import { defaultConfig } from "./config.ts";
const root = resolve(import.meta.dir, "..");
const address = process.argv.slice(2).find(arg => !arg.startsWith("--")) ?? "192.168.8.102";
const configPath = resolve(root, ".local/provider.json");
const overrides = await Bun.file(configPath).exists() ? await Bun.file(configPath).json() : {};
const config = { ...defaultConfig, ...overrides, format: overrides.format ?? (overrides.tileURL?.endsWith(".png") ? "raster" : defaultConfig.format), cache: resolve(root, ".local/cache.sqlite") };
config.kind = process.argv.includes("--oot") ? "oot" : process.argv.includes("--osm") ? "osm" : process.argv.includes("--hyrule") ? "hyrule" : config.kind ?? "hyrule";
config.atlas = resolve(root, ".local/hyrule");
config.atlases = { hyrule: config.atlas, oot: resolve(root, ".local/oot") };
if (config.kind !== "osm" && !await Bun.file(resolve(config.atlases[config.kind as "hyrule" | "oot"], "atlas.sqlite")).exists()) throw new Error(`Run bun run prepare:${config.kind} before starting the host`);
const key = (await Bun.file(resolve(root, ".local/pair.key")).text()).trim();
connectOffloadProvider({ address, key, worker: new URL("./worker.ts", import.meta.url), isolation: "process", data: config,
  trace: process.env.POCKET_MAP_TRACE === "1",
  log: message => console.log(new Date().toISOString(), message) });
console.log(`Pocket Map: ${config.kind} -> ${address}; local atlases and OSM available through the map chooser`);
