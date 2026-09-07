import { PbfWriter } from "pbf";
type Feature = { type: number; paths: [number, number][][]; properties: Record<string, string> };
export function vectorFixture(dense = false): Uint8Array {
  const polygon = (paths: [number, number][][], properties: Record<string, string> = {}): Feature => ({
    type: 3,
    paths,
    properties,
  });
  const line = (points: [number, number][], name: string): Feature => ({
    type: 2,
    paths: [points],
    properties: { kind: "residential", name },
  });
  const road: Feature[] = [];
  for (let n = 0; n < 6; n++)
    road.push(
      line(
        [
          [-5, 24 + n * 38],
          [260, 24 + n * 38],
        ],
        `Street ${n}`,
      ),
      line(
        [
          [24 + n * 38, -5],
          [24 + n * 38, 260],
        ],
        `Avenue ${n}`,
      ),
    );
  const layers: Record<string, Feature[]> = {
    ocean: [
      polygon([
        [
          [180, -5],
          [260, -5],
          [260, 260],
          [180, 260],
        ],
      ]),
    ],
    land: [
      polygon(
        [
          [
            [40, 40],
            [160, 40],
            [160, 145],
            [40, 145],
          ],
          [
            [70, 70],
            [70, 110],
            [115, 110],
            [115, 70],
          ],
        ],
        { kind: "park" },
      ),
    ],
    streets: road,
    street_labels: road,
    place_labels: [{ type: 1, paths: [[[130, 185]]], properties: { name: "日本橋", kind: "suburb" } }],
  };
  if (dense)
    layers.buildings = Array.from({ length: 1600 }, (_, i) => {
      const x = (i % 40) * 6,
        y = Math.floor(i / 40) * 6;
      return polygon([
        [
          [x, y],
          [x + 4, y],
          [x + 4, y + 4],
          [x, y + 4],
        ],
      ]);
    });
  const output = new PbfWriter();
  for (const [name, features] of Object.entries(layers))
    output.writeMessage(
      3,
      (_, p) => {
        p.writeVarintField(15, 2);
        p.writeStringField(1, name);
        p.writeVarintField(5, 4096);
        const keys = [...new Set(features.flatMap((f) => Object.keys(f.properties)))],
          values = [...new Set(features.flatMap((f) => Object.values(f.properties)))];
        for (const key of keys) p.writeStringField(3, key);
        for (const value of values) p.writeMessage(4, (v, w) => w.writeStringField(1, v), value);
        for (const feature of features)
          p.writeMessage(
            2,
            (f, w) => {
              w.writeVarintField(3, f.type);
              w.writePackedVarint(
                2,
                Object.entries(f.properties).flatMap(([k, v]) => [keys.indexOf(k), values.indexOf(v)]),
              );
              const commands: number[] = [];
              let x = 0,
                y = 0;
              const zig = (n: number) => (n << 1) ^ (n >> 31);
              for (const path of f.paths) {
                if (!path.length) continue;
                commands.push(9);
                path.forEach((pt, i) => {
                  if (i === 1) commands.push(((path.length - 1) << 3) | 2);
                  const nx = Math.round(pt[0] * 16),
                    ny = Math.round(pt[1] * 16);
                  commands.push(zig(nx - x), zig(ny - y));
                  x = nx;
                  y = ny;
                });
                if (f.type === 3) commands.push(15);
              }
              w.writePackedVarint(4, commands);
            },
            feature,
          );
      },
      null,
    );
  return output.finish();
}
