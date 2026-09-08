import { expect, test } from "bun:test";
import { createTileCamera } from "@pocketjs/framework/tile-viewport";
import type { MapModel } from "../app/model.ts";
import { createStorageBenchmark } from "./device/storage-benchmark.ts";

function rig() {
  let now = 0,
    readyAt = 0,
    level = 4,
    changeAt = 0,
    local = true,
    online = true;
  const camera = createTileCamera({
    width: 400,
    height: 240,
    x: 128,
    y: 128,
    zoom: 4,
    minZoom: 0,
    maxZoom: 7,
    bounds: { width: 256, height: 256 },
  });
  const jump = camera.jump;
  camera.jump = (x, y, z) => {
    jump(x, y, z);
    changeAt = now + (8 * 1000) / 60;
  };
  const resets: boolean[] = [],
    rows: any[] = [],
    labels: string[] = [];
  const acks: {
    at: number;
    callback: (result: { ok: true; value: string }) => void;
  }[] = [];
  const map = {
    info: () => ({}),
    online: () => online,
    switching: () => false,
    planar: () => true,
    annotations: { setLayer() {} },
    clearBack() {},
    camera,
    setLocalTiles(value: boolean) {
      resets.push(value);
      local = value;
      readyAt = now + 50;
    },
    diagnostics: () => ({ pack: "fixture" }),
    tileStorage: () => (local ? "local" : "desktop"),
    front: () => ({ level, tiles: [{ input: {} }, { input: {} }] }),
    frontView: {
      state: () => ({ status: now >= readyAt ? "ready" : "pending" }),
    },
    io: {
      request(
        _method: string,
        raw: string,
        callback: (result: { ok: true; value: string }) => void,
      ) {
        rows.push(JSON.parse(raw));
        acks.push({ at: now + 50, callback });
        return rows.length;
      },
    },
  } as unknown as MapModel;
  const tick = createStorageBenchmark(
    () => map,
    (s) => labels.push(s),
    () => now,
  );
  return {
    rows,
    resets,
    labels,
    camera,
    disconnect() {
      online = false;
    },
    step() {
      now += 1000 / 60;
      if (now >= changeAt) level = Math.round(camera.view().zoom);
      if (acks[0]?.at <= now) acks.shift()!.callback({ ok: true, value: "{}" });
      tick();
    },
  };
}

test("storage comparison waits for target LOD and keeps the warmed pan cache", () => {
  const r = rig();
  for (let i = 0; i < 1400; i++) r.step();
  expect(r.rows).toHaveLength(10);
  expect(r.rows.map((row) => row.stage)).toEqual([
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
  ]);
  for (const row of r.rows) {
    expect(row.level).toBe(row.point[2]);
    expect(row.complete).toBe(true);
    expect(row.storage).toBe(row.local ? "local" : "desktop");
  }
  for (const row of r.rows.slice(8)) {
    expect(row.milliseconds).toBeGreaterThanOrEqual(8000);
    expect(row.distance).toBeGreaterThanOrEqual(2559);
    expect(row.distance).toBeLessThan(2570);
    expect(row.fallbackFrames).toBe(0);
  }
  // Ten leg starts plus the final return to normal local browsing. Resetting
  // the pan frame counter must not clear the warmed cache a second time.
  expect(r.resets).toEqual([
    true,
    false,
    true,
    false,
    true,
    false,
    true,
    false,
    true,
    false,
    true,
  ]);
  expect(r.labels.at(-1)).toBe("Storage test saved on Mac");
});

test("connection loss aborts comparison instead of folding offline time into latency", () => {
  const r = rig();
  r.step();
  r.disconnect();
  for (let i = 0; i < 100; i++) r.step();
  expect(r.rows).toHaveLength(0);
  expect(r.labels.at(-1)).toBe("Storage test: disconnected");
});
