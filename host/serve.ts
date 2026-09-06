import { resolve } from "node:path";
import { connectOffloadProvider } from "@pocketjs/framework/offload/provider";
import { defaultConfig } from "./config.ts";
const root = resolve(import.meta.dir, "..");
const address = process.argv[2] ?? "192.168.8.102";
const configPath = resolve(root, ".local/provider.json");
const config = { ...defaultConfig, ...(await Bun.file(configPath).exists() ? await Bun.file(configPath).json() : {}), cache: resolve(root, ".local/cache.sqlite") };
const key = (await Bun.file(resolve(root, ".local/pair.key")).text()).trim();
connectOffloadProvider({ address, key, worker: new URL("./worker.ts", import.meta.url), isolation: "process", data: config,
  log: message => console.log(new Date().toISOString(), message) });
console.log(`Pocket Map: ${config.name} -> ${address}; cache ${config.cache}`);
