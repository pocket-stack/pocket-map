import { dispatchOffload } from "@pocketjs/framework/offload/provider";
import { MapProvider } from "./provider.ts";
import { AtlasProvider } from "./atlas.ts";
declare const self: { onmessage: (event: MessageEvent) => void; postMessage(value: unknown): void };
let provider: MapProvider | AtlasProvider;
const trace = process.env.POCKET_MAP_TRACE === "1";
self.onmessage = async event => {
  if (event.data.init) {
    provider = event.data.init.kind === "hyrule" ? new AtlasProvider(event.data.init.atlas) : new MapProvider(event.data.init);
    return;
  }
  const started = Date.now();
  const reply = await dispatchOffload(provider.methods(), event.data);
  if (trace) console.log(new Date().toISOString(), `Map request id=${event.data.id} method=${event.data.method} workMs=${Date.now() - started} stats=${JSON.stringify(provider.diagnostics())} error=${reply.error ?? "none"}`);
  self.postMessage(reply);
};
