# Validation

## Local execution

- Nine app tests cover Mercator wrapping, immediate controller motion while IO
  waits, keyboard submission, menu ownership, HTTP validators, cache limits,
  duplicate requests, pixel order, invalid image dimensions and bounded search
  results, including a real Bun HTTP 304 cache revalidation. Saved-place tests reopen SQLite, replay committed writes, reject
  operation-ID reuse, paginate, rename and delete. TypeScript checks pass.
- The compiled guest ran 1,591 simulated frames against a synthetic provider.
  Replay covers real auxiliary hit testing, keyboard input, result selection,
  placing a pin, touch inertia, animated zoom, 180 frames with replies withheld,
  disconnect/reconnect, date-line navigation and menu presentation.
- Observed replay maxima: three pending guest requests, 40 resident tile
  entries and three native-image staging tickets (the pool limit is eight). Staging drains to zero after
  navigation settles. Generated receipts are in `dist/qa/replay.json`.
- Live OSM DE tiles and Photon search passed through the same compiled guest
  and resource API. Captures in this README are from that Wasm replay. The live
  check requests one viewport and one submitted query; it performs no pan scan.
- QuickJS passed 1,084 frames with a 128 KiB stack, including offline mount,
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
backpressure and has reconnected to the physical 3DS. The current guest patch
preserving transmission credit is built and passes replay / QuickJS checks;
its upload and physical interaction acceptance require ftpd to be opened.
