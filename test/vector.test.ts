import { expect, test } from "bun:test";
import { prepareVector, MeshBuilder, joinLinePaths, generalizeLinePaths } from "../host/vector-geometry.ts";
import { MapProvider, defaultConfig } from "../host/provider.ts";
import { vectorFixture, encodeVectorFixture, type Feature } from "./vector-fixture.ts";
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

test("coarse road joining preserves junctions, loops and every source edge", () => {
  const point = (x: number, y: number) => ({ x, y });
  const paths = [
    [point(2, 0), point(1, 0)], [point(0, 0), point(1, 0)],
    [point(2, 0), point(3, 0)], [point(2, 0), point(2, 1)],
    [point(10, 0), point(11, 0)], [point(11, 0), point(11, 1)],
    [point(11, 1), point(10, 0)],
  ];
  const joined = joinLinePaths(paths);
  expect(joined).toHaveLength(4);
  expect(joined.reduce((sum, p) => sum + p.length - 1, 0)).toBe(7);
  expect(joined.some((p) => p.length === 4 && p[0].x === p[3].x && p[0].y === p[3].y)).toBe(true);
  expect(joined.filter((p) => [p[0], p.at(-1)!].some((v) => v.x === 2 && v.y === 0))).toHaveLength(3);
  const generalized = generalizeLinePaths([
    [point(0.1, 0.1), point(1.1, 0.1), point(2.1, 0.1)],
    [point(2.2, 0.2), point(1.2, 0.2), point(0.2, 0.2)],
  ], 1);
  expect(generalized).toHaveLength(1);
  expect(generalized[0]).toHaveLength(3);
});

test("dense land parcels and fragmented major roads stay available without increasing device limits", () => {
  const streets: Feature[] = [], landcover: Feature[] = [];
  for (let row = 0; row < 12; row++)
    for (let x = 0; x < 256; x++)
      streets.push({ type: 2, paths: [[[x, 8 + row * 20], [x + 1, 8 + row * 20]]], properties: { kind: "motorway" } });
  for (let i = 0; i < 1600; i++) {
    const x = (i % 40) * 6, y = Math.floor(i / 40) * 6;
    landcover.push({ type: 3, properties: { kind: "grass" }, paths: [[[x, y], [x + 2, y], [x + 2, y + 2], [x, y + 2]]] });
  }
  const prepared = prepareVector(encodeVectorFixture({ streets, landcover }), 12);
  expect(prepared.simplified).toBeGreaterThanOrEqual(6);
  expect(validateMesh(prepared.mesh.bytes).width).toBe(256);
  expect(prepared.vertices).toBeLessThanOrEqual(4096);
  expect(prepared.triangles).toBeLessThanOrEqual(2048);
  expect(prepared.triangles).toBeGreaterThan(2); // Main roads survive.
});

test("last detail pass admits complete dense features and preserves the base plane", () => {
  const streets: Feature[] = [];
  // Disconnected crossing roads cannot be reduced by joining their endpoints.
  for (let i = 0; i < 3000; i++) {
    const a = (i % 65) * 4, b = Math.floor(i / 65) * 4;
    streets.push({ type: 2, paths: [[[0, a], [256, b]]], properties: { kind: "motorway" } });
  }
  const prepared = prepareVector(encodeVectorFixture({ streets }), 8);
  expect(prepared.simplified).toBe(10);
  expect(prepared.triangles).toBeGreaterThan(2);
  expect(prepared.triangles).toBeLessThanOrEqual(2048);
  expect(prepared.vertices).toBeLessThanOrEqual(4096);
  expect(validateMesh(prepared.mesh.bytes).height).toBe(256);
  const view = new DataView(prepared.mesh.bytes.buffer, prepared.mesh.bytes.byteOffset);
  const first = 16 + prepared.vertices * 4;
  expect(view.getUint32(first + 6, true)).toBe(0xffe3edf0);
});

test("feature admission cannot partially mutate a full mesh", () => {
  const full = new MeshBuilder(), extra = new MeshBuilder();
  for (let i = 0; i < 2048; i++)
    full.triangle({ x: 0, y: 0 }, { x: 256, y: 0 }, { x: 0, y: 256 }, 0xffffffff);
  extra.line([{ x: 10, y: 10 }, { x: 100, y: 100 }], 2, 0xff00ff00);
  const before = full.entry().bytes;
  expect(full.append(extra)).toBe(false);
  expect(full.entry().bytes).toEqual(before);
});
