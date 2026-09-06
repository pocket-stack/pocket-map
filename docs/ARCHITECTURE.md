# Pocket Map architecture

## Ownership

**The 3DS guest has one JavaScript thread and no network or filesystem calls.**
Its state consists of a camera, two tile-layer descriptions, a bounded search
page, local keyboard text, saved-place pages and a selected place. Solid owns components and
subscriptions. Continuous camera movement writes paint transforms through
PocketJS `hot` APIs; a tile window change updates the component tree.

The native offload worker owns sockets, the SD pairing-key read and binary
reception. The paired Mac's worker owns HTTPS, SQLite, PNG decoding, optional
Unicode label rasterization and R5G6B5 packing. Provider socket callbacks pass
bounded requests and replies; they do not execute these capabilities.

## Working set

| Budget | Limit |
| --- | --- |
| Active resource requests | 3 |
| Resource starts / materializations | 1 / 1 per frame |
| Tile collection | 40 entries, two view owners |
| Tile demand per view | 16 addresses (up to 12 visible + 4 look-ahead) |
| Native image staging | 8 × 131,088 bytes plus metadata |
| Native image envelope | 16–256px power-of-two sides, two bytes per pixel |
| Native image uploads | 1 per frame |
| Places per search | 5 |
| Saved places | 1,000 on Mac; four five-place pages cached on device |
| Saved-place name | 36 UTF-16 code units |
| Query text | 80 UTF-16 code units |
| Unicode label collection | 5 × 256×32 images |
| Mac concurrent tile decodes | 3 |
| Mac decoded-image cache | 64 entries, honoring HTTP expiry |
| Mac HTTP cache | 2,048 bounded responses in SQLite |

The image collection reserves 18 bytes per pixel plus 512 bytes per entry:
native staging, old-plus-new core/GPU storage, the tiled upload scratch buffer
and the serialized ticket. Forty steady resident 256px tiles account for
about 15 MiB of core R5G6B5 plus GPU RGBA8 pixels; native staging, upload scratch,
fonts, UI nodes and JavaScript use separate memory. This is an admission upper bound, not a claim that
every tile allocates that amount. JSON responses retain the 4,096-byte record
and 2,500-code-unit payload limits.

## One tile's lifecycle

1. The camera's current viewport produces near-first tile coordinates and
   up to four extra neighbors using a 64px margin and up to 128px directional
   lead (0.3 seconds of recent movement). Visible entries are pinned; extras
   have lower priority and are unpinned. The map
   wraps longitude, clips polar rows and attaches the provider source identity.
2. `createResourceView` declares desired keys. The collection merges both zoom
   layers' demand and reserves entry cost before starting an offload read.
3. The Mac resolves the named tile capability to its configured URL. It reads
   a fresh cached PNG or fetches one with HTTP validators, checks its 256px
   envelope, decodes it and packs opaque R5G6B5 pixels.
4. The 3DS worker receives binary pixels into a free native slot and publishes
   a small ticket. Socket reads pause when staging credit is exhausted.
5. The scheduler materializes one completed resource per frame. The native
   upload consumes no JS pixel array; `ResourceImage` replaces its fallback.
6. `releaseResponse` returns staging credit. Texture disposal waits until
   cache eviction or invalidation with value removal. A cancelled or late
   response also returns staging credit without an upload.

**Rendering a resource does not request it.** Demand, subscriptions and
ownership have different roles. An old zoom layer retains loaded resources
while the new layer demands current tiles. It never requests an unseen parent
pyramid or downloads a city in advance.

## Motion and recovery

`createTileCamera` stores level-zero coordinates and log2 zoom. Dragging applies
screen-space deltas at the current scale. `createDragFilter` filters cumulative
touch travel with a 1px hysteresis and up to 3px additional lag. Fast motion
reduces filtering; stationary frames settle release velocity. The 1.45 touchpad
gain maps that 4px input-space bound to 5.8px on the map. Circle Pad movement approaches a
velocity; release follows exponential inertia. Zoom runs an anchored 180ms
transition. The integrator gives matching held-input/fling distances at 30 and
60 Hz. Mercator projection is application code.

Tile positions are rebased near the viewport before reaching native float
transforms, including the nearest world copy at the date line. Tile enumeration
has a hard maximum; a mismatched old level cannot create an unbounded loop.

On connection-generation changes, pending reads are cancelled and current
demand is revalidated. Resident tiles remain visible. An explicit source change
clears tiles, because the old source is a different identity. Exhausted tile
retries have a visible error fallback and an R-menu retry action. Search errors
and empty results have distinct messages; editing and submitting retries a
query. Local camera and query changes never wait for responses.

## Framework additions

PocketJS receives binary image responses, native staging ownership, the
`releaseResponse` cache hook, `createOffloadImageCollection`, and the camera /
visible-window / look-ahead functions in `tile-viewport`, and `createDragFilter`
in `gesture`. There is no OSM, Photon, Mercator,
search-history or map-service policy inside the framework. These APIs can
support image pages, photo renditions or diagram tiles using different keys
and demand plans.

The image extension retains offload's authenticated LAN connection and JSON
control frames. It does not turn the older companion SVC socket API into a
worker API. Other native hosts still need to implement optional image staging
operations; an in-process iPhone provider is not part of this implementation.

## Saved-place commands

A fourth resource collection owns four five-place SQLite pages. Selection,
name editing, pagination and delete confirmation belong to the app controller.
**Writes bypass the resource cache.** `bookmarks.command` carries a bounded
operation ID and typed save / rename / remove payload. The Mac commits the
change and its receipt in one SQLite transaction. Repeating that operation ID
returns the stored result; using it with another payload is rejected. Receipts
remain after deletion, so delayed save retries cannot recreate deleted data.

The UI waits for confirmation before changing its saved list. Missing replies
leave a retry action which retains the operation ID. Cancellation of that UI
cannot roll back a completed Mac write. Successful writes invalidate saved
pages; deleting the last row of a page makes the provider return the preceding
populated page. User data lives in `places.sqlite`; HTTP-cache eviction never
touches it. The Mac performs all SQL work in its provider worker.

## Scope

This app implements map browsing, place search and saved places. It has no GPS location,
turn-by-turn routing, satellite layer or offline-area downloader. Cached views
are a latency optimization. The public demo services are replaceable through
host configuration and have no availability guarantee. Network isolation and
bounded work do not establish a hardware frame-time guarantee.
