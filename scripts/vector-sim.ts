/** Compiled guest + real core + provider. Synthetic network by default; --live
 * captures only a few explicitly viewed areas and persists their MVT responses. */
import { mkdirSync, existsSync } from "node:fs";
import { createWasmUi } from "../runtime/hosts/web/wasm-ops.js";
import { NODE_TYPE, PROP, BTN } from "../runtime/contracts/spec/spec.ts";
import { encodePNG } from "../runtime/tests/png.ts";
import { dispatchOffload } from "../runtime/tools/offload-provider.ts";
import { validateMesh } from "../runtime/tools/offload-wire.ts";
import { MapService } from "../host/service.ts";
import { defaultConfig } from "../host/config.ts";
import { vectorFixture } from "../test/vector-fixture.ts";
import type { OffloadImage, OffloadMesh } from "../runtime/contracts/spec/offload.ts";
import type { MapModel } from "../app/model.ts";
const live = process.argv.includes("--live"),
  prefix = live ? "vector-live" : "vector";
const provider = new MapService(
  {
    ...defaultConfig,
    cache: live ? ".local/vector-qa.sqlite" : ":memory:",
    kind: "osm",
    atlas: existsSync(".local/hyrule/atlas.sqlite") ? ".local/hyrule" : undefined,
  },
  live
    ? fetch
    : async (url) =>
        String(url).includes("photon")
          ? new Response(
              JSON.stringify({
                features: [
                  {
                    properties: { osm_type: "N", osm_id: 1, name: "Tokyo", country: "Japan", type: "city" },
                    geometry: { coordinates: [139.76, 35.68] },
                  },
                ],
              }),
            )
          : new Response(vectorFixture(), { headers: { "cache-control": "max-age=3600" } }),
);
const wasm = await createWasmUi(await Bun.file("runtime/hosts/web/pocketjs.wasm").arrayBuffer(), {
    width: 400,
    height: 480,
  }),
  ops = wasm.ops;
ops.hitTestBoundsAuxiliary = (x, y) => ops.hitTestBounds!(x + 40, y + 240);
(ops as any).__viewport = { w: 400, h: 240 };
const aux = ops.createNode(NODE_TYPE.view);
for (const [p, n] of [
  [PROP.posType, 1],
  [PROP.insetL, 40],
  [PROP.insetT, 240],
  [PROP.width, 320],
  [PROP.height, 240],
])
  ops.setProp(aux, p, n);
ops.insertBefore(1, aux, 0);
ops.__auxiliarySurface = { root: aux, w: 320, h: 240 };
const requests: string[] = [],
  replies: { at: number; raw: string }[] = [],
  images = new Map<number, OffloadImage>(),
  meshes = new Map<number, OffloadMesh>();
let tick = 0,
  next = 1,
  session = 1,
  uploads = 0,
  delay = 3,
  withhold = false,
  meshBytes = 0,
  imageBytes = 0,
  jsonBytes = 0,
  meshReplies = 0,
  maxPending = 0,
  maxStaging = 0,
  maxEntries = 0;
const drawTimes: number[] = [],
  checks: string[] = [];
Object.assign(globalThis, {
  ui: ops,
  __pak: await Bun.file("runtime/dist/3ds/guest/pocketmap-main.pak").arrayBuffer(),
  __simHz: 60,
  offload: {
    session: () => session,
    submit: (raw: string) => {
      if (requests.length >= 8) return false;
      requests.push(raw);
      return true;
    },
    take: () => {
      const i = replies.findIndex((r) => r.at <= tick && !withhold);
      return i < 0 ? undefined : replies.splice(i, 1)[0].raw;
    },
    uploadMesh: (id: number) => {
      const value = meshes.get(id);
      if (!value || uploads >= 1) return -1;
      uploads++;
      return ops.uploadMesh!(value.bytes);
    },
    releaseMesh: (id: number) => meshes.delete(id),
    uploadImage: (id: number) => {
      const image = images.get(id);
      if (!image || uploads >= 1) return -1;
      uploads++;
      const b = new Uint8Array(8 + image.pixels.length),
        v = new DataView(b.buffer);
      v.setUint16(0, image.width, true);
      v.setUint16(2, image.height, true);
      b[5] = 2;
      b.set(image.pixels, 8);
      return ops.uploadImgEntry!(b);
    },
    releaseImage: (id: number) => images.delete(id),
  },
});
(0, eval)(await Bun.file("runtime/dist/3ds/guest/pocketmap-main.js").text());
const s = (globalThis as any).__map as MapModel;
function check(ok: unknown, name: string) {
  if (!ok) throw new Error(name);
  checks.push(name);
}
async function frames(n: number, buttons = 0, touch?: [number, number], analog = 0x8080, inputElapsedUs?: number) {
  let hit: number | undefined;
  if (touch) {
    wasm.render();
    hit = ops.hitTestBounds!(touch[0] + 40, touch[1] + 240);
  }
  for (let i = 0; i < n; i++) {
    tick++;
    uploads = 0;
    (globalThis as any).frame(
      buttons,
      analog,
      touch ? [touch[0] | (touch[1] << 9)] : [],
      touch ? [hit] : [],
      touch ? [1] : [],
      0x8080,
      inputElapsedUs,
    );
    wasm.tick();
    const start = performance.now();
    wasm.render();
    drawTimes.push(performance.now() - start);
    const d = s.diagnostics();
    maxPending = Math.max(maxPending, d.pending);
    maxEntries = Math.max(maxEntries, d.tiles.entries);
    while (requests.length && images.size + meshes.size < 8) {
      const req = JSON.parse(requests.shift()!),
        result = await dispatchOffload(provider.methods(), req);
      if (result.mesh) {
        const token = next++;
        meshes.set(token, result.mesh);
        meshBytes += result.mesh.bytes.length + 12;
        meshReplies++;
        replies.push({
          at: tick + delay,
          raw: JSON.stringify({ id: result.id, mesh: { token, ...validateMesh(result.mesh.bytes) } }),
        });
      } else if (result.image) {
        const token = next++;
        images.set(token, result.image);
        imageBytes += result.image.pixels.length + 20;
        replies.push({
          at: tick + delay,
          raw: JSON.stringify({
            id: result.id,
            image: { token, width: result.image.width, height: result.image.height },
          }),
        });
      } else {
        if (req.method === "map.info" && result.payload && live) {
          const info = JSON.parse(result.payload);
          info.prefetch = false;
          result.payload = JSON.stringify(info);
        }
        const raw = JSON.stringify(result);
        jsonBytes += new TextEncoder().encode(raw).length + 4;
        replies.push({ at: tick + delay, raw });
      }
      maxStaging = Math.max(maxStaging, images.size + meshes.size);
    }
  }
}
mkdirSync("dist/qa", { recursive: true });
async function shot(name: string) {
  await Bun.write(`dist/qa/${prefix}-${name}.png`, encodePNG(wasm.render().slice(), 400, 480));
}
try {
  await frames(3);
  await shot("loading");
  await frames(110);
  check(s.vector(), "OSM selects the geometry collection");
  check(
    s.front()!.tiles.every((t) => s.frontView.state(t.input).status === "ready"),
    "Visible MVTs become native meshes",
  );
  await shot("map");
  check(s.annotations.rows().length > 0, "Independent label demand reveals atlas text");
  check(s.annotations.renderRows().length <= 12, "Only the bounded visible vector labels mount UI");
  const before = { meshReplies, meshBytes, jsonBytes },
    center = s.camera.view();
  for (let z = 15; z <= 18; z++) {
    s.zoom(1);
    await frames(32);
    await shot(`zoom-${z}`);
  }
  check(s.camera.view().zoom === 18 && s.front()?.level === 14, "Data LOD stays at 14 while camera reaches 18");
  check(
    meshReplies === before.meshReplies,
    "Four additional zoom levels reuse the same geometry without tile transfers",
  );
  const zoomBytes = { mesh: meshBytes - before.meshBytes, json: jsonBytes - before.jsonBytes };
  for (let z = 17; z >= 14; z--) {
    s.zoom(-1);
    await frames(28);
  }
  await shot("zoom-return");
  if (!live) {
    delay = 30;
    const x = s.camera.view().x;
    await frames(80, 0, undefined, 0xff80);
    check(s.camera.view().x !== x, "Continuous input stays live during delayed geometry replies");
    await shot("pan");
    await frames(220);
    delay = 3;
    check(
      s.front()!.tiles.every((t) => s.frontView.state(t.input).status === "ready"),
      "Directional pan resolves the new visible tiles",
    );
    const hash = wasm.drawHash!();
    session = 0;
    withhold = true;
    await frames(25, 0, undefined, 0x80ff);
    check(wasm.drawHash!() !== hash, "Cached geometry still pans while disconnected");
    session = 2;
    withhold = false;
    await frames(150);
    s.openSearch();
    s.setQuery("Tokyo");
    s.search();
    await frames(45);
    check(s.places()[0]?.name === "Tokyo", "Place search remains a Mac capability");
    s.go();
    await frames(130);
    await shot("search");
    if (s.maps().some((m) => m.kind === "hyrule")) {
      s.switchMap("hyrule");
      await frames(140);
      check(!s.vector() && s.planar(), "Hot switch retains the real Hyrule raster atlas");
      await shot("hyrule");
      s.switchMap("osm");
      await frames(160);
      check(s.vector() && !s.planar(), "Hot switch returns to OSM geometry");
    }
  }
  if (!live) {
    const center = s.camera.view();
    for (const cadence of [Array(60).fill(16667), Array(30).fill(33333), Array.from({ length: 30 }, (_, i) => [16667, 33333, 50000][i % 3])]) {
      s.camera.jump(center.x, center.y, 14);
      await frames(60, 0, undefined, 0xff80, 16667);
      const start = s.camera.view();
      for (const us of cadence) await frames(1, 0, undefined, 0xff80, us);
      const pixels = (s.camera.view().x - start.x) * start.scale;
      check(Math.abs(pixels - 320) < .02, `Compiled guest holds 320 px/s over ${cadence.length} sampled frames`);
    }
    await frames(200);
  }
  check(
    maxPending <= 3 && maxStaging <= 3 && maxEntries <= 40,
    "Shared admission, staging and residency remain bounded",
  );
  await frames(100);
  check(images.size === 0 && meshes.size === 0, "All native staging tickets drain");
  drawTimes.sort((a, b) => a - b);
  const receipt = {
    ok: true,
    live,
    checks,
    frames: tick,
    meshReplies,
    meshBytes,
    imageBytes,
    jsonBytes,
    zoomBytes,
    averageMeshBytes: meshReplies ? meshBytes / meshReplies : 0,
    rasterEquivalentBytes: meshReplies * 131092,
    maxPending,
    maxStaging,
    maxEntries,
    wasmSoftwareMs: {
      median: drawTimes[Math.floor(drawTimes.length * 0.5)],
      p95: drawTimes[Math.floor(drawTimes.length * 0.95)],
    },
    provider: provider.diagnostics(),
  };
  await Bun.write(`dist/qa/${prefix}.json`, JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify(receipt, null, 2));
} finally {
  provider.close();
}
