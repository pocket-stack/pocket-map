# Hyrule on the 3DS SD card

The optional SD pack stores the complete Hyrule terrain atlas on the console.
**Panning and zooming can load new terrain without a paired Mac**, including
at startup. OSM vectors, place search, bookmarks and dynamic marker labels
retain their Mac providers. The PSP build retains its USB image path.

```sh
bun run prepare:hyrule
bun run prepare:sd
bun run 3ds
# Keep ftpd open for this one-time large transfer and its full readback.
bun run deploy:sd 192.168.8.102
bun run deploy 192.168.8.102
```

Exit ftpd and open Pocket Map. The SD bootstrap opens Hyrule directly; the Mac
connection adds search, saved places and the source chooser. The normal
`bun run host` command remains unchanged. A missing local image can fall back
to the paired Mac. Without an installed pack, the original host path remains
available. No downloaded artwork, SQLite database or generated pack is committed.

The installer uploads to a temporary filename, supports resuming after a
disconnect, checks the complete file by SHA-256 readback, and only then activates
it. A small bootstrap pack is activated after the terrain file. Keep ftpd
running during both upload and verification; rerun the same command after an
interruption. The default location is
`/pocketjs/assets/c7771f0167312c63/`. Changed atlas revisions get distinct names.
If verification reports a mismatch, the installer does not activate a replacement.
`dist/qa/sd-verify.json` records the received size, hash and first differing byte.
Use `bun run deploy:sd <3ds-ip> --restart` to replace the temporary copy from
byte zero and repeat verification; an existing active pack stays in place until
the replacement passes.

## What changes

| Stage | Paired Mac raster path | Prepared SD path |
| --- | --- | --- |
| Tile location | Mac SQLite and memory cache | One indexed file on the console |
| Tile pixels reaching the console | 128 KiB raw RGB565 over Wi-Fi | Independently compressed prepared RGB565 from SD |
| Image preparation | 3DS converts and reorders pixels for upload | Mac bakes PICA channel order and tiled layout |
| Per-resident-tile pixel storage | 128 KiB core pixels + 256 KiB GPU RGBA8 | 128 KiB GPU RGB565, no retained core pixels |
| Blocking operations | Network worker; conversion on render path | SD seek/read and zlib inflation on an SD worker |
| UI materialization budget | One image or mesh per frame | Same shared one-per-frame budget |
| Guest cache and prefetch | 40 tiles; directional prediction | Same policy and capacity |

For the pinned atlas revision, the generated terrain file contains **21,845
tiles across zoom levels 0–7**, plus metadata. It is **370,952,504 bytes
(353.77 MiB)**. Compressed terrain records have a 14,000-byte median, a
44,381-byte 95th percentile and an 80,077-byte maximum. Every record has been
decoded and CRC-checked locally. RGB565 channel order and tiling were also
compared with devkitPro tex3ds 2.3.0 using a color-grid fixture and the renderer's
vertical origin; all 512 texture bytes matched.

These are artifact and storage measurements. **A hardware latency multiplier
has not yet been established.** Removing a 128 KiB Wi-Fi transfer per miss is
expected to help substantially, but SD latency, inflation, scheduling and frame
presentation still contribute. A frame rate increase is not implied if the UI
already presents at 60 Hz. The intended benefit is less time showing missing
terrain while moving and less texture memory per resident tile.

The framework's optional `io.resource-pack` worker adds eight 128 KiB staging
slots, one compressed scratch buffer and a 32 KiB stack. It caches four file
handles and reads individual index records, without loading the whole atlas or
directory. The map declares identity and demand through
`createPackedImageCollection`; cancellation, fallback, native ownership and
eviction remain in PocketJS. A stalled SD read cannot make a guest filesystem
call wait, because the guest has no synchronous filesystem API.

## Repeatable device comparison

`bun scripts/benchmark-sd.ts` builds a separate **Pocket Map Storage Test**
binary at `runtime/dist/3ds/pocketmap-sd-benchmark.3dsx`. It uses the normal
app's asset slot but does not replace its production entry. Install that
binary with `bun run deploy <3ds-ip> --benchmark` after installing the pack. Stop the ordinary 3DS map host,
then run:

```sh
bun scripts/benchmark-sd.ts host 192.168.8.102
```

Launch the test entry and leave the controls untouched. It automatically runs
four cold views, alternating SD and Mac at each view, then an eight-second
diagonal pan for each storage path at 320 pixels/second. Both use the same
40-entry cache and prediction policy; dynamic annotations are disabled for
the comparison. Each cold view clears guest tiles. Each pan starts after its
initial view has loaded. The Mac's normal cache remains enabled, so this is
not a cold-disk comparison on the Mac.

Ten receipts append to ignored `dist/qa/sd-benchmark.jsonl`. They record native
wall-clock time to **resource-ready** terrain, frames, source actually used,
SD IO/inflate/upload counters, and pan fallback frames and intervals over
20 ms. GPU presentation follows resource readiness. A local leg that reports
`storage: "desktop"`, a timeout, or a pan distance far below 2,560 pixels is
not a successful SD comparison. Keep the Mac connected throughout the run;
the native host's usual `offload.metrics` log supplies separate frame CPU data.
The test returns to Hyrule after saving its receipts. Its automatic navigation
is absent from the production app.
