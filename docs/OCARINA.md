# Ocarina of Time atlas

Pocket Map includes Ocarina of Time as a third source alongside OpenStreetMap
and Breath of the Wild. **The existing PocketJS image collections and SD worker
load this atlas without framework changes.**

## Prepare and install

```sh
bun run prepare:oot
bun run prepare:sd --map=oot
bun run 3ds
# Keep ftpd open until upload and complete readback finish.
bun run deploy:sd 192.168.8.102 --map oot
bun run deploy 192.168.8.102
bun run host 192.168.8.102 --oot
```

Exit ftpd, launch Pocket Map, then tap the map name on the lower screen and
choose **Ocarina of Time**. Hold R and choose **Switch map** to open the same
chooser with hardware buttons. Search accepts region names such as **Kakariko**
and **Forest Temple**, or room names such as **Slingshot Room**. Searches and
saved places run on the Mac. Each atlas has a separate bookmark database.

The app checks `hyrule.prp` and `oot.prp` once during startup. Installed atlases
remain selectable without a paired Mac. A legacy Hyrule installation still
opens first; an OoT-only installation opens OoT. Switching between installed
atlases restores each camera and pin. OSM requires the paired provider.
Offline terrain navigation does not provide offline search or bookmarks.

The generated OoT pack is **140,997,952 bytes (134.47 MiB)**, with 21,845 images
and one metadata record. Installation uses the same app asset directory as
Hyrule, with separate `oot-<source>-v1.prp` and `oot.prp` filenames. The installer
uploads a temporary file, reads the entire file back, compares SHA-256, then
activates the pack and its bootstrap. Interrupted uploads can resume; use
`--restart` if verification reports corruption. Hyrule's files are preserved.

Raw sources live in `.local/oot-source/repo`, the Mac atlas and search index in
`.local/oot`, and prepared SD files in `.local/3ds/oot`. All are ignored by Git.
Python is needed for the FTP installer; preparation and the Mac provider use
Bun. PSP receives this same atlas through its existing USB image provider;
its build does not read 3DS resource packs.

## Source and coordinates

The input is [Ecksters' OoT Interactive Map](https://ootmap.com/), pinned to
[commit 020dab1](https://github.com/Ecksters/OoT-Interactive-Map/tree/020dab1b787bc18d1990653817765a1024bad43d).
The map project credits **Peardian** for its assembled images and Nintendo
owns the game artwork. The repository's MIT license applies to the map project;
Pocket Map does not redistribute the downloaded tile set or relicense the
game artwork. The attribution remains visible on the map.

This integration uses **Child Angled View**, including the dungeon layouts
placed around the overworld. Adult and top-down variants are not included.
These are an arranged reference atlas, not one continuous in-game surface or
a live player-position feed.

Upstream tiles use Leaflet Simple CRS at levels 8–15. Pocket Map maps them to
levels 0–7 and converts coordinates with `x = longitude * 256` and
`y = -latitude * 256`. Thus a point addresses the same pixels at every level.
The original rectangular extent is padded with black tiles to complete the
square pyramid. The baker verifies every expected source tile before treating
padding as empty terrain. The scale bar counts source-image units, not metres.

The build parses the literal scene table without executing downloaded
JavaScript. It indexes **93 regions and 363 rooms**; search opens the largest
mapped polygon section for each area. Region labels appear from level 2 and
room labels from level 6, subject to the existing label-density budget.
Mac preprocessing converts PNGs to RGB565 and builds SQLite FTS and spatial
indices. SD preparation applies PICA texture layout and independently
compresses each record. The guest only requests identified resources.

## Validation

The explicit app suites cover three-source request routing, independent saved
place retries, coordinate conversion, variable atlas depths, legacy Hyrule
bootstrap compatibility, offline switching and camera restoration. Compiled
guest replays use the actual OoT atlas for search, map navigation and source
switching. Native and replay captures distinguish emulator rendering from
physical-device interaction. Generated packs are checked by inflating every
record and validating its CRC before upload.
