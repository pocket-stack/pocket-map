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

The device comparison below measures loading and frame callbacks separately.
Removing the Wi-Fi transfer and render-path pixel conversion reduces loading
time; it does not establish a 60 Hz presentation guarantee.

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

## Hardware result: 2026-09-07

One run on the user's physical 3DS completed all ten legs. Both binaries passed
byte-exact FTP readback. The installed terrain pack passed full SHA-256 readback;
restarting ftpd allowed its final rename after an earlier rename error. The
[measurement record](benchmarks/3ds-sd-2026-09-07.json) includes build identities,
artifact hashes, route coordinates, all ten receipts and the metric definitions.
The console variant and SD card model were not recorded.

| Cold view | Visible target tiles | SD ready | Mac ready | Mac / SD |
| --- | ---: | ---: | ---: | ---: |
| z4 | 3 | 150 ms | 895 ms | 5.97× |
| z6 | 6 | 346 ms | 1,651 ms | 4.77× |
| z7 | 4 | 435 ms | 1,174 ms | 2.70× |
| z5 | 4 | 240 ms | 990 ms | 4.12× |
| Mean | — | 292.75 ms | 1,177.50 ms | 4.02× |

**Mean time to ready terrain fell by 75.1%** with the same 40-entry guest cache
and prediction policy. The Mac cache was enabled. This is a guest-cache cold
comparison on four views, with SD preceding Mac at each view; it is not a
repeated-trial latency distribution or a cold-disk benchmark.

| Eight-second diagonal pan | SD | Mac |
| --- | ---: | ---: |
| Distance | 2,560.32 px | 2,564.80 px |
| Frame callbacks | 435 | 412 |
| Frame callbacks per second | 54.35 | 51.40 |
| Callbacks with target terrain not ready | 57 / 435 (13.10%) | 397 / 412 (96.36%) |
| Callback intervals over 20 ms | 80 | 114 |

"Not ready" means at least one visible tile at the target zoom level is not
ready. It does not mean the whole viewport is blank, and does not measure how
much a coarser fallback covers. Callback frequency is not a GPU presentation
measurement. **This run does not demonstrate sustained 60 FPS.**

The SD pan completed 63 worker reads and 61 texture uploads, with zero pack
failures. Worker IO totalled 1,410 ms and inflation 640 ms across those reads;
native texture registration/staging totalled 61.5 ms across the uploads. These
are accumulated operation times, not time spent blocking UI frames. Mac pan
performed no SD reads or uploads. A few cancelled SD reads finished during the
first three Mac cold-view legs, but produced no uploads there.

All SD legs reported local storage and all Mac legs reported desktop storage;
native pack failures remained zero throughout. The comparison kept the Mac
connected to collect results, so it does not verify an offline cold launch.
