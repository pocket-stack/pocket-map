import { dispatchOffload } from "@pocketjs/framework/offload/provider";
import { mkdirSync, appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { MapService } from "../../host/service.ts";
declare const self: {
  onmessage: (event: MessageEvent) => void;
  postMessage(value: unknown): void;
};
let provider: MapService, output: string;
self.onmessage = async (event) => {
  if (event.data.init) {
    provider = new MapService(event.data.init);
    output = resolve(event.data.init.qaDirectory, "sd-benchmark.jsonl");
    mkdirSync(event.data.init.qaDirectory, { recursive: true });
    return;
  }
  self.postMessage(
    await dispatchOffload(
      {
        ...provider.methods(),
        "map.benchmark": (raw: string) => {
          const row = JSON.parse(raw);
          if (
            !Number.isInteger(row.stage) ||
            row.stage < 0 ||
            row.stage > 9 ||
            !Number.isFinite(row.milliseconds) ||
            row.milliseconds < 0
          )
            throw Error("Invalid measurement");
          appendFileSync(
            output,
            JSON.stringify({ received: new Date().toISOString(), ...row }) +
              "\n",
          );
          return "{}";
        },
      },
      event.data,
    ),
  );
};
