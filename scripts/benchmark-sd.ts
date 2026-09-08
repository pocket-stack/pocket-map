import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { connectOffloadProvider } from "@pocketjs/framework/offload/provider";
import { resolve3dsBuildPlan } from "../runtime/tools/3ds-profile.ts";
import { build3ds } from "../runtime/tools/3ds.ts";
import { defaultConfig } from "../host/config.ts";
const root = resolve(import.meta.dir, ".."),
  qa = resolve(root, "dist/qa");
mkdirSync(qa, { recursive: true });
if (process.argv[2] === "host") {
  const address = process.argv[3] ?? "192.168.8.102";
  const key = (await Bun.file(resolve(root, ".local/pair.key")).text()).trim();
  connectOffloadProvider({
    address,
    key,
    worker: new URL("../test/device/sd-worker.ts", import.meta.url),
    isolation: "process",
    data: {
      ...defaultConfig,
      cache: resolve(root, ".local/cache.sqlite"),
      kind: "hyrule",
      atlas: resolve(root, ".local/hyrule"),
      qaDirectory: qa,
    },
    log: (message) => console.log(new Date().toISOString(), message),
  });
} else {
  const manifest = await Bun.file(
    resolve(root, "test/device/pocket.json"),
  ).json();
  const plan = resolve3dsBuildPlan(manifest),
    path = resolve(qa, "sd-benchmark-plan.json");
  await Bun.write(path, JSON.stringify(plan, null, 2));
  await build3ds([
    `--plan=${path}`,
    `--project-root=${root}`,
    ...process.argv.slice(2),
  ]);
}
