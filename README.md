# Plinth

Carve a 3D shape out of photographs. Plinth takes silhouettes of an object from around a turntable and cuts a block of voxels down to the biggest shape that fits inside every one of them (the visual hull). It runs entirely in the browser.

Live: https://aditya2375.github.io/plinth/

## What it does

- Four demo objects (vase, mug, stool, rook) are photographed by a small ray marcher, so the true shape is known and the result can be scored against it.
- Each photo is cut out of its backdrop (border-based noise threshold, speckle clean-up, largest blob).
- Voxels that fall outside any silhouette are removed, view by view. You can scrub the carve and watch a top-down slice lose a wedge per photo.
- Surface voxels are coloured from the photos that can see them, using a per-view depth buffer.
- Export PLY points, a coloured PLY mesh, or OBJ.
- Bring your own object: drop six or more turntable photos, or one video of a full turn.

## What it cannot do

A visual hull is never smaller than the object. Hollows and dents are invisible to silhouettes, so the demo mug comes out filled in: its overlap with the true shape stays near 40%. Shiny, transparent or backdrop-coloured objects will not cut out cleanly, and shadows are read as object. Photos must be evenly spaced over 360 degrees with a fixed camera; Plinth does not estimate camera poses.

Numbers from the test suite (36 views, 64 cubed grid unless noted): vase about 97% overlap with the true shape, rook about 83%, stool about 82% with two camera heights and about 59% with one.

## Run it

No build step.

    python3 -m http.server 8000
    # open http://localhost:8000

## Test it

    npm test                                    # 13 core tests, no browser, no install needed
    npm install && tools/make-fixtures.sh /tmp/fx
    node test/ui.mjs http://localhost:8000/ /tmp/fx   # browser checks, needs Chrome and ffmpeg

## Layout

    src/core/    camera, segmentation, carving, synthetic objects, exporters (no DOM)
    src/app/     viewer, contact sheet, slice diagram, file loaders
    vendor/      three.js r170 (MIT) and its OrbitControls
    assets/fonts Schibsted Grotesk and IBM Plex Mono (SIL OFL 1.1)

The page ships a strict Content-Security-Policy: no network access, no inline script, files are read in the tab and never uploaded.

## Licence

MIT. See LICENSE. Third-party notices: vendor/THREE-LICENSE.txt and assets/fonts/OFL-*.txt.
