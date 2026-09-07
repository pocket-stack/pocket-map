import { expect, test } from "bun:test";
import { prepareVector, MeshBuilder } from "../host/vector-geometry.ts";
import { MapProvider, defaultConfig } from "../host/provider.ts";
import { vectorFixture } from "./vector-fixture.ts";
import { createMapPrediction } from "../app/prediction.ts";
import { validateMesh } from "../runtime/tools/offload-wire.ts";
test("vector tessellation preserves holes, clips triangles and quantizes shared edges", () => {
  const b = new MeshBuilder();
  b.polygon(
    [
      [
        { x: -10, y: -10 },
        { x: 270, y: -10 },
        { x: 270, y: 270 },
        { x: -10, y: 270 },
      ],
      [
        { x: 80, y: 80 },
        { x: 80, y: 176 },
        { x: 176, y: 176 },
        { x: 176, y: 80 },
      ],
    ],
    0xff00ff00,
  );
  const area = b.faces.reduce((sum, f) => {
    const [a, c, d] = f.slice(0, 3).map((i) => b.points[i]);
    return sum + Math.abs((c[0] - a[0]) * (d[1] - a[1]) - (c[1] - a[1]) * (d[0] - a[0])) / 512;
  }, 0);
  expect(area).toBe(256 * 256 - 96 * 96);
  expect(validateMesh(b.entry().bytes).width).toBe(256);
  expect(b.points.every((p) => p.every((v) => v >= 0 && v <= 4096))).toBe(true);
});
test("dense cities reduce complete detail layers within the device envelope", () => {
  const normal = prepareVector(vectorFixture(), 14),
    dense = prepareVector(vectorFixture(true), 14);
  for (const p of [normal, dense]) {
    expect(p.mesh.bytes.length).toBeLessThan(36881);
    expect(p.vertices).toBeLessThan(4097);
    expect(p.triangles).toBeLessThan(2049);
    expect(p.labels.length).toBeLessThan(513);
    expect(validateMesh(p.mesh.bytes).height).toBe(256);
  }
  expect(dense.simplified).toBeGreaterThanOrEqual(2);
  expect(normal.labels.some((l) => l.name === "日本橋")).toBe(true);
  expect(() => prepareVector(new Uint8Array(2 * 1024 * 1024 + 1), 14)).toThrow();
});
test("vector geometry and labels deduplicate one cached MVT; invalid source/LOD cannot fetch", async () => {
  let calls = 0;
  const p = new MapProvider({ ...defaultConfig, cache: ":memory:" }, async () => {
    calls++;
    return new Response(vectorFixture(), { headers: { "cache-control": "max-age=3600" } });
  });
  try {
    const input = { source: p.info.source, z: 14, x: 2621, y: 6332 };
    const [a, rows, b] = await Promise.all([p.mesh(input), p.markerRows(input), p.mesh(input)]);
    expect(a).toBe(b);
    expect(rows.length).toBeGreaterThan(0);
    expect(calls).toBe(1);
    await p.markerRows({ ...input, z: 18, x: input.x * 16 + 1, y: input.y * 16 + 1 });
    await p.mesh(input);
    expect(calls).toBe(1);
    expect(p.info.render).toBe("mesh");
    expect(p.info.maxZoom).toBe(18);
    expect(p.info.dataZoom).toBe(14);
    await expect(p.mesh({ ...input, z: 15 })).rejects.toThrow();
    await expect(p.mesh({ ...input, source: "wrong" })).rejects.toThrow();
    expect(calls).toBe(1);
  } finally {
    p.close();
  }
});
test("public OSMF vector configuration never schedules unseen look-ahead", () => {
  const p = createMapPrediction(),
    v = { x: 128, y: 128, zoom: 4, targetZoom: 4, scale: 16, moving: true };
  p.reset(v);
  p.sample({ ...v, x: 130 }, 1 / 60, true);
  expect(
    p.plan(v, 4, {
      source: "fixture",
      name: "OSM",
      attribution: "OSM",
      maxZoom: 18,
      render: "mesh",
      dataZoom: 14,
      prefetch: false,
    }).extra,
  ).toHaveLength(0);
});
