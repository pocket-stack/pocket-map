import { Database } from "bun:sqlite";
import { inflateRawSync } from "node:zlib";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
const root = resolve(import.meta.dir, ".."),
  runtime = resolve(process.env.POCKETJS_RUNTIME ?? resolve(root, "runtime"));
const { createResourcePack, prepareTiledRGB565 } = await import(
  `${runtime}/tools/resource-pack.ts`
);
const db = new Database(resolve(root, ".local/hyrule/atlas.sqlite"), {
  readonly: true,
});
const manifest = JSON.parse(
  (
    db.query("SELECT value FROM metadata WHERE key='manifest'").get() as {
      value: string;
    }
  ).value,
);
if (
  manifest.format !== "pocket-map-atlas-rgb565-v1" ||
  manifest.tiles !== 21845 ||
  !/^[a-f0-9]{16}$/.test(manifest.info?.source ?? "") ||
  manifest.info.space !== "planar" ||
  manifest.info.minZoom !== 0 ||
  manifest.info.maxZoom !== 7
) {
  db.close();
  throw Error("Unsupported Hyrule atlas");
}
const out = resolve(root, ".local/3ds");
mkdirSync(out, { recursive: true });
const name = `hyrule-${manifest.info.source}-v1`,
  pack = createResourcePack(resolve(out, `${name}.prp`), 21846);
try {
  pack.add(Buffer.from(JSON.stringify(manifest)));
  const query = db.query("SELECT pixels FROM tiles WHERE z=? AND x=? AND y=?");
  for (let z = 0; z <= 7; z++) {
    for (let y = 0; y < 2 ** z; y++)
      for (let x = 0; x < 2 ** z; x++) {
        const row = query.get(z, x, y) as { pixels: Uint8Array } | null;
        if (!row) throw Error("Missing atlas tile");
        const pixels = inflateRawSync(row.pixels, { maxOutputLength: 131072 });
        const index = pack.add(prepareTiledRGB565(pixels, 256, 256), {
          width: 256,
          height: 256,
        });
        if (index !== 1 + (4 ** z - 1) / 3 + y * 2 ** z + x)
          throw Error("Invalid tile order");
      }
    console.log(`SD atlas level ${z} complete`);
  }
  const receipt = { ...pack.finish(), name, source: manifest.info.source };
  const bootstrap = createResourcePack(resolve(out, "hyrule.prp"), 1);
  try {
    bootstrap.add(Buffer.from(JSON.stringify(manifest)));
    bootstrap.finish();
  } catch (error) {
    bootstrap.abort();
    throw error;
  }
  await Bun.write(
    resolve(out, "manifest.json"),
    JSON.stringify(receipt, null, 2),
  );
  console.log(receipt);
} catch (e) {
  pack.abort();
  throw e;
} finally {
  db.close();
}
