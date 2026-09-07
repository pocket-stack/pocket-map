// Separate diagnostic entry; never imported by the production app.
import { createSignal } from "solid-js";
import { mount } from "@pocketjs/framework/solid";
import { Text } from "@pocketjs/framework/components";
import { onFrame } from "@pocketjs/framework/lifecycle";
import MapApp from "../../app/ui.tsx";
import type { MapModel } from "../../app/model.ts";
import { createStorageBenchmark } from "./storage-benchmark.ts";

mount(() => {
  const app = <MapApp />;
  const [label, setLabel] = createSignal("Storage test: waiting for Mac");
  onFrame(
    createStorageBenchmark(
      () => (globalThis as unknown as { __map?: MapModel }).__map,
      setLabel,
    ),
  );
  return (
    <>
      {app}
      <Text class="absolute left-[8] top-[30] text-xs font-bold text-[#ffffff]">
        {label()}
      </Text>
    </>
  );
});
