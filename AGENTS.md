# Pocket Map

- Framework transport, resource lifecycle and tile geometry belong in PocketJS.
- Keep network requests, SQLite, image decoding and rasterization in the Mac worker.
- Bound guest tile demand, pending responses, native image staging and GPU residency.
- Import PocketJS APIs from `@pocketjs/framework/*`, Solid primitives from `solid-js`.
- Keep pairing keys, cached tiles, user searches and raw replay captures out of Git. Curated public demo images belong in docs/images/.
- Run the app's explicit tests; do not discover tests through the runtime submodule.
- Publish validated changes as a Draft PR with a Conventional Commits title.
