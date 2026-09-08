import { expect, test } from "bun:test";
import { project, unproject, wrapTile, scaleBar } from "../app/geo.ts";
test("Mercator round trips real cities, wraps longitude and clamps poles", () => {
  for (const [lat, lon] of [[37.7879, -122.4075], [35.6812, 139.7671], [51.5074, -0.1278], [-33.86, 151.2]]) {
    const point = project(lat, lon), back = unproject(point.x, point.y);
    expect(back.lat).toBeCloseTo(lat, 8); expect(back.lon).toBeCloseTo(lon, 8);
  }
  expect(project(0, 180).x).toBe(project(0, -180).x);
  expect(project(90, 0).y).toBeCloseTo(0, 8); expect(wrapTile(-1, 4)).toBe(15);
  const bar = scaleBar(37.78, 14); expect(bar.pixels).toBeLessThanOrEqual(70); expect(bar.pixels).toBeGreaterThan(15);
});
