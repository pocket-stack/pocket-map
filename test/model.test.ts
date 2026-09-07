import { expect, test } from "bun:test";
import { createRoot } from "solid-js";
import { createOffloadClient } from "@pocketjs/framework/offload";
import { runFrameHooks, resetFrameHooks } from "../runtime/framework/src/frame.ts";
import { __setAnalog } from "../runtime/framework/src/analog.ts";
import { __advanceClock, resetClock } from "../runtime/framework/src/clock.ts";
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

test("held full stick travels at the same speed across missed and uneven presentation intervals", () => {
  const cadences = [60, 45, 30].map(hz => Array.from({ length: hz }, (_, i) => Math.round((i + 1) * 1e6 / hz) - Math.round(i * 1e6 / hz)));
  cadences.push(Array.from({ length: 30 }, (_, i) => [16667, 33333, 50000][i % 3]));
  for (const analog of [0xff80, 0x0080, 0x80ff, 0x8000]) for (const cadence of cadences) {
    resetFrameHooks(); resetClock();
    createRoot(dispose => {
      const io = createOffloadClient({ session: () => 1, submit: () => true, take: () => undefined, uploadImage: () => 1, releaseImage() {} });
      const s = createMap(io);
      function frame(us: number) { __advanceClock(us); __setAnalog(analog); runFrameHooks(0); io.step(); }
      for (let i = 0; i < 60; i++) frame(16667); // Settle the intentional acceleration.
      const start = s.camera.view();
      let previous = start;
      for (const us of cadence) {
        frame(us); const next = s.camera.view();
        const speed = Math.hypot(next.x - previous.x, next.y - previous.y) * next.scale * 1e6 / us;
        expect(Math.abs(speed - 320)).toBeLessThan(.001); previous = next;
      }
      expect(Math.hypot(previous.x - start.x, previous.y - start.y) * start.scale).toBeCloseTo(320, 3);
      frame(3e6); const resumed = s.camera.view();
      expect(Math.hypot(resumed.x - previous.x, resumed.y - previous.y) * start.scale).toBeLessThan(21.334);
      dispose(); io.dispose();
    });
  }
  resetClock(); resetFrameHooks(); __setAnalog(0x8080);
});
