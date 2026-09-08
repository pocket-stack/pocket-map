# Screenshot provenance

## San Francisco, 2026-09-08

The three `sf-*-3ds.png` images in the README come from the **native Nintendo
3DS executable running in Azahar 2125.1.2**, with Vulkan and a 1× internal
resolution. They are emulator captures, not photographs of a console and not
Wasm screenshots. [sf-captures.json](sf-captures.json) records the app/runtime
commits, native binary hash, camera coordinates, provider counts, raw framebuffer
hashes and published PNG hashes.

| Image | Camera latitude | Longitude | Display zoom |
| --- | ---: | ---: | ---: |
| Union Square | 37.7879 | -122.4075 | 15 |
| Ferry Building / Embarcadero | 37.7955 | -122.3937 | 16 |
| Golden Gate Park | 37.7694 | -122.4862 | 15 |

The capture build uses the production `app/main.tsx` entry and its components.
The Mac provider sets `map.info.home` to each listed camera position and disables
predictive HTTP demand for the capture. It fetches real Shortbread MVTs from
VersaTiles through the normal provider and SQLite cache. No terrain or labels
are substituted with fixtures. The viewport is allowed to settle before frame
600 is read back; all recorded provider responses succeeded.

The native host's `POCKETJS_CAPTURE` path performs a GX display transfer from
each PICA render target. Its raw records are decoded with the rotation and
channel-order conversion used by `runtime/tests/e2e/azahar.ts`. **The published
400×480 PNG stacks the unscaled 400×240 top screen and 320×240 bottom screen**,
with the bottom screen centered between white margins. No UI or map pixels are
painted over. Capture timing does not measure physical-device performance.

The capture build can be prepared after the normal build has written
`dist/plan.json`:

```sh
POCKETJS_CAP_START=600 POCKETJS_CAP_N=1 bun runtime/tools/3ds.ts \
  --plan=dist/plan.json --project-root=. \
  --outdir=.local/native-sf/guest --package-outdir=.local/native-sf/guest \
  --capture
```

Use a separate emulator SD directory containing the app's pairing key at
`pocketjs/offload/c7771f0167312c63.key`. Run the Mac provider against
`127.0.0.1`, return the selected camera position in its map metadata, then launch
the capture executable in Azahar. Read both `pocketjs-captures/*f0600.raw` files
after its `done` marker appears. The capture session used a separate SD directory
and restored the existing emulator configuration afterwards. Raw frames, keys,
downloaded tiles and working caches stay ignored.

## Ocarina of Time, 2026-09-08

`oot-hyrule-field-3ds.png` uses the same native Azahar/Vulkan capture path,
production UI, unscaled screen composition and frame-600 readback described
above. The separate emulator SD directory contains only `oot.prp` and its
prepared terrain pack. **No Mac provider runs for this capture.** The native SD
worker opens the bootstrap after the missing Hyrule probe, loads RGB565
textures, and displays Hyrule Field at the atlas's default camera. Dynamic
labels are absent because they require the Mac provider.

[oot-capture.json](oot-capture.json) records source and runtime revisions,
binary and pack hashes, camera coordinates, raw framebuffer hashes and the
published PNG hash. This proves native emulator startup and SD rendering;
it is not a physical-controller test or performance measurement. Use the
same build command with `.local/native-oot/guest` as its output directory and
install the OoT files under the emulator's `pocketjs/assets/c7771f0167312c63/`.

## Other images

- `psp-map.png`, `psp-keyboard.png` and `psp-hyrule.png` are earlier physical PSP
  framebuffer captures. See [PSP validation](../PSP.md).
- The earlier `vector-*.png`, Hyrule dual-screen images and interaction images
  were produced by the compiled guest running against the Wasm core. They are
  retained as historical visual references and are not console photographs.

OSM data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright).
Hyrule artwork belongs to Nintendo; see the README for its pinned source.
