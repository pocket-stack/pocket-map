import { Database } from "bun:sqlite";
import { inflateRawSync } from "node:zlib";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { validAtlas, atlasPackName } from "../shared/atlas.ts";
import { ATLAS_KINDS, type AtlasKind } from "../shared/types.ts";
const kind = (process.argv.find(a => a.startsWith("--map="))?.slice(6) ?? "hyrule") as AtlasKind;
if (!ATLAS_KINDS.includes(kind)) throw Error("Use --map=hyrule or --map=oot");
const root = resolve(import.meta.dir, ".."),
  runtime = resolve(process.env.POCKETJS_RUNTIME ?? resolve(root, "runtime"));
const { createResourcePack, prepareTiledRGB565 } = await import(
  `${runtime}/tools/resource-pack.ts`
);
const db = new Database(resolve(root, `.local/${kind}/atlas.sqlite`), {
  readonly: true,
});
const manifest = JSON.parse(
  (
    db.query("SELECT value FROM metadata WHERE key='manifest'").get() as {
      value: string;
    }
  ).value,
);
if (!validAtlas(manifest)) {
  db.close();
  throw Error("Unsupported local atlas");
}
const out = resolve(root, kind === "hyrule" ? ".local/3ds" : `.local/3ds/${kind}`);
mkdirSync(out, { recursive: true });
const name = atlasPackName(kind, manifest.info.source),
  pack = createResourcePack(resolve(out, `${name}.prp`), manifest.tiles + 1);
try {
  pack.add(Buffer.from(JSON.stringify(manifest)));
  const query = db.query("SELECT pixels FROM tiles WHERE z=? AND x=? AND y=?");
  for (let z = 0; z <= manifest.info.maxZoom; z++) {
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
  const receipt = { ...pack.finish(), kind, name, source: manifest.info.source };
  const bootstrap = createResourcePack(resolve(out, `${kind}.prp`), 1);
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
