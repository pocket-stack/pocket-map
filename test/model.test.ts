import { expect, test } from "bun:test";
import { createRoot } from "solid-js";
import { createOffloadClient } from "@pocketjs/framework/offload";
import { runFrameHooks, resetFrameHooks } from "../runtime/framework/src/frame.ts";
import { __setAnalog } from "../runtime/framework/src/analog.ts";
import { BTN } from "@pocketjs/framework/input";
import { createMap } from "../app/model.ts";
test("camera keeps moving while host requests wait; search is an explicit bounded command", () => {
  resetFrameHooks();
  createRoot(dispose => {
    const sent: string[] = [];
    const io = createOffloadClient({ session: () => 1, submit: raw => { sent.push(raw); return true; }, take: () => undefined, uploadImage: () => 1, releaseImage() {} });
    const s = createMap(io); const before = s.camera.view().y;
    for (let n = 0; n < 60; n++) { __setAnalog(0x80ff); runFrameHooks(0); io.step(); }
    expect(s.camera.view().y).toBeGreaterThan(before); expect(sent).toHaveLength(1); expect(io.pending()).toBe(1);
    s.openSearch(); s.key("a"); s.key("SPACE"); s.key("b"); expect(s.query()).toBe("a b");
    expect(s.submitted()).toBeUndefined(); s.search(); expect(s.submitted()?.query).toBe("a b"); expect(s.mode()).toBe("results");
    s.dismiss(); runFrameHooks(BTN.LTRIGGER); expect(s.menu()).toBe("places");
    runFrameHooks(BTN.LTRIGGER | BTN.CIRCLE); expect(s.mode()).toBe("search"); expect(s.menu()).toBeUndefined();
    dispose(); io.dispose();
  });
  resetFrameHooks();
});
