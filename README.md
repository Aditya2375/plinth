# Plinth

Carve a 3D shape out of photographs. Plinth takes silhouettes of an object from around a turntable, cuts a block of voxels down to the biggest shape that fits inside every one of them (the visual hull), then turns it into a smooth, photo-coloured mesh. It runs entirely in the browser.

Live: https://aditya2375.github.io/plinth/

## What it does

- Five demo objects (vase, mug, stool, teapot, rook) are photographed by a small ray marcher, so the true shape is known and the result can be scored against it.
- Each photo is cut out of its backdrop (border-based noise threshold, speckle clean-up, largest blob).
- Voxels that fall outside any silhouette are removed, view by view. You can scrub the carve and watch a top-down slice lose a wedge per photo.
- The blocky surface becomes a smooth closed mesh (blurred occupancy field plus surface nets). Each vertex is coloured from the photos that can see it, using a per-view depth buffer.
- Scored against ground truth on the demos: overlap with the true shape, and mean distance of the mesh to the true surface.
- Export GLB, OBJ or PLY (all with vertex colours), or PLY points.
- Bring your own object: drop six or more turntable photos, or one video of a full turn.

## What it cannot do

A visual hull is never smaller than the object. Hollows and dents are invisible to silhouettes, so the demo mug comes out filled in: its overlap with the true shape stays near 40%. Shiny, transparent or backdrop-coloured objects will not cut out cleanly, and shadows are read as object. Photos must be evenly spaced over 360 degrees with a fixed camera; Plinth does not estimate camera poses.

Numbers from the test suite (36 views, 64 cubed grid unless noted; the page defaults to 96 cubed, teapot about 97% overlap, mean surface error about 0.4 to 2.3% of the object radius across the demos, the mug being worst): vase about 97% overlap with the true shape, rook about 83%, stool about 82% with two camera heights and about 59% with one.

## Run it

No build step.

    python3 -m http.server 8000
    # open http://localhost:8000

## Test it

    npm test                                    # 20 core tests, no browser, no install needed
    npm install && tools/make-fixtures.sh /tmp/fx
    node test/ui.mjs http://localhost:8000/ /tmp/fx   # browser checks, needs Chrome and ffmpeg

## Layout

    src/core/    camera, segmentation, carving, smooth mesh, synthetic objects, exporters (no DOM)
    src/app/     viewer, contact sheet, slice diagram, file loaders
    vendor/      three.js r170 (MIT) and its OrbitControls
    assets/fonts Schibsted Grotesk and IBM Plex Mono (SIL OFL 1.1)

The page ships a strict Content-Security-Policy: no network access, no inline script, files are read in the tab and never uploaded.

## Licence

MIT. See LICENSE. Third-party notices: vendor/THREE-LICENSE.txt and assets/fonts/OFL-*.txt.

## Tried and dropped

Two ideas were built, measured and removed because they did not work. Photo-consistency carving (cutting surface voxels whose colour disagrees between views, to dig out cavities) removed true surface as often as empty space and left the mug at about 40% overlap. Estimating camera height from the silhouettes alone was flat for round objects, so it could not tell a 8 degree camera from a 35 degree one.
