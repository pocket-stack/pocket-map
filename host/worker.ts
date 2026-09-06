import { dispatchOffload } from "@pocketjs/framework/offload/provider";
import { MapProvider } from "./provider.ts";
declare const self: { onmessage: (event: MessageEvent) => void; postMessage(value: unknown): void };
let provider: MapProvider;
self.onmessage = async event => {
  if (event.data.init) { provider = new MapProvider(event.data.init); return; }
  self.postMessage(await dispatchOffload(provider.methods(), event.data));
};
