# Validation

## Local execution

- Eleven app tests cover Mercator wrapping, immediate controller motion while IO
  waits, keyboard submission, menu ownership, HTTP validators, cache limits,
  duplicate requests, pixel order, invalid image dimensions and bounded search
  results, including a real Bun HTTP 304 cache revalidation. Saved-place tests reopen SQLite, replay committed writes, reject
  operation-ID reuse, paginate, rename and delete. Atlas tests check pixel bytes,
  cache reuse, FTS search, planar bookmarks, invalid addresses and corrupt data.
  Legacy bookmark migration preserves entries and operation receipts. TypeScript checks pass.
- The compiled guest ran 1,591 simulated frames against a synthetic provider.
  Replay covers real auxiliary hit testing, keyboard input, result selection,
  placing a pin, touch inertia, animated zoom, 180 frames with replies withheld,
  disconnect/reconnect, date-line navigation and menu presentation.
- Observed replay maxima: three pending guest requests, 40 resident tile
  entries and three native-image staging tickets (the pool limit is eight). Staging drains to zero after
  navigation settles. Generated receipts are in `dist/qa/replay.json`.
- Live OSM DE tiles and Photon search passed through the same compiled guest
  and resource API in the earlier geographic-provider check. That live check
  requests one viewport and one submitted query; it performs no pan scan. The
  README now shows the compiled guest using the complete local Hyrule atlas.
- QuickJS passed 1,084 frames in each of the geographic and Hyrule modes with a 128 KiB stack, including offline mount,
  resource reveal, sustained panning, both zoom directions, local typing,
  search, place navigation and reconnect. Texture tickets drained to zero.

## Native boundaries

The 3DS package builds with the pinned PocketJS ARM toolchain. Framework tests
exercise production `offload.c` through POSIX socket/thread shims, compare all
bytes of a 256×256 image, verify staging release and reconnect after realm
reset. ASan/UBSan cover 4,000 concurrent images with bounded credit, malformed
envelopes and token reuse. This verifies transport code; it does not emulate
libctru or PICA200 timing.

The production `.3dsx` and an app-specific pairing key were uploaded through
ftpd and read back for equality. The install receipt, package digest and target
path are recorded in ignored `dist/qa/deploy.json`. The slot is
`c7771f0167312c63`, derived from `dev.pocket-stack.map`.

**The physical device has connected and is returning frame telemetry.** A
stable interval reported 119–120 frames per two-second sample. The earlier
session recorded CPU frames above 16,667 microseconds and a lifetime maximum
of 263,387 microseconds. These counters do not identify which input caused a
frame or prove continuous 60 fps. The first device build remounted overlapping
tile components at window changes; the revised model retains their identities.

The user physically confirmed the first build was usable, then requested
more caching, drag smoothing, layout changes and saved places. The revised
replay covers those flows, including lost-acknowledgement retries and a resident
prefetched tile becoming visible. Physical gesture and frame-time validation
of this revision remain pending. Build, native transport, Wasm visuals, device liveness and physical
input remain separate evidence.

## Device disconnect investigation

The uploaded revision lost its Mac daemon after a Bun 1.3.14 native crash on a
Worker thread. Session diagnostics added during recovery then recorded
`device response backlog exceeded` and request-credit exhaustion during tile
churn. The previous transport closed the socket at those limits, terminated
the active Worker and exposed the daemon to a native teardown crash.

The fix uses a separate capability process, pauses transport input/output when
credit is occupied and preserves device reservations for cancelled sent work.
A native transport test covers both execution modes. Fault tests kill a child
process, disconnect eight times during fetch, trigger a wedged-task deadline,
and drain a paused receiver's burst of 64 full-size images without losing its
connection. An app test runs the actual PNG provider across three interrupted
fetches, then verifies every pixel of a returned 256px image. UI replay and
QuickJS checks cover the revised guest cancellation semantics.

The revised Mac daemon is running with process isolation and socket
backpressure and has reconnected to the physical 3DS. The guest patch preserving
transmission credit passes replay / QuickJS checks and was uploaded through
ftpd with byte-for-byte readback: 1,686,296 bytes, SHA-256
`cafcdcc0112c8bde54935f3105852c1d3eb582a5feab264cbeda143b515d1e13`.
The Hyrule deployment below supersedes this binary.

A subsequent source inspection found that `POCKETJS_OFFLOAD` excludes both
native development-server initialization and package storage. The existing
pairing key alone does not enable guest updates in this build. Earlier claims
that `bun run update` was ready for Pocket Map were incorrect; the unsupported
command has been removed. Guest fixes still need an ftpd/native deployment.

## Complete Hyrule atlas and latency correction

Preparation downloaded the pinned Zelda Dungeon source and generated all
21,845 textures (zoom 0–7) plus 2,576 searchable places. The completed SQLite file
is 591,581,184 bytes. A full verification inflated every texture to exactly
131,072 bytes, checked per-level counts and passed SQLite integrity checking.
The receipt is `dist/qa/hyrule-atlas.json`; source revision is
`d32a85656031d861cef38e32eb927a7d08a983a9`. Assets and databases are ignored.

The Hyrule compiled-guest replay passes 11 checks across 1,001 frames using that
complete database. It searches Kakariko, navigates to the result, fits the finite
world without wrapping, holds image responses for half a second, enters a
prefetched tile and settles after sustained panning. Maxima remain three active
requests, 40 resident entries and three staging tickets. All tickets drain;
HTTP downloads remain zero. The OSM replay also passes all 27 checks after the
bookmark migration. Receipts are `dist/qa/hyrule.json` and `dist/qa/replay.json`.

Two regressions demonstrated failures before the framework correction:

- A blocked image write serialized new provider work. The revised connection
  overlaps reads with writes inside eight total executing/queued/writing slots.
  A deterministic socket fixture admits eight jobs while its first write waits,
  then drains 20 images without disconnecting.
- A still-desired prefetch was cancelled before transport availability was
  checked. It now remains useful while a replacement cannot be admitted; its
  completed texture is reusable without sending the same tile again.

The 49 affected resource/offload tests and eight tile-geometry tests pass, as
does framework TypeScript. Geometry coverage includes changing a live camera
from wrapping geographic bounds to a finite atlas and rejecting invalid bounds
without partially mutating camera state.

The Hyrule native build was uploaded to `192.168.8.102:5000` and read back equal:
1,689,576 bytes, SHA-256
`31033e5d9d3ef06ff247fd2c85d42b8d64cfd656f5c77d328fd4ba1cea0eca1f`.
The paired Mac is running the local atlas provider. Its connected-device trace
sample contains 375 tile requests: atlas work median/p95 1/1 ms, provider
round-trip median/p95 2/2 ms and zero HTTP downloads. Socket drain waits have
median/p95 353/434 ms over 374 writes. These are host-side measurements, not
render or input latency; each image still sends 128 KiB over the LAN.

Earlier OSM traces had both cached 1–4 ms provider work and uncached work taking
seconds. The source's documented per-IP speed allowance means absence of HTTP
429 does not rule out throttling. The complete local atlas removes that external
service dependency. It does not establish the 3DS bandwidth limit or continuous
60 fps. The new device session has returned frame telemetry and image requests;
physical gesture acceptance remains separate from liveness and replay results.

## Directional navigation, live sources and labels

The next revision passes 14 app tests and TypeScript. New cases exercise
repeated diagonal strokes separated by pauses, reversal/expiry, local next-level
prediction, OSM's four-tile same-level cap, the ZL chord without camera panning,
source restoration and delayed bookmark receipts routed to their original map.
Marker tests cover zoom/category filtering, reply limits and invalid windows.
Ten framework tile tests and framework TypeScript pass, including equivalent
30/60 Hz directional histories and camera zoom-target exposure.

The compiled guest passes 20 Hyrule replay checks across 1,713 frames and all
27 geographic checks across 1,591 frames. New replay coverage uses actual lower
surface hit testing for repeated strokes and source switching, ZL zoom/rail
mounting, next-level demand, real indexed labels and category selection. The
OSM provider used during switching is synthetic: no public-service stress scan
runs. Maxima remain three pending requests, 40 tile entries and three staging
tickets. Hyrule made zero HTTP downloads; the synthetic OSM adapter served eight
tile fetches. All staging tickets drained.

QuickJS passes 1,272 frames per startup provider at a 128 KiB stack, including
marker components, ZL, source/filter panels and switching both ways. The native
package includes all nine annotation icons, with the correct power-of-two
image envelopes. Wasm captures were visually checked for the labels, zoom rail,
source picker and category picker. Native build and readback do not substitute
for physical gesture or frame-time acceptance of this revision.

The navigation build was uploaded and read back equal: 1,720,504 bytes; SHA-256
`348e614c1016fceb175d701bd3ae14294f817367f326d13493473488e16a1e2a`.
The Mac daemon now exposes both maps through source-identified requests.

## Vector OSM reconstruction

The default OSM provider now uses Shortbread MVTs. Hyrule's existing raster
atlas, marker index, bookmarks and source switching remain available. See
[VECTOR_MAP.md](VECTOR_MAP.md) for the execution split and measurement scope.

- 18 application tests / 161 assertions pass, including holes, clipping,
  dense geometry, HTTP deduplication, overzoom source reuse and provider policy.
- Framework resource/offload regression: 64 tests / 682 assertions; the final
  targeted image/mesh/offload suite also passes 22 tests / 140 assertions,
  including the added consumer-exception cleanup case.
- Rust core: 131 tests pass, including malformed geometry, stale handles and
  transformed/clipped TRI output.
- Synthetic MVT compiled-guest + Wasm replay: 1,403 frames, 13 checks; delayed
  responses, disconnect, search, Hyrule raster switching and return to vector.
- Real San Francisco replay: 453 frames. Four MVTs become 107,464 wire bytes of
  prepared geometry, versus 524,368 bytes for four old raw image records.
  Additional display zooms z15–18 send zero terrain bytes; label JSON and Unicode
  images remain separate traffic. Receipts include those costs.
- Existing complete-Hyrule compiled replay: 1,713 frames, 20 checks.
- QuickJS at 128 KiB stack: both startup modes pass 1,272 frames and release all
  staging tickets. Wasm screenshots were inspected for geometry, holes, fixed-size
  labels, CJK text and source switching.

Native `.3dsx` builds pass with the pinned nightly and devkitPro image. These
checks establish build, protocol, resource and pixel behavior. Real 3DS input
and frame-time acceptance of the vector revision remain pending; Wasm CPU
numbers are not a hardware frame-rate claim.

The vector build was deployed through ftpd and read back byte-for-byte equal:
1,736,564 bytes, SHA-256
`2f33588ba2b1081f8c86146300b5210f39b1239fa155688c20f478d04bb64130`.
The Mac daemon starts OSM by default and keeps Hyrule available through the
source picker. Transfer verification does not establish physical interaction
or a measured frame rate.

## Vector CPU baseline and retained GPU revision

The first vector build was uploaded and connected to the physical device.
Although terrain bandwidth decreased, warm vector views often advanced only
40–60 frames per two-second telemetry interval. Many intervals recorded every
frame above 16.67 ms, including periods without new tile requests. This fails
the intended frame budget and is not evidence of continuous 60 fps.

That build expanded and clipped every triangle on the CPU each frame. The
revised 3DS backend materializes immutable GPU buffers once and emits bounded
handle/transform/clip commands during navigation. Its telemetry splits UI/core,
frame preparation and submission durations. Core tests cover backend opt-in,
transform scaling, opacity fallback, off-screen culling and stale mesh handles.
The native build and app checks pass. This revision was uploaded to
`192.168.8.102:5000` and read back equal: 1,740,768 bytes, SHA-256
`fd9f701d9159aedc8a2e45ffa0aa9e98f0e5fc4d888e6ccca816a2033dd8a135`.
Physical timing remains pending interaction with this binary.
