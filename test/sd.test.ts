import { expect, test } from "bun:test";
import { createRoot } from "solid-js";
import { createOffloadClient } from "@pocketjs/framework/offload";
import { resourcePacks } from "@pocketjs/framework/resource-pack";
import { installHost, type HostOps } from "../runtime/framework/src/host.ts";
import {
  runFrameHooks,
  resetFrameHooks,
} from "../runtime/framework/src/frame.ts";
import { runServicePumps } from "../runtime/framework/src/services.ts";
import { createMap } from "../app/model.ts";

test("SD bootstrap opens and navigates new Hyrule tiles while the Mac is offline", () => {
  resetFrameHooks();
  const replies: string[] = [],
    addresses: string[] = [],
    released: number[] = [],
    freed: number[] = [];
  let token = 0,
    uploaded = 0,
    remote = 0;
  const source = "1234567890abcdef";
  const atlas = {
    format: "pocket-map-atlas-rgb565-v1",
    tiles: 21845,
    info: {
      source,
      name: "Hyrule",
      attribution: "Fixture",
      minZoom: 0,
      maxZoom: 7,
      space: "planar",
      home: {
        id: "home",
        name: "Home",
        detail: "",
        space: "planar",
        x: 128,
        y: 128,
        zoom: 4,
      },
    },
  };
  (globalThis as any).resourcePacks = {
    session: () => 1,
    enqueue(id: number, name: string, entry: number) {
      addresses.push(`${name}/${entry}`);
      replies.push(
        JSON.stringify(
          name === "hyrule"
            ? { id, payload: JSON.stringify(atlas) }
            : { id, image: { token: ++token, width: 256, height: 256 } },
        ),
      );
      return true;
    },
    take: () => replies.shift(),
    uploadImage: () => ++uploaded,
    releaseImage: (id: number) => released.push(id),
    stats: () => "fixture",
  };
  installHost({
    kind: "injected",
    target: "fixture",
    strict: true,
    ops: { freeTexture: (id: number) => freed.push(id) } as unknown as HostOps,
  });
  const io = createOffloadClient({
    session: () => 0,
    submit: () => {
      remote++;
      return false;
    },
    take: () => undefined,
    uploadImage: () => -1,
    releaseImage() {},
  });
  try {
    createRoot((dispose) => {
      const s = createMap(io);
      const frames = (n: number) => {
        for (let i = 0; i < n; i++) {
          runServicePumps();
          runFrameHooks(0);
          s.runtime.step();
          io.step();
        }
      };
      frames(90);
      expect(s.info()?.source).toBe(source);
      expect(s.online()).toBe(false);
      expect(s.localMapAvailable()).toBe(true);
      expect(
        s
          .front()!
          .tiles.every((t) => s.frontView.state(t.input).status === "ready"),
      ).toBe(true);
      const before = addresses.length;
      s.camera.jump(220, 80, 7);
      frames(90);
      expect(addresses.length).toBeGreaterThan(before);
      expect(
        s
          .front()!
          .tiles.every((t) => s.frontView.state(t.input).status === "ready"),
      ).toBe(true);
      expect(remote).toBe(0);
      expect(s.tiles.stats().entries).toBeLessThanOrEqual(40);
      expect(addresses[0]).toBe("hyrule/0");
      expect(
        addresses.slice(1).every((a) => a.startsWith(`hyrule-${source}-v1/`)),
      ).toBe(true);
      dispose();
      expect(freed.length).toBe(uploaded);
      expect(released.length).toBe(uploaded);
    });
  } finally {
    resourcePacks()?.dispose();
    io.dispose();
    delete (globalThis as any).resourcePacks;
    resetFrameHooks();
  }
});
