import { resolve } from "node:path";
import { connectOffloadUsbProvider } from "@pocketjs/framework/offload/provider";
import { defaultConfig } from "./config.ts";
const root = resolve(import.meta.dir, "..");
const overrides = await Bun.file(resolve(root, ".local/provider.json"))
  .json()
  .catch(() => ({}));
const config = {
  ...defaultConfig,
  ...overrides,
  cache: resolve(root, ".local/cache.sqlite"),
  atlas: resolve(root, ".local/hyrule"),
  kind: process.argv.includes("--hyrule") ? "hyrule" : "osm",
};
const provider = connectOffloadUsbProvider({
  directory: resolve(root, "dist/psplink"),
  app: "dev.pocket-stack.map",
  worker: new URL("./worker.ts", import.meta.url),
  data: config,
  log: (message: string) => console.log(new Date().toISOString(), message),
});
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    provider.close();
    process.exit(0);
  });
