/* The renderer: the whole background, in WebGL. Since W3 the only one -
   the Canvas 2D renderer is gone, and where WebGL cannot run main.js shows
   a still picture of the scene instead (assets/img/bg-still.webp, which
   _tools/make-still.js renders from this file).

   It draws the sun, the clouds, the floor, the backdrop ridges and the
   nearer peaks, the trees and the conifers, the three bodies and the
   cursor ring (THE FLOOR and THE SCENERY below).

   Why WebGL. Canvas 2D tessellated and rasterised every anti-aliased path
   again on every frame, and that held the page to about 33 fps on a 165 Hz
   display while its JS took only ~3 ms of each frame (audit F57): the
   sheet alone was 383 strokes and 2,100 lineTo a frame, the scenery
   another ~1,130 fills and ~134 strokes. Here everything is static meshes,
   built when the renderer starts and again only when the window's size
   changes, and a frame is a few uniforms and eight draw calls at most -
   the card's depth (THE CARD), the sun, the clouds, the floor, the ridges
   and peaks, the trees and conifers, the bodies and the ring. A whole
   frame's JS (main.js, the governor, the scene and this) takes 0.015-0.025
   ms a tick in headless Chrome, and this file's own code allocates nothing
   (_tools/check-webgl-smoke.js).

   The contract, with main.js:

     Bg.renderers.webgl = function (canvas, opts) {
       ...                               (null if it cannot run here)
       return { resize(W, H, res, top), draw(t, still), occlude(x0, y0, x1, y1), alive() };
     };

   resize gets the canvas box in CSS px (possibly fractional), the px per
   CSS px to draw at (the quality governor's resolution: governor.js) and
   the canvas's own, level 0's (min(dpr, 2); a tool that leaves it out
   gets a canvas at res). main.js calls it at the top of a frame, right
   before a draw, whenever the box or the resolution has changed, and never
   with a zero size; a resolution below top is drawn as THE LEVELS says.
   draw(t, still) paints one frame at scene time t (what
   Bg.advance or Bg.hold returned), from the scene (scene.js, window.Bg);
   still is true for the motion pause's still frame, which leaves the cursor
   ring out. draw does not change the scene at all: it reads the scene's
   state as it stands. After a frame throws, main.js resets the scene and
   calls resize again; draw sets every piece of GL state it uses on every
   frame, so a frame that stopped halfway leaves nothing behind. occlude
   says where the opaque card is (no arguments: nowhere), and alive whether
   the context is there and built.

   Sizes come from the scene, which scales the scenery with the window
   (Bg.S; scene.js, rescale): the bodies' size (bodiesAt), the trees' and
   conifers' h and w, the clouds' w and h, the peaks' half-widths, and line
   widths times Bg.SW. They are read, never the S = 1 values (the *0
   fields), and the scenery's meshes are built again for a new W, H or S
   (scenery): at once, in the first frame drawn at it, unless the last
   build for a new size was less than REBUILD_MS before, as it is over and
   over while a window is dragged. Then that frame and the ones after it
   draw the meshes they have, fitted to the new size in the vertex shader
   (FIT_GLSL: every x, height and length scaled as the scene's layout
   scales it), until they are built again. So one resize (maximising,
   rotating a phone, opening the devtools) is one adjustment, and a drag
   costs a build at most every REBUILD_MS. If that wait ends with the
   meshes still fitted, opts.onSettle, if given, is called, for a frame to
   build them (main.js passes its wake, so a paused page paints its still
   frame again). The floor depends on none of these: its mesh is the same
   at every size.

   THE FLOOR. One mesh over (sn, d): sn is the screen-normalised x the sheet
   is laid out in (x = centreX(d) + sn * W * PERSP_X, so xw = sn * d) and d
   the depth, on the rows' parametrisation (d = 1 + (DMAX - 1) * u^ROW_POW,
   every row exactly on a mesh row). The vertex shader puts
   each vertex where surfacePoint would: the whole wave (the swell, the
   swell event, the cursor's dents, the bodies' wells) and the projection.
   The fragment shader draws the rows and columns as lines, not geometry:
   it knows the (sn, 1/d) under each pixel and how fast they change
   (derivatives), so every line is a constant ~1 CSS px wide and anti-aliased
   however the sheet tilts, with the Canvas sheet's alphas - rows 0.60 * (1
   - dn * 0.55), columns 0.42 * (1 - dn * 0.5) - and none of its failure
   modes:

     - no dashes (audit F1: strokeSegmented dropped one segment in three of
       every column); a line here is a function of where the pixel is on
       the sheet, with no segments to drop;
     - no chords (G4.3: 27 px straight segments at 1440, 71 px at 3840, up
       to 5.4 px off the curve); the mesh is 384 steps across, and its rows
       and columns lie within 0.07 / 0.16 px of the true surface at 1440x900
       and 0.16 / 0.39 px at 3840x2160, where Canvas's sampling is 1.8 and
       4.4 px off (_tools/check-sheet-mesh.js);
     - no garbage and no strokes (F13, F57): the mesh is static and the
       per-frame work is uniforms;
     - lines that bunch closer than 2 CSS px (the sheet seen edge-on near a
       crest) fade out, gone by 1 px, instead of merging into moire;
     - no dotted trail along a crest: where the sheet folds over itself (a
       nearer swell hiding the sheet behind it), the rows running into the
       fold fade out before it, and its silhouette is drawn as one clean
       line of its own (THE CREST, at SHEET_FS).

   It is OPAQUE: the owner asked for a floor that is not see-through. It is
   filled with COAT, which must equal --coat exactly (the clear colour is
   COAT too, so the page grey is unchanged around it), and it occludes
   through the depth buffer: a farther part of the sheet behind a nearer
   crest is hidden, which is what the braided rows were (G1.1: drawn rows
   crossing in every frame, 18-106 px), and anything drawn after it is
   hidden where the floor in front of it rises (G1.2: the terrain's COAT
   fills used to wipe nearer rows). No painter's algorithm is needed.
   For that the floor must also reach nearer than its first row. The swell
   lifts the first row above the bottom of the screen most of the time
   (the floor's old near edge, d = 0.99, in about 90% of frames, by up to
   130 px at 390x844), and where the cursor's dent then pushes a farther
   part of the sheet down below it, a floor that stopped there left that
   part on show, farther rows under the nearest (with the pointer parked
   low on the left: up to 7,883 device px at 390x844@2 and 4,718 at
   1440x900@1.5). So the mesh runs on toward the viewer, blank COAT (no
   row or column is drawn nearer than d = 1, as on Canvas), to MESH_NEAR,
   where the sheet is below the bottom of the screen whatever the wave
   does: nothing farther can show below it.
   _tools/check-webgl-floor.js reads the floor's depth back and finds every
   pixel showing the nearest part of the true surface, folds included, and
   the visible 1/d never rising up any column of pixels.

   DEPTH. A layer's depth value is linear in 1/d, depthAt(d) = 1 - 2 *
   DEPTH_NEAR / d in clip z: 1/d is what interpolates correctly across a
   screen-space triangle (it is affine in screen y for the flat sheet), and
   it is what the floor's triangles carry. The near plane, clip z -1, is at
   d = DEPTH_NEAR = 0.25, nearer than anything drawn: the floor reaches
   MESH_NEAR = 0.35, and 1 - 1/d, which put the near plane at d = 0.5,
   clipped its nearest part away. Every later layer (the ridges, the
   peaks, the trees and the conifers) takes its own 1/d through depthAt
   and the depth test (LESS), and is hidden wherever the floor in front of
   it is nearer. The sun and the clouds are behind everything and the
   bodies and the ring in front of everything: they are drawn at NEAR,
   nearer than any layer, and write no depth, so the only depth they can
   fail against is the card's.

   THE CARD. The page's card (.shell) is opaque and covers the middle of
   the canvas - about half of what a frame draws at 1440x900, nearly all of
   it on a phone (audit F14). Before anything else, a frame writes depth
   alone (no colour) over the card's rect, as main.js gives it (occlude: the
   card inset by its corner radius, and by more above and below while the
   compositor may scroll it ahead of the canvas), at the nearest depth
   there is. Every draw after it is depth-tested, so the GPU rejects each
   fragment there before shading it - early depth rejection, which every
   GPU does when a shader neither discards nor writes its own depth (none
   here do). Behind the card the canvas is left the page grey, which only
   shows if the card does not cover it: main.js gives no rect for a still
   frame, while the page scrolls, or when the card is not opaque.
   _tools/check-occluder.js holds the pixels outside the rect to the bit
   against a frame without it, and measures the GPU's time with and
   without it.

   THE SCENERY. The owner's style: "would be cool if the mountains look
   like this" - a reference drawing of a low-poly mountain as LINE WORK, a
   pale, nearly uniform massif with crisp dark lines on every facet edge,
   the silhouette a little heavier, the lines running down from the
   summits and the notches along the ridges and gullies in long irregular
   triangles. Here:

     - each ridge and peak is one mesh whose triangles are exactly its
       silhouette (sceneryMesh): a jagged crest - a peak's one summit where
       the Canvas peak has it, a lower summit or two standing proud of each
       flank, notches cut between, both flanks falling to the ground at the
       feet (no end walls: audit F59); a ridge's summits as broad tents over
       its raised floor - then layers of corners below it, each fed by the
       one above (two arêtes down and out from every summit, a gully from
       every notch), zipped into strips. No facet can paint outside the
       silhouette and none can leave a wedge of it bare (G2.1-G2.3);
     - no needles: no edge of a crest is steeper than CREST_SLOPE, so a
       summit or a jag is at least 2 / CREST_SLOPE as wide as it stands
       over its notches (the final QA lens: spires 9 px wide and 24 tall);
     - no fans: a peak's layers touch down on the ground one after another
       inside its feet, so only the silhouette reaches a foot, and the
       lines are kept to FAN_CAP at any point; low on a massif no facet is
       smaller than MIN_FACET px^2 as it is seen (economise: two facets
       either side of a line taken out read as one), so the feet that show
       under a short tab's card are a few broad facets, not a band of small
       triangles (_tools/check-scenery-mesh.js holds all three);
     - the silhouette whole: it is drawn inside its own facet only, so no
       facet under the crest is left thinner than SLIVER px where the other
       way round or a lower corner of the layer under it helps (zipper,
       clearOf), and the line economy keeps the lines that carry its width
       on beside a thin facet, and those beside where it runs on past a
       corner into the massif (economise: RIM_HOLD, RUN_ON). It inks at
       least 0.8 px all along every crest edge but within 2 x its width of a
       corner (31 px of the near band's did not at 1440x900, just below the
       writing tab's card: the final review), and runs on with no line
       beside it by at most 2 px past its width (check-scenery-mesh.js holds
       both);
     - the fill is the card's tone (--surface), a touch greyer far away, and
       the lines the deep accent (--accent-deep) at full strength on the
       near band, the ranges behind it lighter and thinner step by step, so
       the layers keep their depth (MASSIF_LOOK); the lines
       are drawn in the fragment shader from barycentric coordinates, a
       constant width in pixels, anti-aliased over one, with a width per edge:
       the silhouette heavier, the base on the ground and the edges under it
       none. The fill and the lines are one opaque colour from one draw, so
       nothing behind can show through between facets (F60) and no tone
       changes from frame to frame (F20: there are no tones to flip);
     - everything is placed in the vertex shader, from the same wave and
       projection as the floor: each corner on the floor under where it is
       drawn, at its own (xw, d), so every base and every root is welded to
       the floor by construction (F58, G2.4: check-wave-parity.js finds every
       base within 0.005 px of it); the mesh reaches a few px below the base
       (its skirt), which the floor in front hides, so the visible foot is
       wherever the floor at the massif's depth meets it, to the pixel;
     - the floor curves under a massif, and a facet drawn flat between
       corners standing on it at different x turned inside out where it is
       wide and low (along the base, at the feet), its lines crossing its
       neighbours'. So each facet is drawn as pieces between vertical cut
       lines, each with two corners on one line, which no floor can turn
       over, and every edge stays a straight line unless the floor bends
       away from it by more than the facet's thickness there allows
       (slice, massifAt; check-scenery-mesh.js places every piece at nine
       sizes, with the swell, its event and the cursor's push, and finds
       none turned over);
     - the cursor presses the scenery through the terrain's copy of the
       field (scene.js TPUSH, uploaded as uPush): its dip compresses height -
       a ridge's column by the dip read there, a peak as one by the dip read
       at its centre - so the crest goes down and the foot stays on the
       floor; its shove slides a peak aside as one and bends a tree or a
       conifer by the square of the height (README "The scenery"). Nothing is
       kept per vertex between frames; the copy's own budget keeps any point
       from moving more than 2 * TERR_JOLT px a frame (check-terrain-jolt.js);
     - the trees and the conifers are the Canvas renderer's line work as
       quads, one per segment, each level's width and alpha, its strokes'
       butt ends, the two children at a fork (and a chevron's two halves)
       laid down as one stroke, blended through the depth test at their own
       depth: a conifer behind a nearer peak is hidden by it;
     - the clouds are the Canvas renderer's low-poly volumes, each facet's
       tone from the light direction, as static meshes carried by the sky's
       parallax and the horizon's tilt (A2).

   ONE WAVE. The scene keeps its wave on the CPU (the bodies roll on its
   slope, the cursor's well is put on the sheet through it, the terrain
   stands on it), so the shader's wave is written from the scene's own
   numbers - WAVE, DEPTH_W, CUR_*, WELL_*, EVENT_* - when this file loads,
   and only the state that moves (the swell's phase, the event, the dents,
   the wells, the view) goes up as uniforms each frame. The swell's phase is
   t * kt reduced to [0, 2 pi) here in double precision, so the shader's
   float32 never sees t itself: unreduced, t * 0.00052 is ~1,900 radians an
   hour in, where a float32 holds the angle only to ~1e-4. The sine is the
   shader's own, not the GPU's (sine, below). _tools/check-wave-parity.js
   reads the shader's wave back in a headless browser and holds it to the
   scene's within 1e-3 world units (measured 1e-5).

   THE LEVELS. The governor's lower resolutions used to be the canvas's
   bitmap itself (canvas.width = W * res), and every change of level
   reallocated the canvas's 4x multisampled drawing buffer: 18-61 ms on the
   owner's Intel Arc, 3-10 vsyncs at 165 Hz, a visible hitch at each change
   (the final QA lens). Now the canvas keeps level 0's size, top px per CSS
   px, and a level below it draws into the canvas's own top-left corner, W
   * res x H * res device px - and LEVEL_MARGIN px more to the right and
   below, the scene running on past the box, so that the compositor's
   filtering at the viewport's edge reads the scene and not the page grey -
   and only that corner is shown, stretched over the whole box: by
   object-view-box where the browser has it (Chromium: the canvas's box as
   laid out is untouched), else by a CSS transform that scales the canvas
   up from its top left corner (main.js then measures the box with the
   transform off). That is what the compositor's scaling of a smaller
   canvas did, with the same filtering: the same pixels as the canvas at
   res, but for the half-covered device column at the canvas's right edge,
   which now shows the scene where it showed the page grey (headless
   Chrome at 1440x900@1.5 and 390x844@3, 0.008-0.015% of the pixels
   differ, all in or within 25 px of that column; object-view-box gives
   the transform's pixels exactly at 1 and 0.75, and at 1.25 the same
   picture with its finest lines a fraction of a pixel apart, 1.8% of the
   pixels by more than 12 levels). A change of level is then a viewport
   and a paint property:
   nothing is allocated, in WebGL 1 as in 2. Level 0 shows the whole canvas
   and draws it whole, as before (its GL calls are the same, bit for bit:
   check-ops-golden). A drawing buffer the browser made smaller than asked
   (a canvas past the GPU's limit) is drawn whole at every level.
   An offscreen target, resolved and drawn back over the canvas, was built
   first and dropped: that full-screen pass into the multisampled canvas
   cost more than the level saved (Intel Arc, 1440x900@1.5, card occluded:
   level 0 1.45 ms of GPU a frame, 0.75 that way 1.79 ms, the canvas at
   0.75 0.62 ms). _tools/check-governor.js holds every change of level in
   headless Chrome under 2x the frames around it.

   LIFECYCLE. 'webgl2' first, then 'webgl'; the shaders are GLSL ES 1.00 and
   compile as such under WebGL 1 (with OES_standard_derivatives, for the
   derivatives), and through a few #defines as GLSL ES 3.00 under WebGL 2,
   where an ES 1.00 shader gets no derivatives at all (Chrome: "extension is
   not supported"). Context attributes: alpha false (the canvas IS the page
   background), antialias true, depth true, powerPreference 'default' (do not
   wake a discrete GPU and drain a laptop for a background),
   preserveDrawingBuffer false. If anything is missing - WebGL, the
   extension, a shader that does not compile or link - the factory says so
   in one console warning and returns null, and main.js shows the still
   picture. A lost context (webglcontextlost) is let to come back
   (preventDefault) and draws nothing meanwhile; when it is restored every
   program and buffer is built again, before main.js's own listener asks for
   the frame or, if this failed (alive() false), shows the still picture
   (_tools/check-webgl-context.js). Nothing here throws out of a frame.

   TEST SURFACE (harness.js RENDERER_PROBES; check-deadcode.js lets the
   tools be their only readers). renderer.probeWave(points, t) and
   renderer.probeDepth(dTest) read the shader's wave and the floor's
   visible depth back (check-wave-parity.js, check-webgl-floor.js);
   renderer.probeScenery(t) the shader's own placement of every scenery
   corner (check-wave-parity.js, against _tools/scenery-twin.js), and
   renderer.probeIds() what every pixel shows (check-webgl-terrain.js,
   glkit.openSky). Bg.renderers.webgl.sheetMesh() and sceneryMesh() are the
   meshes themselves, for the tools that measure them (check-sheet-mesh.js,
   check-scenery-mesh.js, check-terrain-jolt.js, _tools/scenery-twin.js and
   others). */
(function () {
  const Bg = window.Bg;
  const { WAVE, DEPTH_W, WELL_DEPTH, WELL_SIGMA2, WELL_R2, CUR_DEPTH, CUR_SIGMA2, CUR_R2, CUR_EDGE,
          EVENT_DEPTH_W, EVENT_SIGMA2, EVENT_AMP0, EVENT_AMP1, PERSP_X, PERSP_Y, WAVE_Y, LOOK_X, PAR_D0, ROWS, DMAX, XSPAN, SWELL_D0, SWELL_D1,
          COAT, SUN, look, ptr, mk, CUR, RIP, EVF, sheetOn, bodiesW, horizonY, tiltY, skyX, sunAt, bodiesAt,
          RIDGES, BANDS, TREES, CONIFERS, CLOUDS, TPUSH, hash1, treeLevels, ridgeSummits, peakPlace,
          CUR_TERR_PUSH, CUR_TERR_SX, CUR_TERR_PAD, CUR_SIDE_PEAK, CUR_TERR_MIN, CUR_SIDE_FADE,
          CUR_SIDE_END, BLOOM, BLOOM_R, SHARD_TURN, SHARD_SHRINK, SHARD_DRIFT, SHARD_PIN, CLOUD_DRIFT, FORK,
          coniferLayout } = Bg;

  /* The sheet's lines, as the Canvas renderer drew them: ROWS rows at
     d = 1 + (DMAX - 1) * dn^ROW_POW, dn =
     r / (ROWS - 1), alpha ROW_A * (1 - ROW_DIM * dn); COLS columns at xw
     from -COL_SPAN to COL_SPAN between d = 1 and DMAX, alpha COL_A * (1 -
     COL_DIM * dn) at the dn of their depth. Lines closer together than
     BUNCH_HI CSS px begin to fade, and are gone at BUNCH_LO: the far rows
     of a 390 px tall window are 2.4 px apart and keep their full ink. */
  const ROW_POW = 1.55, ROW_A = 0.60, ROW_DIM = 0.55;
  const COLS = 33, COL_SPAN = 2.35, COL_A = 0.42, COL_DIM = 0.5;
  const BUNCH_LO = 1.0, BUNCH_HI = 2.0;
  /* The crest line (THE CREST, at SHEET_FS): CREST_W CSS px wide, CREST_GAP
     in from the fold's silhouette, at a row's alpha there, faded in as a
     fold is born over CREST_BORN of the fold's discriminant. */
  const CREST_W = 1.25, CREST_GAP = 0.7, CREST_BORN = 0.25;
  /* The floor's mesh: MESH_NX steps across sn in [-XSPAN, XSPAN], and
     MESH_PER_ROW steps of u between neighbouring rows, so that every row
     lies on a mesh row. The u steps are finest where the depth changes the
     wave fastest (far, towards the screen's edges, xw = sn * d changing
     with d) and where the rows are farthest apart on screen (near). At 384
     across, every drawn line lies within 0.4 px of the true surface at
     every size up to 3840x2160, and the error grows only with the size of
     the screen (check-sheet-mesh.js). The mesh reaches past the last row,
     at the same u step, to MESH_FAR: that carries the outer half of that
     row's line, and keeps the floor as exact out there as anywhere (a
     single strip from DMAX to MESH_FAR put the floor's far edge up to 2 px
     off the true surface). And it reaches past the first row toward the
     viewer, at the same u step mirrored (d = 1 - (DMAX - 1) * u^ROW_POW),
     to MESH_NEAR: the apron, blank floor (rows and columns start at
     d = 1), there to hide whatever of the farther sheet comes below the
     first row (THE FLOOR). At MESH_NEAR the sheet is below the bottom of
     the screen whatever the wave does. The wave lifts it there by at most
     3.74 - the swell's 1.84 and the swell event's 1.9; the dents only
     press the sheet down, and no body's well reaches nearer than d = 0.51
     - so the edge's y is at least H * (HORIZON + (PERSP_Y - 3.74 *
     WAVE_Y) / 0.35) less the horizon's 8 px of tilt, 1.226 H - 8: below
     the bottom of any window over 36 px tall (check-sheet-mesh.js holds
     the bound). Over 22 minutes of the scene with the pointer low it
     stayed 260 px or more below the bottom at 844x390. The floor stopped
     at 0.99 before, which was above the bottom in 89-91% of those
     frames, by up to 139 px. The apron is 58 of the mesh's 294 strips,
     44,776 of its 226,966 vertices (58 x 770 and the joins up to the
     first row; +25% on the rest), nearly all of it off the
     screen: vertex work and almost no pixels, which the Intel Arc iGPU
     does not notice (a frame 1.24 -> 1.23 ms at 1440x900@1.5, 0.72 ->
     0.71-0.75 ms at 390x844@3, the card occluded; both within the noise
     of two runs). */
  /* THE FAR FLOOR: the mesh goes on at the rows' own fine step to MESH_FAR,
     the swell's calm (scene.js SWELL_D1), and from there, a flat plane on
     screen (no swell, no slide past PAR_D0), in one strip to MESH_END,
     within 0.3px of the horizon at 1440x900: the floor no longer ends,
     its lines run on and fade into the horizon (ROW_FAR rows at most;
     THE LINES). It stopped at 6.8, 0.3 past the last row. */
  const MESH_NX = 384, MESH_PER_ROW = 12, MESH_NEAR = 0.35, MESH_FAR = SWELL_D1;
  const MESH_END = 2000, ROW_FAR = 400, ROW_NEAR = -6;
  /* Colours: the sheet's ink and the ring's, the bodies' cores and the
     ring's dot, the bodies' halos. */
  const INK = [42, 104, 92], DEEP = [28, 78, 69], HALO = [46, 115, 102];
  /* The bodies: a core 3.8 * size across a halo 17 * size, flat out to 0.6
     of the core and fading to 0 at its edge, at 0.22 of the body's
     brightness. */
  const BODY_CORE = 3.8, BODY_HALO = 17, BODY_FLAT = 0.6, BODY_HALO_A = 0.22;
  /* The ring: 13 +- 3 px, a 1.4 px line at 0.45 of ptr.k, a second at 2.1 x
     the radius at 0.16, a 2.3 px dot at 0.75. The line and the dot sit on a
     pale casing, RING_HALO px wider on each side, in the card's tone
     (--surface) at RING_HALO_A: over the line-art mountains and the trees
     the ring was one more teal line among theirs, and with the pointer
     resting on a face it disappeared (the final QA lens); the casing clears
     a band of them around it. Over the plain floor, which is all but that
     tone, it hardly shows. */
  const RING_R = 13, RING_WOBBLE = 3, RING_LINE = 1.4, RING_A = 0.45, RING_OUTER = 2.1,
        RING_OUTER_A = 0.16, RING_DOT = 2.3, RING_DOT_A = 0.75, RING_HALO = 1, RING_HALO_A = 0.9;
  /* The context. alpha false: the canvas is the page's background, opaque,
     cleared to COAT. powerPreference 'default': a background must not wake
     a laptop's discrete GPU. No stencil: nothing uses one. */
  const ATTRS = { alpha: false, antialias: true, depth: true, stencil: false, preserveDrawingBuffer: false,
                  powerPreference: 'default' };

  const TAU = 2 * Math.PI;
  const NB = bodiesW.length, NW = WAVE.length;
  const hex = i => parseInt(COAT.slice(i, i + 2), 16);
  const COAT_RGB = [hex(1), hex(3), hex(5)];
  /* the clear colour, as numbers made once (see draw's scratch) */
  const CLEAR_R = COAT_RGB[0] / 255, CLEAR_G = COAT_RGB[1] / 255, CLEAR_B = COAT_RGB[2] / 255;
  const SUN_RGB = SUN.fill.match(/\d+/g).map(Number);
  /* the scenery's colours: the mountains' fill is the card's tone (site.css
     --surface), their lines the deep accent (--accent-deep) */
  const SURFACE_RGB = [232, 232, 228], LINE_RGB = [34, 86, 76];
  /* the clouds' line colour: CLOUD_INK_SHARE of the way from the page's coat to
     the line colour, as a massif's ink (sceneryMesh) */
  const CLOUD_INK_SHARE = 0.5;
  const CLOUD_INK = [0, 1, 2].map(i => Math.round(COAT_RGB[i] + (LINE_RGB[i] - COAT_RGB[i]) * CLOUD_INK_SHARE));

  /* ---- the shaders ----------------------------------------------------- */
  /* x as a GLSL ES float literal (GLSL has no implicit int -> float) */
  function lit(x) {
    let s = String(x);
    if (!/[.e]/i.test(s)) s += '.0';
    return x < 0 ? '(' + s + ')' : s;
  }
  const rgb = c => 'vec3(' + c.map(v => lit(v / 255)).join(', ') + ')';
  /* GLSL ES 1.00 as itself (WebGL 1) and as 3.00 (WebGL 2) */
  const VS1 = 'precision highp float;\n';
  const FS1 = '#extension GL_OES_standard_derivatives : enable\nprecision highp float;\n#define fragOut gl_FragColor\n';
  const VS3 = '#version 300 es\n#define attribute in\n#define varying out\nprecision highp float;\n';
  const FS3 = '#version 300 es\n#define varying in\nprecision highp float;\nout vec4 fragOut;\n';

  /* The wave and the projection: scene.js's wave() and surfacePoint(), in
     the same order of terms, from the same numbers. */
  const SHEET_GLSL = [
    'uniform vec4 uView;          /* W, H (the scene, CSS px), horizonY(), look.x * LOOK_X */',
    'uniform float uPhase[' + NW + '];   /* the swell terms\' t * kt, in [0, 2 pi) */',
    'uniform vec3 uEvt;           /* the swell event: xw, d, sign * amp * env (0 while none runs) */',
    'uniform vec3 uDent[2];       /* CUR, RIP: xw, d, CUR_DEPTH * on (0 when off) */',
    'uniform vec2 uWell[' + NB + '];      /* the bodies: xw, d */',
    /* sin, to ~1e-7 on every GPU: GLSL ES leaves sin()'s accuracy to the
       driver, and SwiftShader's (within Vulkan's 2^-11) left the shader's
       swell 2.3e-4 shy of the scene's, three terms adding up towards the
       1e-3 parity limit. Reduced to [-pi, pi], folded into [-pi/2, pi/2],
       then Taylor to x^11 (next term 6e-8): a dozen flops a term. */
    'float sine(float a) {',
    '  a -= ' + lit(TAU) + ' * floor(a * ' + lit(1 / TAU) + ' + 0.5);',
    '  float x = a > ' + lit(Math.PI / 2) + ' ? ' + lit(Math.PI) + ' - a : a < ' + lit(-Math.PI / 2) + ' ? ' + lit(-Math.PI) + ' - a : a;',
    '  float x2 = x * x;',
    '  return x * (1.0 + x2 * (' + lit(-1 / 6) + ' + x2 * (' + lit(1 / 120) + ' + x2 * (' + lit(-1 / 5040) + ' + x2 * ('
      + lit(1 / 362880) + ' + x2 * ' + lit(-1 / 39916800) + ')))));',
    '}',
    /* dents: 1 for the floor, 0 for the floor without the cursor's dents
       (refAt, the scenery's straightening) */
    /* the swell's share toward the horizon (scene.js swellFar) and its
       first three derivatives in d, for the fold's jet */
    'vec4 farOf(float d) {',
    '  float L = ' + lit(SWELL_D1 - SWELL_D0) + ', u = clamp((d - ' + lit(SWELL_D0) + ') / L, 0.0, 1.0);',
    '  float on = d > ' + lit(SWELL_D0) + ' && d < ' + lit(SWELL_D1) + ' ? 1.0 : 0.0;',
    '  return vec4(1.0 - u * u * (3.0 - 2.0 * u), -6.0 * u * (1.0 - u) / L * on, -(6.0 - 12.0 * u) / (L * L) * on, 12.0 / (L * L * L) * on);',
    '}',
    'float waveOf(float xw, float d, float dents) {',
    '  float z = (' + WAVE.map((w, i) => 'sine(xw * ' + lit(w.kx) + ' + d * ' + lit(w.kd) + ' + uPhase[' + i + ']) * '
                                        + lit(w.amp)).join('\n          + ') + ') * farOf(d).x;',
    '  for (int i = 0; i < 2; i++) {',
    '    float dx = xw - uDent[i].x, dd = (d - uDent[i].y) * ' + lit(DEPTH_W) + ';',
    '    float r2 = dx * dx + dd * dd;',
    '    if (r2 < ' + lit(CUR_R2) + ') z += dents * uDent[i].z * (exp(-r2 / ' + lit(CUR_SIGMA2) + ') - ' + lit(CUR_EDGE) + ');',
    '  }',
    '  float ex = xw - uEvt.x, ed = (d - uEvt.y) * ' + lit(EVENT_DEPTH_W) + ';',
    '  z += uEvt.z * exp(-(ex * ex + ed * ed) / ' + lit(EVENT_SIGMA2) + ');',
    '  for (int i = 0; i < ' + NB + '; i++) {',
    '    float dx = xw - uWell[i].x, dd = (d - uWell[i].y) * ' + lit(DEPTH_W) + ';',
    '    float r2 = dx * dx + dd * dd;',
    '    if (r2 < ' + lit(WELL_R2) + ') z -= ' + lit(WELL_DEPTH) + ' * exp(-r2 / ' + lit(WELL_SIGMA2) + ');',
    '  }',
    '  return z;',
    '}',
    'float waveAt(float xw, float d) { return waveOf(xw, d, 1.0); }',
    /* the sheet at (sn, d) on screen, CSS px: surfacePoint(sn * d, d) */
    'vec2 sheetAt(float sn, float d) {',
    '  float shift = uView.w * max(0.0, (' + lit(PAR_D0) + ' - d) / ' + lit(PAR_D0 - 1) + ');',
    '  return vec2(uView.x * 0.5 + shift + sn * uView.x * ' + lit(PERSP_X) + ',',
    '              uView.z + uView.y * ' + lit(PERSP_Y) + ' / d + waveAt(sn * d, d) * uView.y * ' + lit(WAVE_Y) + ' / d);',
    '}'
  ].join('\n') + '\n';
  /* depth, linear in 1/d, the near plane at d = DEPTH_NEAR (the header);
     NEAR, the clip z of what is drawn in front of every layer or behind
     all of them without writing depth (the sun, the clouds, the bodies,
     the ring), nearer than any layer (the nearest, the floor at
     MESH_NEAR, is at -0.43) and only just farther than the card's depth
     (-1: THE CARD) */
  const DEPTH_NEAR = 0.25;
  const DEPTH_GLSL = 'float depthAt(float d) { return 1.0 - ' + lit(2 * DEPTH_NEAR) + ' / d; }\n';
  const NEAR = -0.9999;
  /* CSS px on the canvas box to clip space */
  const CLIP_GLSL = 'uniform vec2 uBox;\nvec2 clipXY(vec2 p) { return vec2(p.x / uBox.x * 2.0 - 1.0, 1.0 - p.y / uBox.y * 2.0); }\n';
  /* a value in [0, 1) as 24 bits, three bytes, for reading back */
  const PACK_GLSL = [
    'vec4 pack24(float f) {',
    '  float q = floor(clamp(f, 0.0, 0.99999994) * 16777216.0);',
    '  float b0 = floor(q / 65536.0); q -= b0 * 65536.0;',
    '  float b1 = floor(q / 256.0);',
    '  return vec4(b0, b1, q - b1 * 256.0, 255.0) / 255.0;',
    '}'
  ].join('\n') + '\n';

  /* THE CREST. Where the sheet folds over itself - a nearer swell, a dent's
     rim or a body's well hiding the sheet behind it - its rows run into the
     fold side by side, nearly parallel to it and closer and closer
     together, and each faded out as it went (bunch). Every row's fading
     tail ended at another point along the silhouette, and they read as a
     faint dotted trail along every crest (the final QA lens: trails 130 and
     300 device px long in one gutter), which shimmered in motion: in 1440x900
     @1.5 frames 4 ms apart, the swell alone, 55.4 px a frame brightened and
     darkened again by more than 12 levels from one frame to the next, where
     the scene's own motion moves a pixel's brightness one way at a time
     (_tools/check-webgl-floor.js, its crests). A fade on the rows' spacing cannot be
     made calm: that spacing comes from screen derivatives, constant over
     each triangle, and the triangles at a fold are slivers, so it jumped
     from sliver to sliver along the crest - the dots.

     So the vertex shader finds the fold itself, from the wave's own
     derivatives. Along the rows' parameter d (sn held), g is how fast the
     rows cross the screen across themselves per unit d (the projection's
     Jacobian over the rows' length, CSS px), negative on the near face of
     the sheet; the sheet folds where g comes to 0. With g' and g'' the fold
     ahead is the root of g + g' u + g'' u^2 / 2, and the screen distance to
     it the integral of g up to there (vFold.y). It is drawn where that
     quadratic reaches 0 (rho = 1 - 2 g g'' / g'^2 >= 0, faded in over
     CREST_BORN as a fold is born), or where it falls short close by and g
     itself, read again at the quadratic's closest approach, has come to 0
     all the same (the third-order terms finishing the fold: a third of the
     folds at 390x844@2 drew no line on the quadratic alone). A swell that
     only comes close to folding - the crown of a body's well - draws none:
     it drew a smudge over the body, from a distance that never reached 0.
     Where there is no root the distance is to the quadratic's closest
     approach, which is where the root is born, so the distance is
     continuous and interpolates without specks; it is computed per vertex
     because it is near affine across the screen, where g, which grows like
     the square root of the distance, interpolated across a sliver was off
     by up to 2x and dotted the fade again. vFold.x, the plainer g^2 / 2 g',
     also sees a fold that is only coming close: the rows' fade.

     The fragment shader draws the crest line over CREST_GAP to CREST_GAP +
     CREST_W of that distance, so both of its edges are its own anti-aliased
     coverage (drawn up to the silhouette, the multisampled edge of a fold
     whose triangles shift by fractions of a pixel as it moves, the line
     twinkled: 79.7 px a frame), fades the rows out over the next
     CREST_GAP + CREST_W and the columns up to the line, which has the ink
     there. Measured as above: 6.5 px a frame at 1440x900@1.5 (from 55.4),
     7.7 at 390x844@2 (20.2), and in a swell event's frames 1 ms apart 0.9
     (1.7); the line runs along 93-98% of the folds' silhouettes in the
     check's states at 1440x900@1.5, 86% and 68% at 390x844@2 (on the sides
     of a round fold, where it crosses the rows steeply, the distance along d
     overestimates, and the line tapers off there like a pen stroke's end). The Canvas
     look, a dark line where the rows bunched at a crest, is back as one
     clean line. The floor stands where sheetAt puts it, as before: the jet
     only shades it. */
  const FOLD_GLSL = [
    /* a Gaussian bump e = a exp(-(dx^2 + dd^2) / s2), dd = (d - d0) k, added
       to the wave's jet (j0: w, w_x, w_d; j1: w_xx, w_xd, w_dd; j2: w_xxx,
       w_xxd, w_xdd, w_ddd; x is xw) */
    'void bump(inout vec3 j0, inout vec3 j1, inout vec4 j2, float e, float dx, float dd, float k, float s2) {',
    '  float p = -2.0 * dx / s2, q = -2.0 * dd * k / s2, P = -2.0 / s2, Q = -2.0 * k * k / s2;',
    '  j0 += e * vec3(1.0, p, q);',
    '  j1 += e * vec3(p * p + P, p * q, q * q + Q);',
    '  j2 += e * vec4(p * p * p + 3.0 * p * P, q * (p * p + P), p * (q * q + Q), q * q * q + 3.0 * q * Q);',
    '}',
    /* g, g' and g'' along d at (sn, d): waveOf's terms, differentiated */
    'vec3 foldOf(float sn, float d) {',
    '  float xw = sn * d; vec3 j0 = vec3(0.0), j1 = vec3(0.0); vec4 j2 = vec4(0.0);',
    /* the swell's jet (s: w, w_x, w_d; q1: w_xx, w_xd, w_dd; q2: w_xxx,
       w_xxd, w_xdd, w_ddd), then times its far share f(d), by the product
       rule (f depends on d alone) */
    '  vec3 q0 = vec3(0.0), q1 = vec3(0.0); vec4 q2 = vec4(0.0);',
    WAVE.map((w, i) => '  { float a = xw * ' + lit(w.kx) + ' + d * ' + lit(w.kd) + ' + uPhase[' + i + '];'
      + ' float s = sine(a) * ' + lit(w.amp) + ', c = sine(a + ' + lit(Math.PI / 2) + ') * ' + lit(w.amp) + ';'
      + ' q0 += vec3(s, ' + lit(w.kx) + ' * c, ' + lit(w.kd) + ' * c);'
      + ' q1 -= s * vec3(' + lit(w.kx * w.kx) + ', ' + lit(w.kx * w.kd) + ', ' + lit(w.kd * w.kd) + ');'
      + ' q2 -= c * vec4(' + lit(w.kx * w.kx * w.kx) + ', ' + lit(w.kx * w.kx * w.kd) + ', ' + lit(w.kx * w.kd * w.kd) + ', ' + lit(w.kd * w.kd * w.kd) + '); }').join('\n'),
    '  { vec4 F = farOf(d); float f = F.x, f1 = F.y, f2 = F.z, f3 = F.w;',
    '    j0 += vec3(q0.x * f, q0.y * f, q0.z * f + q0.x * f1);',
    '    j1 += vec3(q1.x * f, q1.y * f + q0.y * f1, q1.z * f + 2.0 * q0.z * f1 + q0.x * f2);',
    '    j2 += vec4(q2.x * f, q2.y * f + q1.x * f1, q2.z * f + 2.0 * q1.y * f1 + q0.y * f2, q2.w * f + 3.0 * q1.z * f1 + 3.0 * q0.z * f2 + q0.x * f3); }',
    '  for (int i = 0; i < 2; i++) {',
    '    float dx = xw - uDent[i].x, dd = (d - uDent[i].y) * ' + lit(DEPTH_W) + ', r2 = dx * dx + dd * dd;',
    '    if (r2 < ' + lit(CUR_R2) + ') { bump(j0, j1, j2, uDent[i].z * exp(-r2 / ' + lit(CUR_SIGMA2) + '), dx, dd, ' + lit(DEPTH_W) + ', ' + lit(CUR_SIGMA2) + ');'
      + ' j0.x -= uDent[i].z * ' + lit(CUR_EDGE) + '; }',
    '  }',
    '  float ex = xw - uEvt.x, ed = (d - uEvt.y) * ' + lit(EVENT_DEPTH_W) + ';',
    '  bump(j0, j1, j2, uEvt.z * exp(-(ex * ex + ed * ed) / ' + lit(EVENT_SIGMA2) + '), ex, ed, ' + lit(EVENT_DEPTH_W) + ', ' + lit(EVENT_SIGMA2) + ');',
    '  for (int i = 0; i < ' + NB + '; i++) {',
    '    float dx = xw - uWell[i].x, dd = (d - uWell[i].y) * ' + lit(DEPTH_W) + ', r2 = dx * dx + dd * dd;',
    '    if (r2 < ' + lit(WELL_R2) + ') bump(j0, j1, j2, ' + lit(-WELL_DEPTH) + ' * exp(-r2 / ' + lit(WELL_SIGMA2) + '), dx, dd, ' + lit(DEPTH_W) + ', ' + lit(WELL_SIGMA2) + ');',
    '  }',
    /* along d, sn held (xw = sn d): w1..w3; y = horizon + F / d, F = H PERSP_Y + K w;
       x = W / 2 + shift(d) + sn W PERSP_X */
    '  float s2 = sn * sn, K = uView.y * ' + lit(WAVE_Y) + ', id = 1.0 / d;',
    '  float w1 = j0.y * sn + j0.z, w2 = j1.x * s2 + 2.0 * j1.y * sn + j1.z, w3 = j2.x * s2 * sn + 3.0 * j2.y * s2 + 3.0 * j2.z * sn + j2.w;',
    '  float F = uView.y * ' + lit(PERSP_Y) + ' + K * j0.x, F1 = K * w1, F2 = K * w2, F3 = K * w3;',
    '  float yd = (F1 - F * id) * id, ydd = (F2 - 2.0 * F1 * id + 2.0 * F * id * id) * id;',
    '  float yddd = (F3 - 3.0 * F2 * id + 6.0 * F1 * id * id - 6.0 * F * id * id * id) * id;',
    '  float ys = K * j0.y, ysd = K * (j1.x * sn + j1.y), ysdd = K * (j2.x * s2 + 2.0 * j2.y * sn + j2.z);',
    '  float xs = uView.x * ' + lit(PERSP_X) + ', xd = d < ' + lit(PAR_D0) + ' ? -uView.w / ' + lit(PAR_D0 - 1) + ' : 0.0;',
    /* g = det J / t, t the rows' length per unit sn; and its derivatives */
    '  float D0 = xs * yd - xd * ys, D1 = xs * ydd - xd * ysd, D2 = xs * yddd - xd * ysdd;',
    '  float t = sqrt(xs * xs + ys * ys), t1 = ys * ysd / t, t2 = (ysd * ysd + ys * ysdd) / t - ys * ys * ysd * ysd / (t * t * t);',
    '  return vec3(D0 / t, D1 / t - D0 * t1 / (t * t), D2 / t - 2.0 * D1 * t1 / (t * t) - D0 * t2 / (t * t) + 2.0 * D0 * t1 * t1 / (t * t * t));',
    '}'
  ].join('\n') + '\n';
  const SHEET_VS = SHEET_GLSL + FOLD_GLSL + DEPTH_GLSL + CLIP_GLSL + [
    'attribute vec2 aPos;          /* (sn, d) */',
    'varying vec2 vSV;             /* (sn, 1/d): affine in screen x and y for the flat sheet */',
    'varying vec3 vFold;           /* to the fold ahead, CSS px: g^2 / 2 g1, the root distance; the weight of the line (THE CREST) */',
    'void main() {',
    '  vSV = vec2(aPos.x, 1.0 / aPos.y);',
    /* 64 px: farther than anything the crest does reaches */
    '  vec3 f = foldOf(aPos.x, aPos.y);',
    '  float g = f.x, g1 = f.y, g2 = f.z, root = 0.0, born = 1.0;',
    '  float lin = g1 > 1e-6 ? min(64.0, g * g / (2.0 * g1)) : 64.0;',
    '  if (g < 0.0) {',
    '    float disc = g1 * g1 - 2.0 * g * g2, den = g1 + sqrt(max(disc, 0.0));',
    '    float rho = g2 < 0.0 && g1 <= 0.0 ? -1.0 : disc / max(g1 * g1, 1e-12);',
    '    float u = disc >= 0.0 && den > 1e-9 ? -2.0 * g / den : g2 < 0.0 && g1 > 0.0 ? -g1 / g2 : -1.0;',
    '    root = u > 0.0 ? min(64.0, abs(g * u + 0.5 * g1 * u * u + g2 * u * u * u / 6.0)) : 64.0;',
    '    born = smoothstep(0.0, ' + lit(CREST_BORN) + ', rho);',
    /* the quadratic falls short, close by: the sheet itself, read again at
       its closest approach, may have folded there all the same */
    '    if (rho < ' + lit(CREST_BORN) + ' && g2 < 0.0 && g1 > 0.0 && root < ' + lit(2 * (CREST_GAP + CREST_W)) + ')'
      + ' born = max(born, smoothstep(0.0, ' + lit(CREST_BORN) + ', foldOf(aPos.x, aPos.y - g1 / g2).x / -g));',
    '  }',
    '  vFold = vec3(lin, root, born);',
    '  gl_Position = vec4(clipXY(sheetAt(aPos.x, aPos.y)), depthAt(aPos.y), 1.0);',
    '}'
  ].join('\n');
  /* The lines. A row is where 1/d is the row's 1/d, a column where
     sn - xc / d is 0; each distance in device px is the value over its
     screen gradient, and a line covers what is within half a CSS px of its
     centre, plus half a device px of anti-aliasing. The nearest row comes
     from dn, the row parameter of this depth; its neighbours give the row
     spacing (dn's own derivative is infinite at d = 1, so it cannot). A
     fold's crest line, and the rows and columns faded out before it: THE
     CREST, above. */
  const SHEET_FS = [
    'varying vec2 vSV;',
    'varying vec3 vFold;',
    'uniform float uPx;           /* device px per CSS px */',
    /* a row's depth: the spacing law, mirrored through the first row for
       the rows nearer than it (r < 0; THE NEAR FLOOR) */
    'float rowDepth(float r) { return max(0.05, 1.0 + sign(r) * ' + lit(DMAX - 1) + ' * pow(abs(r) / ' + lit(ROWS - 1) + ', ' + lit(ROW_POW) + ')); }',
    'float cover(float dist) { return clamp(0.5 * uPx + 0.5 - dist, 0.0, 1.0); }',
    'float bunch(float gap) { return smoothstep(' + lit(BUNCH_LO) + ', ' + lit(BUNCH_HI) + ', gap / uPx); }',
    'void main() {',
    '  float sn = vSV.x, v = vSV.y, d = 1.0 / v;',
    '  vec2 gs = vec2(dFdx(sn), dFdy(sn)), gv = vec2(dFdx(v), dFdy(v));',
    '  float lv = max(length(gv), 1e-12);',
    '  float dn = sign(d - 1.0) * pow(abs(d - 1.0) / ' + lit(DMAX - 1) + ', ' + lit(1 / ROW_POW) + ');',
    /* THE NEAR FLOOR: the rows go on nearer than the first (to ROW_NEAR,
       past the screen's foot), and the columns down to the mesh's near
       edge: the first row, lifted by the swell, rose to 0.89 H at 1699x887
       and left a band of plain floor under it - the owner: "at the bottom
       of the page ... it looks like the waves end" */
    '  float r = clamp(floor(dn * ' + lit(ROWS - 1) + ' + 0.5), ' + lit(ROW_NEAR) + ', ' + lit(ROW_FAR) + ');',
    /* THE FAR FLOOR: past the last row the rows go on at the same spacing
       law, and the columns go on across the whole floor; all of them fade
       into the horizon, linearly in its height (haze: 1 from the last row
       nearer, 0 at the horizon), as well as by how close they bunch */
    '  float haze = clamp(v * ' + lit(DMAX) + ', 0.0, 1.0);',
    '  float vr = 1.0 / rowDepth(r);',
    '  float gap = min(1.0 / rowDepth(r - 1.0) - vr, vr - 1.0 / rowDepth(r + 1.0));',
    '  float row = ' + lit(ROW_A) + ' * (1.0 - ' + lit(ROW_DIM) + ' * clamp(r / ' + lit(ROWS - 1) + ', 0.0, 1.0)) * haze * cover(abs(v - vr) / lv) * bunch(gap / lv)'
      + ' * smoothstep(' + lit(CREST_GAP + CREST_W) + ', ' + lit(2 * (CREST_GAP + CREST_W)) + ', vFold.x);',
    '  float cs = ' + lit(2 * COL_SPAN / (COLS - 1)) + ';',
    '  float xc = floor((sn * d + ' + lit(COL_SPAN) + ') / cs + 0.5) * cs - ' + lit(COL_SPAN) + ';',
    '  float lc = max(length(gs - xc * gv), 1e-12);',
    '  float inside = 1.0;',
    '  float col = ' + lit(COL_A) + ' * (1.0 - ' + lit(COL_DIM) + ' * clamp(dn, 0.0, 1.0)) * haze * cover(abs(sn - xc * v) / lc) * bunch(cs * v / lc) * inside'
      + ' * smoothstep(0.0, ' + lit(CREST_GAP + CREST_W) + ', vFold.x);',
    '  float crest = ' + lit(ROW_A) + ' * (1.0 - ' + lit(ROW_DIM) + ' * min(dn, 1.0)) * vFold.z'
      + ' * clamp((vFold.y - ' + lit(CREST_GAP) + ') * uPx + 0.5, 0.0, 1.0) * clamp((' + lit(CREST_GAP + CREST_W) + ' - vFold.y) * uPx + 0.5, 0.0, 1.0) * inside;',
    '  vec3 c = mix(' + rgb(COAT_RGB) + ', ' + rgb(INK) + ', row);',
    '  fragOut = vec4(mix(mix(c, ' + rgb(INK) + ', col), ' + rgb(INK) + ', crest), 1.0);',
    '}'
  ].join('\n');

  /* A square around a disc, for the sun and the ring: uDisc is its centre,
     its radius and the margin around that, CSS px. */
  const DISC_VS = CLIP_GLSL + [
    'attribute vec2 aPos;          /* a corner, -1..1 */',
    'uniform vec4 uDisc;',
    'varying vec2 vOff;            /* from the centre, CSS px */',
    'void main() {',
    '  vOff = aPos * (uDisc.z + uDisc.w);',
    '  gl_Position = vec4(clipXY(uDisc.xy + vOff), ' + lit(NEAR) + ', 1.0);',
    '}'
  ].join('\n');
  const SUN_FS = [
    'varying vec2 vOff;',
    'uniform vec4 uDisc;',
    'uniform float uPx;',
    'void main() {',
    '  float a = clamp((uDisc.z - length(vOff)) * uPx + 0.5, 0.0, 1.0);',
    '  fragOut = vec4(' + rgb(SUN_RGB) + ' * a, a);',
    '}'
  ].join('\n');
  /* the casing of the inner circle and of the dot, then the two circles
     and the dot, each over the one before */
  const RING_FS = [
    'varying vec2 vOff;',
    'uniform vec4 uDisc;',
    'uniform float uPx;',
    'uniform float uK;            /* ptr.k */',
    'float ringAt(float r, float at, float hw) { return clamp((hw - abs(r - at)) * uPx + 0.5, 0.0, 1.0); }',
    'float discAt(float r, float rad) { return clamp((rad - r) * uPx + 0.5, 0.0, 1.0); }',
    'void main() {',
    '  float r = length(vOff);',
    '  float a0 = max(ringAt(r, uDisc.z, ' + lit(RING_LINE / 2 + RING_HALO) + '), discAt(r, ' + lit(RING_DOT + RING_HALO) + ')) * '
      + lit(RING_HALO_A) + ' * uK;',
    '  float a1 = ringAt(r, uDisc.z, ' + lit(RING_LINE / 2) + ') * ' + lit(RING_A) + ' * uK;',
    '  float a2 = ringAt(r, uDisc.z * ' + lit(RING_OUTER) + ', ' + lit(RING_LINE / 2) + ') * ' + lit(RING_OUTER_A) + ' * uK;',
    '  float a3 = discAt(r, ' + lit(RING_DOT) + ') * ' + lit(RING_DOT_A) + ' * uK;',
    '  vec4 o = vec4(' + rgb(SURFACE_RGB) + ' * a0, a0);',
    '  o = vec4(' + rgb(INK) + ' * a1, a1) + o * (1.0 - a1);',
    '  o = vec4(' + rgb(INK) + ' * a2, a2) + o * (1.0 - a2);',
    '  fragOut = vec4(' + rgb(DEEP) + ' * a3, a3) + o * (1.0 - a3);',
    '}'
  ].join('\n');
  /* The bodies, far to near, one square each in one draw: uBody[i] is a
     body's centre (CSS px), size and brightness. */
  let pick = 'uBody[' + (NB - 1) + ']';
  for (let i = NB - 2; i >= 0; i--) pick = 'aPos.z < ' + lit(i + 0.5) + ' ? uBody[' + i + '] : ' + pick;
  const BODY_VS = CLIP_GLSL + [
    'attribute vec3 aPos;          /* a corner, -1..1, and which body */',
    'uniform vec4 uBody[' + NB + '];',
    'varying vec2 vOff;',
    'varying vec2 vLook;           /* size, brightness */',
    'void main() {',
    '  vec4 b = ' + pick + ';',
    '  vOff = aPos.xy * (' + lit(BODY_HALO) + ' * b.z + 1.0);',
    '  vLook = b.zw;',
    '  gl_Position = vec4(clipXY(b.xy + vOff), ' + lit(NEAR) + ', 1.0);',
    '}'
  ].join('\n');
  /* the core over the halo, premultiplied (the halo a radial gradient, then
     the core's disc) */
  const BODY_FS = [
    'varying vec2 vOff;',
    'varying vec2 vLook;',
    'uniform float uPx;',
    'void main() {',
    '  float r = length(vOff), core = ' + lit(BODY_CORE) + ' * vLook.x, halo = ' + lit(BODY_HALO) + ' * vLook.x;',
    '  float inner = core * ' + lit(BODY_FLAT) + ';',
    '  float h = ' + lit(BODY_HALO_A) + ' * vLook.y * clamp(1.0 - (r - inner) / (halo - inner), 0.0, 1.0) * clamp((halo - r) * uPx + 0.5, 0.0, 1.0);',
    '  float c = vLook.y * clamp((core - r) * uPx + 0.5, 0.0, 1.0);',
    '  fragOut = vec4(' + rgb(DEEP) + ' * c + ' + rgb(HALO) + ' * h * (1.0 - c), c + h * (1.0 - c));',
    '}'
  ].join('\n');

  /* THE CARD's depth: its rect (uRect: x0, y0, x1, y1, CSS px) at the
     nearest depth there is, and no colour (the colour mask is off) */
  const OCC_VS = CLIP_GLSL + [
    'attribute vec2 aPos;          /* a corner, -1..1 */',
    'uniform vec4 uRect;',
    'void main() { gl_Position = vec4(clipXY(mix(uRect.xy, uRect.zw, aPos * 0.5 + 0.5)), -1.0, 1.0); }'
  ].join('\n');
  const OCC_FS = 'void main() { fragOut = vec4(0.0); }';

  /* what each thing is in the probes' id buffer (probeIds): the floor, the
     sun, cloud i, massif i (sceneryMesh's order), tree or conifer i */
  const ID_FLOOR = 1, ID_SUN = 2, ID_CLOUD = 10, ID_MASSIF = 20, ID_STROKE = 40;

  /* ---- the scenery's shaders ---------------------------------------------
     Everything standing on the sheet is placed in its vertex shader, from
     the same wave and projection as the floor (SHEET_GLSL) and the
     terrain's copy of the cursor field (TPUSH, scene.js) - nothing per
     vertex is kept anywhere between frames. The push functions are
     scene.js's terrainDip / terrainShove, in the same order of terms, from
     the scene's own constants; uPush is TPUSH (sx, sy, on), uS the scale. */
  /* the blooms (scene.js BLOOM, bloomAt): each one's place and strength;
     uS the scale */
  const BLOOM_GLSL = [
    'uniform float uS;',
    'uniform vec4 uBloom[2];',
    'float bloomAt(vec2 p) {',
    '  float r = ' + lit(BLOOM_R) + ' * uS, v = 0.0;',
    '  for (int i = 0; i < 2; i++) {',
    '    if (uBloom[i].z > 0.0) { vec2 q = p - uBloom[i].xy; v += uBloom[i].z * exp(-dot(q, q) / (2.0 * r * r)); }',
    '  }',
    '  return min(v, 1.0);',
    '}'
  ].join('\n') + '\n';
  const PUSH_GLSL = BLOOM_GLSL + [
    'uniform vec3 uPush[2];',
    'float gateAt(float y, float top, float bot) {',
    '  float pad = ' + lit(CUR_TERR_PAD) + ' * uS;',
    '  return y < top ? max(0.0, 1.0 - (top - y) / pad) : y > bot ? max(0.0, 1.0 - (y - bot) / pad) : 1.0;',
    '}',
    'float dipAt(float x, float top, float bot) {',
    '  float sx = ' + lit(CUR_TERR_SX) + ' * uS, s = 0.0;',
    '  for (int i = 0; i < 2; i++) {',
    '    if (uPush[i].z > 0.0) {',
    '      float dx = uPush[i].x - x, g = exp(-(dx * dx) / (2.0 * sx * sx));',
    '      float vy = gateAt(uPush[i].y, top, bot);',
    '      if (g > ' + lit(CUR_TERR_MIN) + ' && vy > 0.0) s += ' + lit(CUR_TERR_PUSH) + ' * uS * uPush[i].z * ((g - ' + lit(CUR_TERR_MIN)
      + ') / ' + lit(1 - CUR_TERR_MIN) + ') * vy;',
    '    }',
    '  }',
    '  return s;',
    '}',
    'float shoveAt(float x, float top, float bot, float amp) {',
    '  float sx = ' + lit(CUR_TERR_SX) + ' * uS, s = 0.0;',
    '  for (int i = 0; i < 2; i++) {',
    '    if (uPush[i].z > 0.0) {',
    '      float u = (x - uPush[i].x) / sx, au = abs(u);',
    '      float vy = gateAt(uPush[i].y, top, bot);',
    '      if (au < ' + lit(CUR_SIDE_END) + ' && vy > 0.0) {',
    '        float q = clamp((' + lit(CUR_SIDE_END) + ' - au) / ' + lit(CUR_SIDE_END - CUR_SIDE_FADE) + ', 0.0, 1.0);',
    '        float fade = au > ' + lit(CUR_SIDE_FADE) + ' ? q * q * (3.0 - 2.0 * q) : 1.0;',
    '        s += amp * uPush[i].z * vy * u * exp(-(u * u) / 2.0) * fade;',
    '      }',
    '    }',
    '  }',
    '  return s;',
    '}',
    /* the sheet's slide at depth dd (shiftX), its rest plane there (restAt),
       and the floor under screen x at depth dd: surfacePoint's y at
       (worldX(x, dd), dd) - what everything standing on the sheet stands on */
    'float shiftAt(float dd) { return uView.w * max(0.0, (' + lit(PAR_D0) + ' - dd) / ' + lit(PAR_D0 - 1) + '); }',
    'float restAt(float dd) { return uView.z + uView.y * ' + lit(PERSP_Y) + ' / dd; }',
    'float floorOf(float x, float dd, float dents) {',
    '  float sn = (x - uView.x * 0.5 - shiftAt(dd)) / (uView.x * ' + lit(PERSP_X) + ');',
    '  return restAt(dd) + waveOf(sn * dd, dd, dents) * uView.y * ' + lit(WAVE_Y) + ' / dd;',
    '}',
    'float floorAt(float x, float dd) { return floorOf(x, dd, 1.0); }',
    /* the same without the cursor's dents: what the scenery's lines are
       kept straight against (massifAt) */
    'float refAt(float x, float dd) { return floorOf(x, dd, 0.0); }'
  ].join('\n') + '\n';
  /* A massif's point on screen (CSS px), from its attributes (sceneryMesh).
     standAt: the point stood on the floor - the cursor's push read at its
     xc over its span (the crest above it, or its peak's summit), a peak
     slid aside as one by the shove at its centre, and then the point set
     on the floor under where it is drawn and raised by its height, pressed
     by the dip in proportion (g, which it returns), so the crest goes down
     by the whole dip and the foot stays on the floor. A facet's corners are
     placed so.

     massifAt: a point where the mesh cut an edge (slice) takes the height
     h' over the floor under it that the edge's straight line between its
     two corners has there (e: their x0 and h, L's and then R's; a point
     with no edge has L = R = itself), unless the floor bends away from
     that line by more than the point's slack, when it keeps to the slack
     (h' = h - clamp(off, slack)). It stands that high over the floor and
     is pressed as a corner is, but never by more than its span's height
     is (min(h', hspan): the straight crest stands a little proud of the
     crest's own height where the floor sags under it). The two ends of
     every cross-section then keep their order however the floor curves
     or the dip presses (min is monotone, and moves no more than h' does),
     so no piece turns over, every line bends only as far as that needs,
     and the push moves a point no more than it moves a corner: within the
     terrain's budget (check-terrain-jolt.js).

     The lines are kept straight against the floor without the cursor's
     dents (refAt), which move at the pointer's speed: kept straight
     against those, a pressed point moved with them by its share of the
     press (3.2 px in one frame with the pointer passing through the
     horizon; the budget is 1.0). So the lines over a dent sink into it
     with the floor, as the corners there do. Everything else in the floor
     moves slowly - the swell, its event, the bodies' wells - and stays in
     refAt. */
  const MASSIF_GLSL = [
    /* THE SHARDS (scene.js THE BLOOM): the placed point sp of a facet whose
       centroid is c (x, height in the mesh), turned about the centroid as
       placed (on the floor at the facet's depth dd, the same for every
       corner), shrunk toward it and drifted out from xm on the ground, by
       the bloom over it, on the screen: a turn and a shrink are a
       similarity, and its blend with standing still by the facet's share
       (pin: nothing as its lowest corner, lo, nears the ground) keeps a
       positive determinant at every share, so no piece can turn over. (In
       the mesh, added to the floor's own bending, they turned slivers
       over by up to 2.5px at 390x844: check-scenery-mesh.) seed is the
       facet's own share. */
    'vec2 shardAt(vec2 sp, vec2 c, float lo, float xm, float seed, float dd) {',
    '  float cx = c.x + shiftAt(dd);',
    '  vec2 cp = vec2(cx, refAt(cx, dd) - c.y);',
    '  float b = bloomAt(cp);',
    '  if (b <= 0.0) return sp;',
    '  float pin = smoothstep(0.0, ' + lit(SHARD_PIN) + ' * uS, lo);',
    '  float th = -' + lit(SHARD_TURN) + ' * b * seed, cs = cos(th), sn = sin(th);',
    '  vec2 r = (sp - cp) * (1.0 - ' + lit(SHARD_SHRINK) + ' * b);',
    '  vec2 q = cp + vec2(cs * r.x - sn * r.y, sn * r.x + cs * r.y) + ' + lit(SHARD_DRIFT) + ' * b * vec2(c.x - xm, -c.y);',
    '  return sp + (q - sp) * pin;',
    '}',
    'vec3 standAt(vec4 p, vec4 o) {',
    '  float dd = o.x, shift = shiftAt(dd), rest = restAt(dd), top = rest - p.w;',
    '  float slide = o.z > 0.5 ? shoveAt(p.z + shift, top, rest, ' + lit(CUR_SIDE_PEAK) + ' * uS) : 0.0;',
    '  float dip = dipAt(p.z + shift + slide, top, rest);',
    '  float x = p.x + shift + slide, g = max(0.2, 1.0 - dip / p.w);',
    '  return vec3(x, refAt(x, dd) - (p.y > 0.0 ? p.y * g : p.y), g);',
    '}',
    'vec2 massifAt(vec4 p, vec4 o, vec4 e, float slack) {',
    '  vec3 s = standAt(p, o);',
    '  if (!(e.z > e.x)) return s.xy;',
    '  float u = (p.x - e.x) / (e.z - e.x), dx = s.x - p.x;',
    '  float off = mix(refAt(e.x + dx, o.x) - e.y, refAt(e.z + dx, o.x) - e.w, u) - (refAt(s.x, o.x) - p.y);',
    '  float h = p.y - clamp(off, -slack, slack);',
    '  return vec2(s.x, refAt(s.x, o.x) - h + (1.0 - s.z) * min(h, p.w));',
    '}'
  ].join('\n') + '\n';
  /* The meshes built for another size, fitted to this one while they wait
     to be built again (the renderer's scenery): uFit is W, H, S and SW now
     over what they were built at, less 1 - all 0 for meshes built at this
     size, where every fitted value is the attribute itself to the bit
     (x + x * 0). A ridge spans the width, so its x scales with W; a peak
     stands at its centre (xc), which scales with W, and its shape with S
     (peakPlace: its half-width is the band's, times S); heights scale with
     H, but for the skirt (h < 0), which is SKIRT px at every size. A
     tree's and a conifer's shape and height scale with S, their line
     widths with SW, their root with W; a cloud's facets with S, its centre
     with W and H. The pieces the cuts make are scaled as one, so none can
     turn over (slice). The fit is exact for the clouds, and for the trees
     and the conifers but for how far a stroke's end reaches past its point
     (SKIRT px, or half its width); a massif's details (the jags, the
     layers' corners, the cut lines) are what the build then redraws: in
     headless Chrome a drag's last frame is 0.93 levels off its own build
     on average in 8x8 px blocks beside the card, where the meshes drawn as
     they were built stood 6.35 off (check-scenery-settle). */
  const FIT_GLSL = [
    'uniform vec4 uFit;',
    'float fitX(float x, float xc, float peak) { return peak > 0.5 ? x + x * uFit.z + xc * (uFit.x - uFit.z) : x + x * uFit.x; }',
    'float fitH(float h) { return h > 0.0 ? h + h * uFit.y : h; }'
  ].join('\n') + '\n';
  const MASSIF_VS = SHEET_GLSL + PUSH_GLSL + MASSIF_GLSL + DEPTH_GLSL + CLIP_GLSL + FIT_GLSL + [
    'attribute vec4 aPos;          /* x0, h, xc, hspan */',
    'attribute vec4 aObj;          /* d, its nudge in depth, 1 if it slides, its id */',
    'attribute vec4 aEdgeA;        /* barycentric (two of three), edge widths 0 and 1 */',
    'attribute vec4 aEdgeB;        /* edge width 2, the fill */',
    'attribute vec4 aInk;          /* the line colour, its slack */',
    'attribute vec4 aEnd;          /* the edge it is a cut point of: its corners L and R, x0 and h each */',
    'attribute vec4 aCen;          /* its facet\'s centroid (x, h), its shard seed, its lowest corner\'s h */',
    'varying vec3 vBary;',
    'varying vec3 vW;',
    'varying vec3 vFill;',
    'varying vec3 vInk;',
    'varying vec2 vId;             /* its id, its 1/d */',
    'void main() {',
    '  vec4 p = vec4(fitX(aPos.x, aPos.z, aObj.z), fitH(aPos.y), aPos.z + aPos.z * uFit.x, aPos.w + aPos.w * uFit.y);',
    '  vec4 e = vec4(fitX(aEnd.x, aPos.z, aObj.z), fitH(aEnd.y), fitX(aEnd.z, aPos.z, aObj.z), fitH(aEnd.w));',
    '  vec2 c = vec2(fitX(aCen.x, aPos.z, aObj.z), fitH(aCen.y));',
    '  vec2 sp = shardAt(massifAt(p, aObj, e, aInk.w + aInk.w * uFit.y), c, fitH(aCen.w), aObj.z > 0.5 ? p.z : c.x, aCen.z, aObj.x);',
    '  gl_Position = vec4(clipXY(sp), depthAt(aObj.x) - aObj.y, 1.0);',
    '  vBary = vec3(aEdgeA.xy, 1.0 - aEdgeA.x - aEdgeA.y);',
    '  vW = vec3(aEdgeA.zw, aEdgeB.x);',
    '  vFill = aEdgeB.yzw;',
    '  vInk = aInk.xyz;',
    '  vId = vec2(aObj.w, 1.0 / aObj.x);',
    '}'
  ].join('\n');
  /* The line work, from the barycentric coordinates: each one's value over
     its screen gradient is the distance (device px) to the edge across from
     its corner, so every line is a constant width however the face is
     drawn, anti-aliased over a pixel - a facet line half its width on each
     side of an edge (each neighbour draws its own half), the silhouette its
     whole width inside the massif, which the multisampling smooths against
     whatever is behind. The fill and the lines are one opaque colour, so
     there is no seam for anything behind to show through. */
  const EDGE_GLSL = [
    'float edgeInk(vec3 bary, vec3 w, float px) {',
    '  vec3 g = vec3(length(vec2(dFdx(bary.x), dFdy(bary.x))), length(vec2(dFdx(bary.y), dFdy(bary.y))),',
    '                length(vec2(dFdx(bary.z), dFdy(bary.z))));',
    '  vec3 dist = bary / max(g, vec3(1e-9));',
    '  vec3 c = step(vec3(1e-3), w) * clamp(w * px - dist + 0.5, 0.0, 1.0);',
    '  return max(c.x, max(c.y, c.z));',
    '}'
  ].join('\n') + '\n';
  const MASSIF_FS = EDGE_GLSL + [
    'varying vec3 vBary;',
    'varying vec3 vW;',
    'varying vec3 vFill;',
    'varying vec3 vInk;',
    'varying vec2 vId;',
    'uniform float uPx;',
    'void main() { fragOut = vec4(mix(vFill, vInk, edgeInk(vBary, vW, uPx)), 1.0); }'
  ].join('\n');

  /* A tree or a conifer: one quad per segment of its line work, placed from
     the root - on the floor at its own x and depth, the floor without the
     cursor's dents (refAt; scene.js sheetOn). Its segments come posed
     (poseStrokes: the bloom's turns at the forks, on the CPU), so the foot
     stays planted and upright (README "The scenery"). */
  const STROKE_GLSL = [
    /* the root and the height for a tree at x0, depth dd, height h */
    'vec4 rootOf(float x0, float dd, float h) {',
    '  float x = x0 + shiftAt(dd);',
    '  return vec4(x, refAt(x, dd), max(h, 1.0), 0.0);',
    '}'
  ].join('\n') + '\n';
  const STROKE_VS = SHEET_GLSL + PUSH_GLSL + STROKE_GLSL + DEPTH_GLSL + CLIP_GLSL + FIT_GLSL + [
    'attribute vec4 aPos;          /* p1, p2 */',
    'attribute vec4 aObj;          /* q1, q2 */',
    'attribute vec4 aEdgeA;        /* along, across, half width, alpha */',
    'attribute vec4 aEdgeB;        /* x0, d, h, id */',
    'attribute vec4 aInk;          /* past p1, past p2 */',
    'uniform float uPx;',
    'varying vec2 vP;              /* this fragment, CSS px */',
    'varying vec4 vSeg;            /* the segment, CSS px */',
    'varying vec4 vSib;            /* the one not to darken twice, CSS px */',
    'varying vec4 vLook;           /* half width, alpha, past p1, past p2 */',
    'varying vec2 vId;',
    'void main() {',
    '  vec4 r = rootOf(aEdgeB.x + aEdgeB.x * uFit.x, aEdgeB.y, aEdgeB.z + aEdgeB.z * uFit.z);',
    '  vec4 seg = aPos + aPos * uFit.z, sib = aObj + aObj * uFit.z;',
    '  float hw = aEdgeA.z + aEdgeA.z * uFit.w;',
    '  vec2 a = r.xy + seg.xy, b = r.xy + seg.zw;',
    '  vec2 ab = b - a;',
    '  float len = length(ab);',
    '  vec2 dir = len > 1e-6 ? ab / len : vec2(0.0, -1.0), nrm = vec2(-dir.y, dir.x);',
    '  float m = 1.0 / uPx + 0.5;',
    '  vec2 p = (aEdgeA.x > 0.5 ? b + dir * (aInk.y + m) : a - dir * (aInk.x + m)) + nrm * aEdgeA.y * (hw + m);',
    '  vP = p;',
    '  vSeg = vec4(a, b);',
    '  vSib = vec4(r.xy + sib.xy, r.xy + sib.zw);',
    '  vLook = vec4(hw, aEdgeA.w, aInk.xy);',
    '  vId = vec2(aEdgeB.w, 1.0 / aEdgeB.y);',
    '  gl_Position = vec4(clipXY(p), depthAt(aEdgeB.y), 1.0);',
    '}'
  ].join('\n');
  /* A stroke's coverage of the fragment: within half its width across, and
     between its two ends (plus how far past them it reaches), each edge
     anti-aliased over a device pixel - Canvas 2D's butt-capped line. A
     segment with a sibling (the second child at a fork, the second half of
     a chevron) adds only what the first has not already drawn there, so
     the two overlap as one stroke, as they did in one Canvas path: with s
     and o the alphas (alpha times coverage) of the sibling, drawn first,
     and of this one, it draws (max(s, o) - s) / (1 - s), so the pair
     composites to a single max(s, o). A sibling reaches past its ends as this one does,
     mirrored - a chevron's two halves both reach past the apex they share
     (closing the notch two butt ends would leave there), siblings at a fork
     past neither - so its reach is this one's, swapped. */
  const STROKE_FS = [
    'varying vec2 vP;',
    'varying vec4 vSeg;',
    'varying vec4 vSib;',
    'varying vec4 vLook;',
    'varying vec2 vId;',
    'uniform float uPx;',
    'float coverOf(vec4 s, float hw, float e1, float e2) {',
    '  vec2 ab = s.zw - s.xy;',
    '  float len = length(ab);',
    '  if (len < 1e-6) return 0.0;',
    '  vec2 dir = ab / len, ap = vP - s.xy;',
    '  float along = dot(ap, dir), across = abs(dot(ap, vec2(-dir.y, dir.x)));',
    '  return clamp((hw - across) * uPx + 0.5, 0.0, 1.0) * clamp(min(along + e1, len + e2 - along) * uPx + 0.5, 0.0, 1.0);',
    '}',
    'float strokeAlpha() {',
    '  float own = vLook.y * coverOf(vSeg, vLook.x, vLook.z, vLook.w);',
    '  float sib = vLook.y * coverOf(vSib, vLook.x, vLook.w, vLook.z);',
    '  return sib > 0.0 ? max(0.0, max(own, sib) - sib) / max(1e-6, 1.0 - sib) : own;',
    '}',
    'void main() {',
    '  float a = strokeAlpha();',
    '  fragOut = vec4(' + rgb(INK) + ' * a, a);',
    '}'
  ].join('\n');

  /* A cloud, in the mountains' line art: its facets one pale fill, every
     facet's edge a line (half its width inside each neighbour), its outline
     a rim drawn inside it - static around its centre, the centre carried by
     the sky's parallax (skyX's par) and the horizon's tilt (tiltY): uSky is
     look.x * LOOK_X and tiltY(). Under the bloom each facet turns about its
     centroid as one, shrinks toward it and drifts out from the centre (THE
     SHARDS; scene.js THE BLOOM), the same way the mountains' turn. */
  const CLOUD_VS = CLIP_GLSL + FIT_GLSL + BLOOM_GLSL + [
    'attribute vec4 aPos;          /* lx, ly, cx, cy */',
    'attribute vec4 aObj;          /* par, barycentric (two of three), edge width 0 */',
    'attribute vec4 aEdgeA;        /* edge widths 1 and 2, its shard seed, its id */',
    'attribute vec4 aEdgeB;        /* the fill, the lines\' alpha */',
    'attribute vec4 aInk;          /* its facet\'s centroid (lx, ly) */',
    'uniform vec2 uSky;',
    'varying vec3 vBary;',
    'varying vec3 vW;',
    'varying vec4 vTone;           /* fill, the lines\' alpha */',
    'varying vec2 vId;',
    'void main() {',
    '  vec2 l = aPos.xy + aPos.xy * uFit.z, g = aInk.xy + aInk.xy * uFit.z;',
    '  vec2 c0 = aPos.zw + aPos.zw * uFit.xy + vec2(uSky.x * aObj.x, uSky.y);',
    '  float b = bloomAt(c0 + g);',
    '  if (b > 0.0) {',
    '    float th = -' + lit(SHARD_TURN) + ' * b * aEdgeA.z, cs = cos(th), sn = sin(th);',
    '    vec2 r = (l - g) * (1.0 - ' + lit(SHARD_SHRINK) + ' * b);',
    '    l = g + vec2(cs * r.x - sn * r.y, sn * r.x + cs * r.y) + ' + lit(CLOUD_DRIFT) + ' * b * g;',
    '  }',
    '  gl_Position = vec4(clipXY(c0 + l), ' + lit(NEAR) + ', 1.0);',
    '  vBary = vec3(aObj.yz, 1.0 - aObj.y - aObj.z);',
    '  vW = vec3(aObj.w, aEdgeA.xy);',
    '  vTone = aEdgeB;',
    '  vId = vec2(aEdgeA.w, 0.0);',
    '}'
  ].join('\n');
  const CLOUD_FS = EDGE_GLSL + [
    'varying vec3 vBary;',
    'varying vec3 vW;',
    'varying vec4 vTone;',
    'varying vec2 vId;',
    'uniform float uPx;',
    'void main() { fragOut = vec4(mix(vTone.xyz, ' + rgb(CLOUD_INK) + ', edgeInk(vBary, vW, uPx) * vTone.w), 1.0); }'
  ].join('\n');

  /* The probes (the header's test surface). PROBE_VS evaluates the wave
     and the projection at given points and packs one of them per pixel;
     DEPTH_FS writes the floor's 1/d (times DEPTH_NEAR, into [0, 1): all
     that can be drawn is farther than the near plane); LAYER_* is a
     stand-in for a later layer at one depth, drawn through the depth test. */
  const PROBE_VS = SHEET_GLSL + PACK_GLSL + [
    'attribute vec4 aPos;          /* xw, d, what (0 the wave, 1 screen x, 2 screen y), which pixel */',
    'uniform vec2 uGrid;           /* the target, px (its width a power of 2) */',
    'varying vec4 vPack;',
    'void main() {',
    '  vec2 p = sheetAt(aPos.x / aPos.y, aPos.y);',
    '  float f = aPos.z < 0.5 ? (waveAt(aPos.x, aPos.y) + 64.0) / 128.0 : ((aPos.z < 1.5 ? p.x : p.y) + 8192.0) / 32768.0;',
    '  vPack = pack24(f);',
    '  float row = floor((aPos.w + 0.5) / uGrid.x);',
    '  gl_Position = vec4((aPos.w - row * uGrid.x + 0.5) / uGrid.x * 2.0 - 1.0, (row + 0.5) / uGrid.y * 2.0 - 1.0, 0.0, 1.0);',
    '  gl_PointSize = 1.0;',
    '}'
  ].join('\n');
  const PROBE_FS = 'varying vec4 vPack;\nvoid main() { fragOut = vPack; }';
  const DEPTH_FS = PACK_GLSL + 'varying vec2 vSV;\nvoid main() { fragOut = pack24(vSV.y * ' + lit(DEPTH_NEAR) + '); }';
  const LAYER_VS = DEPTH_GLSL + 'attribute vec2 aPos;\nuniform float uD;\nvoid main() { gl_Position = vec4(aPos, depthAt(uD), 1.0); }';
  const LAYER_FS = PACK_GLSL + 'uniform float uD;\nvoid main() { fragOut = pack24(' + lit(DEPTH_NEAR) + ' / uD); }';
  /* The scenery's probes. SPOT_*: the shader's own placement of every
     massif corner (x, y) and of every stroke's bent ends (a.x, a.y, b.x,
     b.y), packed one value per pixel at aIdx * n + uWhich, so the tools
     can hold it to the scene. ID_*: the whole scene drawn as the frame
     draws it - the same order, the same depth test - but each fragment
     writing what it belongs to (red: ID_FLOOR, ID_SUN, ID_CLOUD + i,
     ID_MASSIF + i, ID_STROKE + i; a stroke where it covers at least half
     a pixel) and its 1/d (green, blue: 16 bits of 1/d * DEPTH_NEAR; 0 for
     the sky's things). */
  const ID_GLSL = 'vec4 idOut(float id, float v) { float q = floor(clamp(v * ' + lit(DEPTH_NEAR) + ', 0.0, 0.99999) * 65536.0); float hi = floor(q / 256.0);'
    + ' return vec4(id, hi, q - hi * 256.0, 255.0) / 255.0; }\n';
  const SPOT_MASSIF_VS = SHEET_GLSL + PUSH_GLSL + MASSIF_GLSL + PACK_GLSL + [
    'attribute vec4 aPos;',
    'attribute vec4 aObj;',
    'attribute vec4 aInk;',
    'attribute vec4 aEnd;',
    'attribute vec4 aCen;',
    'attribute float aIdx;',
    'uniform vec2 uGrid;',
    'uniform float uWhich;',
    'varying vec4 vPack;',
    'void main() {',
    '  vec2 q = shardAt(massifAt(aPos, aObj, aEnd, aInk.w), aCen.xy, aCen.w, aObj.z > 0.5 ? aPos.z : aCen.x, aCen.z, aObj.x);',
    '  vPack = pack24(((uWhich < 0.5 ? q.x : q.y) + 8192.0) / 32768.0);',
    '  float k = aIdx * 2.0 + uWhich, row = floor((k + 0.5) / uGrid.x);',
    '  gl_Position = vec4((k - row * uGrid.x + 0.5) / uGrid.x * 2.0 - 1.0, (row + 0.5) / uGrid.y * 2.0 - 1.0, 0.0, 1.0);',
    '  gl_PointSize = 1.0;',
    '}'
  ].join('\n');
  const SPOT_STROKE_VS = SHEET_GLSL + PUSH_GLSL + STROKE_GLSL + PACK_GLSL + [
    'attribute vec4 aPos;',
    'attribute vec4 aEdgeB;',
    'attribute float aIdx;',
    'uniform vec2 uGrid;',
    'uniform float uWhich;',
    'varying vec4 vPack;',
    'void main() {',
    '  vec4 r = rootOf(aEdgeB.x, aEdgeB.y, aEdgeB.z);',
    '  vec2 a = r.xy + aPos.xy, b = r.xy + aPos.zw;',
    '  float v = uWhich < 0.5 ? a.x : uWhich < 1.5 ? a.y : uWhich < 2.5 ? b.x : b.y;',
    '  vPack = pack24((v + 8192.0) / 32768.0);',
    '  float k = aIdx * 4.0 + uWhich, row = floor((k + 0.5) / uGrid.x);',
    '  gl_Position = vec4((k - row * uGrid.x + 0.5) / uGrid.x * 2.0 - 1.0, (row + 0.5) / uGrid.y * 2.0 - 1.0, 0.0, 1.0);',
    '  gl_PointSize = 1.0;',
    '}'
  ].join('\n');
  const ID_SHEET_FS = ID_GLSL + 'varying vec2 vSV;\nvoid main() { fragOut = idOut(' + lit(ID_FLOOR) + ', vSV.y); }';
  const ID_MASSIF_FS = ID_GLSL + 'varying vec2 vId;\nvoid main() { fragOut = idOut(vId.x, vId.y); }';
  const ID_CLOUD_FS = ID_GLSL + 'varying vec2 vId;\nvoid main() { fragOut = idOut(vId.x, 0.0); }';
  const ID_STROKE_FS = ID_GLSL + STROKE_FS.replace(/void main\(\) \{[\s\S]*$/, '')
    + 'void main() { if (strokeAlpha() < 0.5 * vLook.y) discard; fragOut = idOut(vId.x, vId.y); }';
  const ID_SUN_FS = ID_GLSL + 'varying vec2 vOff;\nuniform vec4 uDisc;\nvoid main() { if (length(vOff) > uDisc.z) discard; fragOut = idOut(' + lit(ID_SUN) + ', 0.0); }';

  /* The floor's mesh, as a triangle strip of (sn, d): one strip per pair of
     neighbouring mesh rows, joined by two repeated vertices (degenerate
     triangles), so the whole floor is one draw. Pure; node calls it too.
     Its rows, near to far: MESH_NEAR; the apron's, the u step mirrored
     through the first row; the rows' and on past the last; MESH_FAR. */
  function sheetMesh() {
    const nu = (ROWS - 1) * MESH_PER_ROW;
    const ds = [MESH_NEAR];
    let j0 = 0;
    while (1 - (DMAX - 1) * Math.pow((1 - j0) / nu, ROW_POW) > MESH_NEAR) j0--;
    for (let j = j0; j < 0; j++) ds.push(1 - (DMAX - 1) * Math.pow(-j / nu, ROW_POW));
    for (let j = 0; ; j++) {
      const d = 1 + (DMAX - 1) * Math.pow(j / nu, ROW_POW);
      if (j > nu && d >= MESH_FAR) break;
      ds.push(d);
    }
    ds.push(MESH_FAR);
    ds.push(MESH_END);
    const strips = ds.length - 1, per = 2 * (MESH_NX + 1);
    const out = new Float32Array(2 * (strips * per + 2 * (strips - 1)));
    let k = 0;
    const put = (sn, d) => { out[k++] = sn; out[k++] = d; };
    for (let j = 0; j < strips; j++) {
      /* the previous strip ended on (XSPAN, ds[j - 1]); this one starts on
         (-XSPAN, ds[j + 1]): each once more */
      if (j > 0) { put(XSPAN, ds[j - 1]); put(-XSPAN, ds[j + 1]); }
      for (let i = 0; i <= MESH_NX; i++) {
        const sn = -XSPAN + (2 * XSPAN * i) / MESH_NX;
        put(sn, ds[j + 1]);
        put(sn, ds[j]);
      }
    }
    return out;
  }
  /* ---- the scenery's meshes ---------------------------------------------
     Pure functions of the scene's tables at the current size (W, H, S),
     built once per size and drawn from static buffers; node calls
     sceneryMesh too (check-terrain-jolt.js, check-webgl-terrain.js). */

  /* The upper envelope, over [x0, x1], of `floor` and of tents [x, h, wl,
     wr] (an apex at height h falling to 0 a distance wl to its left and wr
     to its right), as the polyline through its corners: [[x, h], ...] in
     increasing x. */
  function envelope(tents, x0, x1, floor) {
    const lines = [[x0, floor, x1, floor]];
    for (const [x, h, wl, wr] of tents) lines.push([x - wl, 0, x, h], [x, h, x + wr, 0]);
    const on = (l, x) => (x < l[0] - 1e-9 || x > l[2] + 1e-9 ? -Infinity : l[1] + ((l[3] - l[1]) * (x - l[0])) / (l[2] - l[0]));
    const E = x => { let m = -Infinity; for (const l of lines) m = Math.max(m, on(l, x)); return m; };
    const xs = [x0, x1];
    for (const l of lines) xs.push(l[0], l[2]);
    for (let i = 0; i < lines.length; i++) {
      for (let j = i + 1; j < lines.length; j++) {
        const a = lines[i], b = lines[j];
        const sa = (a[3] - a[1]) / (a[2] - a[0]), sb = (b[3] - b[1]) / (b[2] - b[0]);
        if (Math.abs(sa - sb) < 1e-12) continue;
        const x = (b[1] - sb * b[0] - a[1] + sa * a[0]) / (sa - sb);
        if (x > Math.max(a[0], b[0]) && x < Math.min(a[2], b[2])) xs.push(x);
      }
    }
    const pts = [];
    for (const x of xs.filter(v => v >= x0 && v <= x1).sort((p, q) => p - q)) {
      if (pts.length && x - pts[pts.length - 1][0] < 1e-6) continue;
      pts.push([x, Math.max(0, E(x))]);
    }
    /* corners only: drop the points on a straight run */
    const out = [pts[0]];
    for (let i = 1; i < pts.length - 1; i++) {
      const p = out[out.length - 1], q = pts[i], r = pts[i + 1];
      const cross = (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
      if (Math.abs(cross) > 1e-6 * Math.max(1, (r[0] - p[0]) * (r[0] - p[0]))) out.push(q);
    }
    out.push(pts[pts.length - 1]);
    return out;
  }
  /* the height of polyline P (increasing x) at x */
  function heightAt(P, x) {
    if (x <= P[0][0]) return P[0][1];
    for (let i = 1; i < P.length; i++) {
      if (x <= P[i][0]) {
        const a = P[i - 1], b = P[i];
        return b[0] - a[0] < 1e-9 ? b[1] : a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0]);
      }
    }
    return P[P.length - 1][1];
  }
  /* A crest from an envelope: every edge longer than `run` px is broken by
     one or two points cut down into it - a notch, or a step - so the
     skyline is jagged between its summits. The envelope's own corners (the
     summits, the cols, the feet) stay where they are; nothing is raised
     above the envelope, so nothing can out-top a summit.

     No edge of it is steeper than `slope`: a notch is cut by a share of
     its own height, so one cut deep beside a tall summit, near the end of a
     steep flank, left the summit a needle - at 1440x900 an edge rising 9.27
     px per px and a spire 9 px wide standing 24 px over its notch (the
     final QA lens's splinters), at 1080x1920 36.7 and 0.09 as wide as it
     stood tall. Each notch is lifted, if it must be, until neither of its
     edges is steeper (the upper envelope of the crest under cones of that
     slope, in two passes; on an envelope no steeper than `slope` it never
     reaches the envelope's own corners, nor above the edge it was cut
     into), so every summit and every jag is at least 2 / slope as wide as
     it stands over its notches. */
  function jag(env, seed, run, cut, slope) {
    const out = [env[0]];
    for (let i = 1; i < env.length; i++) {
      const a = env[i - 1], b = env[i], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const n = len > 2.2 * run ? 2 : len > run ? 1 : 0;
      for (let k = 1; k <= n; k++) {
        const r1 = hash1(seed + i * 3.7 + k * 1.9), r2 = hash1(seed + i * 5.3 + k * 2.9);
        const f = (k - 0.5 + 0.5 * (r1 - 0.5)) / n;
        const h = a[1] + (b[1] - a[1]) * f;
        out.push([a[0] + (b[0] - a[0]) * f, h * (1 - cut * (0.35 + 0.65 * r2))]);
      }
      out.push(b);
    }
    for (let i = 1; i < out.length; i++) out[i][1] = Math.max(out[i][1], out[i - 1][1] - slope * (out[i][0] - out[i - 1][0]));
    for (let i = out.length - 2; i >= 0; i--) out[i][1] = Math.max(out[i][1], out[i + 1][1] - slope * (out[i + 1][0] - out[i][0]));
    return out;
  }
  /* The next layer down, [[x, h], ...] from the same x0 to the same x1.
     Its corners are where the lines from the layer above run down to: every
     summit of that layer (a corner higher than both its neighbours) sends
     two, one down each side and out, away from it - the arêtes - every
     notch (lower than both) one straight down - a gully - and some of the
     corners between send one down and out, away from the summit they
     belong to (apexX). Each lands at `ratio` of the height above it there,
     `drift` px out per px it drops, so the lines run diagonally down from
     the summits and the notches instead of straight down or all to one
     point. Then: no two corners closer than `space`; no gap wider than
     `wide` left without one; and every corner of either layer clearly on
     its own side (a share `gap` of the height above), the layer dipping
     under any notch it would pass over - so the band between the two is
     never pinched shut and its triangles cannot overlap.

     A peak's layers all started and ended at its feet, so at each foot the
     silhouette, both layers' first edges and the diagonals between them
     met in one point at shallow angles, a fan the eye reads however few
     lines it is (the final QA lens; 3.05 lines on a foot on average, up to
     4, at 1440x900). Now a layer copies the ground the layer above has at
     each end (the foot, and the touchdowns of the layers above it), and a
     layer above the ground touches down on it further in, FOOT_LAND of the
     way from there to its own first corner (give or take 0.15): the lines
     reach the ground one after another, and a foot keeps only the
     silhouette. A ridge's ends are not on the ground, and are one point
     each, as before. */
  function layerBelow(upper, apexX, ratio, drift, keep, gap, space, wide, seed) {
    const n = upper.length;
    let gl = 0, gr = n - 1;
    if (upper[0][1] <= 0) while (gl + 1 < n - 1 && upper[gl + 1][1] <= 0) gl++;
    if (upper[n - 1][1] <= 0) while (gr - 1 > gl && upper[gr - 1][1] <= 0) gr--;
    const x0 = upper[gl][0], x1 = upper[gr][0];
    const pts = [];
    const drop = (x, h, side, k) => {
      const h2 = heightAt(upper, x) * ratio * (0.85 + 0.3 * hash1(seed + k * 4.9));
      const lx = x + side * drift * (h - h2) * (0.7 + 0.6 * hash1(seed + k * 2.3));
      if (lx > x0 + space && lx < x1 - space) pts.push([lx, heightAt(upper, lx) * ratio * (0.68 + 0.64 * hash1(seed + k * 6.7))]);
    };
    for (let i = gl + 1; i < gr; i++) {
      const [x, h] = upper[i], hl = upper[i - 1][1], hr = upper[i + 1][1];
      if (h > hl && h > hr) { drop(x, h, -1, i); drop(x, h, 1, i + 0.5); }
      else if (h < hl && h < hr) drop(x, h, 0, i);
      else if (hash1(seed + i * 7.1) < keep) drop(x, h, x < apexX(x) ? -1 : 1, i);
    }
    pts.sort((p, q) => p[0] - q[0]);
    const L = upper.slice(0, gl + 1).map(p => [p[0], p[1] * ratio]);
    for (const p of pts) if (p[0] - L[L.length - 1][0] >= space) L.push(p);
    if (x1 - L[L.length - 1][0] < space && L.length > gl + 1) L.pop();
    const right = upper.slice(gr).map(p => [p[0], p[1] * ratio]);
    L.push(...right);
    for (let i = gl + 1; i < L.length - right.length + 1; i++) {
      const g = L[i][0] - L[i - 1][0];
      if (g > wide) {
        const k = Math.ceil(g / wide), xa = L[i - 1][0];
        const add = [];
        for (let j = 1; j < k; j++) {
          const x = xa + (g * (j + 0.4 * (hash1(seed + xa * 0.013 + j) - 0.5))) / k;
          add.push([x, heightAt(upper, x) * ratio * (0.85 + 0.3 * hash1(seed + x * 0.029))]);
        }
        L.splice(i, 0, ...add);
        i += add.length;
      }
    }
    if (ratio > 0 && L.length - right.length > gl + 1) {
      if (upper[0][1] <= 0) {
        const a = L[gl], b = L[gl + 1];
        L.splice(gl + 1, 0, [a[0] + (b[0] - a[0]) * (FOOT_LAND + 0.3 * (hash1(seed + 0.61) - 0.5)), 0]);
      }
      if (upper[n - 1][1] <= 0) {
        const k = L.length - right.length, a = L[k - 1], b = L[k];
        L.splice(k, 0, [b[0] - (b[0] - a[0]) * (FOOT_LAND + 0.3 * (hash1(seed + 0.83) - 0.5)), 0]);
      }
    }
    for (let pass = 0; pass < 60; pass++) {
      let ok = true;
      for (const p of L) {
        const cap = heightAt(upper, p[0]) * (1 - gap);
        if (p[1] > cap) { p[1] = cap; ok = false; }
      }
      for (const [x, h] of upper) {
        if (heightAt(L, x) <= h * (1 - gap) + 1e-9) continue;
        ok = false;
        /* a notch the layer would pass over: dip under it */
        let at = 0;
        while (at < L.length && L[at][0] < x) at++;
        if (at > 0 && at < L.length && Math.min(x - L[at - 1][0], L[at][0] - x) > space * 0.5) L.splice(at, 0, [x, h * ratio]);
        else for (const q of [L[Math.max(0, at - 1)], L[Math.min(L.length - 1, at)]]) q[1] = Math.min(q[1], h * ratio);
      }
      if (ok) break;
    }
    return L;
  }
  /* Triangles between two layers that run from the same x0 to the same
     x1, `upper` above `lower` at every corner, as a strip: walked left to
     right, each triangle one edge of either layer and two edges between
     them. It goes on to whichever layer's next corner comes first, unless
     the new edge between the layers would leave the band - a notch in the
     layer above dipping below it, or a corner of the one below rising
     over it - when it goes on along the other layer instead (`clear`: every
     corner of either layer inside the edge's span is on its own side of
     it, upper above and lower below). tri(a, b, c, kab, kbc, kca) gets each
     triangle with the kind of each edge: uk for upper's own edges, lk for
     lower's, `diag` between them. Returns the corner of the layer above
     that left neither way clear (a notch the layer below has no corner
     under), or null when every step was clear; tri is not called then
     (dry: true asks only that).

     Under the crest (room: SLIVER) a step the other way round where the
     first way leaves a sliver. The silhouette is drawn inside its own
     facet only, so it can be no wider than that facet, and going to
     whichever corner comes first now and then gave a crest edge a facet
     whose apex, the layer's corner behind it, lay all but on the line of
     the edge: at 1440x900 a near band's crest edge just below the writing
     tab's card, 39 px long, had a facet 0.49 px deep along all of it, so
     its 1.9 px silhouette inked less than 0.8 px along 15 px of it with
     every line in, and along 31 px once economise took the line beside it
     out (54.5 px at 2560x1440: the final review; 59 at 3840x2160). A crest
     edge whose facet reaches less than `room` in from it, with the crest
     edges after it that share its apex, then takes the layer's next corner
     instead (the step to that corner moved before theirs: the same strip
     after them, so nothing else changes), where every new edge is clear
     and the thinnest of their facets comes out deeper: 0-25 such moves at
     each of check-scenery-mesh's nine sizes, 8 at 1440x900. */
  function zipper(U, L, uk, lk, diag, tri, dry, room) {
    const side = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    let block = null;
    const clear = (lo, up) => {
      const xa = Math.min(lo[0], up[0]), xb = Math.max(lo[0], up[0]);
      const [a, b] = lo[0] <= up[0] ? [lo, up] : [up, lo];
      for (const p of U) if (p[0] > xa + 1e-9 && p[0] < xb - 1e-9 && side(a, b, p) <= 0) { block = block || p; return false; }
      for (const p of L) if (p[0] > xa + 1e-9 && p[0] < xb - 1e-9 && side(a, b, p) >= 0) return false;
      return true;
    };
    const steps = [];
    let i = 0, j = 0;
    while (i < U.length - 1 || j < L.length - 1) {
      block = null;
      const canU = i < U.length - 1 && clear(L[j], U[i + 1]);
      const canL = j < L.length - 1 && clear(L[j + 1], U[i]);
      let goU = j >= L.length - 1 || (i < U.length - 1 && U[i + 1][0] <= L[j + 1][0]);
      if (goU && !canU && canL) goU = false;
      else if (!goU && !canL && canU) goU = true;
      if (!(goU ? canU : canL)) return block || U[Math.min(U.length - 1, i + 1)];
      steps.push(goU);
      if (goU) i++; else j++;
    }
    if (dry) return null;
    if (room) {
      /* how far facet (a, b, c) reaches in from its edge ab, at most */
      const deep = (a, b, c) => {
        const l = Math.hypot(b[0] - a[0], b[1] - a[1]), t = ((c[0] - a[0]) * (b[0] - a[0]) + (c[1] - a[1]) * (b[1] - a[1])) / l;
        return Math.abs(side(a, b, c)) / Math.max(l, l - t, t);
      };
      for (let k = 0, iu = 0, jl = 0; k < steps.length; k++) {
        if (steps[k] && Math.abs(side(U[iu], U[iu + 1], L[jl])) >= 1e-6 && deep(U[iu], U[iu + 1], L[jl]) < room) {
          let k2 = k;
          while (k2 < steps.length && steps[k2]) k2++;
          const n = k2 - k;
          let ok = k2 < steps.length && clear(L[jl + 1], U[iu]), was = Infinity, now = Infinity;
          for (let m = 0; ok && m < n; m++) {
            was = Math.min(was, deep(U[iu + m], U[iu + m + 1], L[jl]));
            now = Math.min(now, deep(U[iu + m], U[iu + m + 1], L[jl + 1]));
            ok = m === n - 1 || clear(L[jl + 1], U[iu + m + 1]);
          }
          if (ok && now > was) {
            steps[k] = false;
            steps.fill(true, k + 1, k2 + 1);
            k = k2; iu += n; jl++;
            continue;
          }
        }
        if (steps[k]) iu++; else jl++;
      }
    }
    i = j = 0;
    for (const goU of steps) {
      if (goU) { tri(U[i], U[i + 1], L[j], uk, diag, diag); i++; }
      else { tri(U[i], L[j], L[j + 1], diag, lk, diag); j++; }
    }
    return null;
  }
  /* The layer below given a corner under each notch of the one above that
     blocks their strip (zipper), until none does (a notch's own corner
     below it is a gully: the strip goes down into it and up again). At
     most a few are ever needed; _tools/check-scenery-mesh.js samples every
     massif at 9 sizes and finds every point under its crest covered by
     exactly one triangle and nothing above it. */
  function unblock(U, L, ratio) {
    for (let k = 0; k < 24; k++) {
      const p = zipper(U, L, null, null, null, null, true);
      if (!p) return;
      let at = 0;
      while (at < L.length && L[at][0] < p[0]) at++;
      if (!(at > 0 && at < L.length && L[at][0] !== p[0])) return;
      L.splice(at, 0, [p[0], Math.min(heightAt(L, p[0]), p[1] * ratio)]);
    }
  }

  /* A massif's crest, [[x, h], ...] in px from its own x0 (the screen x it
     stands at with the view at rest), with `apexX(x)`, the summit a point
     at x belongs to (for which way its spurs run).

     A peak (BANDS) has one summit, where the Canvas renderer's peak had it
     (pkPos), its flanks falling straight to 0 at both feet (no end wall:
     audit F59; the Canvas peak's fixed 0.60 half-width stood 46-81 px tall
     where it was cut off), one or two lower summits standing proud of each
     flank, and notches cut between. A backdrop ridge (RIDGES) is the Canvas
     ridge's summits (ridgeSummits) as straight-flanked tents over its
     raised floor, with a foothill in each wide gap between them.

     No edge of either is steeper than CREST_SLOPE (jag, which lifts the
     notches). A peak's tents are kept to it too: a lower summit stood up to
     4.0 times as tall as it was half-wide at 1440x900 (10.6 at 390x844), and
     where the peak's own half-width would make a flank steeper (a narrow
     window, where S = W / 1100 binds: at 1080x1920 the near peaks stand
     1.67-2.35 times as tall as half-wide) its foot moves out instead, the
     crest spanning every tent's feet: at 1440x900 no foot moves, at
     1080x1920 19 of the 20, by up to 148 px. A ridge's summits are kept to
     RIDGE_SLOPE, and its foothills now too (up to 4.7 times as tall as
     half-wide at 1440x900, 16.3 at 390x844: spikes over the ridge's floor). */
  function peakCrest(b, k) {
    const S = Bg.S;
    const { sd, fx, mh, mw } = peakPlace(b, k);
    const xs = -mw + 2 * mw * (0.28 + 0.44 * hash1(sd + 3.3));
    const wl = Math.max(xs + mw, mh / CREST_SLOPE), wr = Math.max(mw - xs, mh / CREST_SLOPE);
    const tents = [[xs, mh, wl, wr]];
    for (const side of [-1, 1]) {
      const L = side < 0 ? wl : wr;
      const n = hash1(sd + side * 4.4 + 9) > 0.45 ? 2 : 1;
      for (let j = 0; j < n; j++) {
        const t = 0.32 + (0.38 * (j + 0.5 + 0.5 * (hash1(sd + side * 6.1 + j * 1.7 + 9) - 0.5))) / n;
        const h = mh * (1 - t) + mh * (0.05 + 0.08 * hash1(sd + side * 8.3 + j * 2.1 + 9));
        const w = Math.max(h / CREST_SLOPE, Math.min(L * (1 - t) * 0.9, L * (0.17 + 0.10 * hash1(sd + side * 9.7 + j * 3.1 + 9))));
        tents.push([xs + side * L * t, h, w, w]);
      }
    }
    let x0 = -mw, x1 = mw;
    for (const t of tents) { x0 = Math.min(x0, t[0] - t[2]); x1 = Math.max(x1, t[0] + t[3]); }
    const crest = jag(envelope(tents, x0, x1, 0), sd + 0.5, 42 * S, 0.2, CREST_SLOPE);
    crest[0][1] = crest[crest.length - 1][1] = 0;
    return { crest, apexX: () => xs, fx, mh, mw, sd };
  }
  function ridgeCrest(r) {
    const W = Bg.W, H = Bg.H, S = Bg.S;
    const summits = ridgeSummits(r);
    const floor = r.floor * r.hmax * H, x0 = -0.08 * W, x1 = 1.08 * W;
    /* no flank steeper than RIDGE_SLOPE: tall and narrow, a summit is a
       party hat; this wide, neighbours run into one massif */
    const tents = summits.map(([tt, hh, ww]) => {
      const w = Math.max(RIDGE_SPREAD * ww * W, (hh * H) / RIDGE_SLOPE);
      return [tt * W, hh * H, w, w];
    });
    const tops = tents.map(t => t[0]).sort((p, q) => p - q);
    for (let j = 0; j + 1 < tops.length; j++) {
      const gap = tops[j + 1] - tops[j];
      if (gap < 0.12 * W) continue;
      const u = 0.35 + 0.3 * hash1(r.seed + j * 5.9 + 0.7);
      const fh = floor * (1.15 + 0.3 * hash1(r.seed + j * 3.3 + 0.9)), fw = Math.max(gap * 0.18, fh / RIDGE_SLOPE);
      tents.push([tops[j] + gap * u, fh, fw, fw]);
    }
    const crest = jag(envelope(tents, x0, x1, floor), r.seed + 0.25, 30 * S, 0.16, CREST_SLOPE);
    return { crest, apexX: x => { let best = tops[0]; for (const t of tops) if (Math.abs(t - x) < Math.abs(best - x)) best = t; return best; } };
  }

  /* How a massif looks, far to near: RIDGES[0], RIDGES[1], BANDS[0],
     BANDS[1]. fill: the share of the card's tone (--surface) over the page
     grey (COAT) - nearly the same pale tone throughout, a touch greyer far
     away; ink: the share of the line colour (--accent-deep) over the page
     grey, so the far ranges' lines fade toward the page and the layers keep
     their depth; line and rim: the facet lines' and the silhouette's widths
     in CSS px (the silhouette heavier). The reference's ink is bold, and at
     0.75-0.9 px of 0.30-0.80 ink the far ridges read as washed out (the
     final QA lens): the near band is now the full --accent-deep, 1.1 px
     lines and a 1.9 px silhouette, and every range behind it a step
     lighter and thinner. */
  /* the clouds' look, in the massifs' terms (the lit fill's share; the
     shade, how far toward the line colour a facet turned from the light
     goes; line and rim widths; the ink's share is CLOUD_INK_SHARE, up with
     the colours) and the lines' alpha, times 0.6-1 by each cloud's own */
  const CLOUD_LOOK = { fill: 0.92, shade: 0.42, line: 0.8, rim: 1.2, alpha: 0.9 };
  /* the light on the clouds' relief: up and to the left */
  const CLOUD_LIGHT = [-0.55, -0.84];
  const MASSIF_LOOK = [
    { fill: 0.55, ink: 0.48, line: 0.9, rim: 1.3 },
    { fill: 0.72, ink: 0.62, line: 0.95, rim: 1.45 },
    { fill: 0.88, ink: 0.80, line: 1.0, rim: 1.65 },
    { fill: 1.00, ink: 1.00, line: 1.1, rim: 1.9 }
  ];
  /* The crests and the layers under them:
       RIDGE_SPREAD   a ridge summit's half-width against the Canvas ridge's
       RIDGE_SLOPE    and no flank steeper than this, so the summits of a
                      backdrop run into one massif instead of a row of hats
       LAYER_R1, _R2  the two layers' heights, as shares of the one above
       SPUR_DRIFT     how far out a line drifts per px it drops
       LAYER_GAP      the least share of the height above a layer keeps clear
       LAYER_SPACE    px (at S = 1) the corners of the first layer keep apart
                      (2x and 3.5x that below: the lower layers' corners
                      sparser, for broad facets at the feet), and LAYER_WIDE
                      the widest gap it may leave without one (1.6x, 2.4x)
       CREST_SLOPE    no edge of a crest steeper than this (jag, peakCrest):
                      61 degrees, every summit and jag at least 1.11 as wide
                      as it stands over its notches
       FOOT_LAND      how far in from the ground's end a peak's layer
                      touches down, as a share of the way to its first corner
                      (layerBelow)
       FAN_CAP        the most lines at any point (economise)
       MIN_FACET      px^2 (at S = 1) the smallest facet as it is seen low on
                      a massif, in the lowest MIN_LOW of its crest's height
                      (economise)
       LINE_TURN      how far (radians) an edge may leave a facet's corner
                      from the side of a piece that meets it there alone
                      and still have that piece draw its line (sceneryMesh)
       SLIVER         px: how thin, in from its crest edge, a facet under
                      the crest may be before the zipper tries the other
                      way round (zipper), and the least a corner of the
                      first layer stands off the crest, square to it
                      (clearOf); the silhouette, 1.9 px at most, and the
                      px it is anti-aliased over fit inside that
       RIM_HOLD,      px: economise takes out no line that runs within
       RIM_ALONG      RIM_HOLD of a crest edge along more than RIM_ALONG of
                      it, more than 2 x its silhouette's width from either
                      end of it
       RUN_ON         px: where the silhouette runs on past a corner of its
                      crest edge into the massif by more than its own width
                      and this, economise takes the line beside the run-on
                      out last, and by more than twice this not at all */
  const RIDGE_SPREAD = 1.45, RIDGE_SLOPE = 1.15, CREST_SLOPE = 1.8, FOOT_LAND = 0.5;
  const LAYER_R1 = 0.6, LAYER_R2 = 0.46, SPUR_DRIFT = 0.42, LAYER_GAP = 0.12, LAYER_SPACE = 18, LAYER_WIDE = 90;
  const FAN_CAP = 6, MIN_FACET = 900, MIN_LOW = 0.4, LINE_TURN = Math.PI / 6, SLIVER = 3, RIM_HOLD = 1, RIM_ALONG = 3, RUN_ON = 1;
  /* A massif's base is cut along the same lines as the rest of it, so it is
     walked at the cut lines; the mesh reaches SKIRT px below the base,
     where the floor in front hides it (depth), and that closes the sliver
     the chord between two cut lines leaves where the floor's contour sags
     below it. The cut lines are never further apart than gridAt allows
     (at least BASE_STEP px), so that the sag is at most SKIRT - SAG_ROOM.
     SLACK_MARGIN (px) is the least the two ends of a cross-section are kept
     apart (see slice). */
  const BASE_STEP = 12, SKIRT = 6, SAG_ROOM = 2, SLACK_MARGIN = 0.5;

  /* The first layer's corners kept `room` px off the crest C, square to it.
     LAYER_GAP keeps a corner a share of the height above it under the
     crest, measured straight down; low on a steep flank, by a foot, that
     share is a px or two, and square to a 1.8 slope only half of it. At
     390x844 a corner 3.7 px under a crest's last edge before its foot stood
     1.81 px off it, so the facet between them, which the silhouette is
     drawn in, thinned to nothing at the foot, where no other line may land
     (spread): 4.5 px of that silhouette inked less than 0.8 px. A corner
     closer than `room` drops straight down until it is not (0-5 corners at
     each of check-scenery-mesh's nine sizes, all within 15 px of the
     ground); one the ground itself is that close to (a foot's own corner
     zone) stays where it is. */
  function clearOf(C, L, room) {
    const off = (x, h) => {
      let d = Infinity;
      for (let i = 1; i < C.length; i++) {
        const a = C[i - 1], b = C[i];
        if (b[0] < x - room || a[0] > x + room) continue;
        const dx = b[0] - a[0], dy = b[1] - a[1], u = Math.max(0, Math.min(1, ((x - a[0]) * dx + (h - a[1]) * dy) / (dx * dx + dy * dy)));
        d = Math.min(d, Math.hypot(x - a[0] - u * dx, h - a[1] - u * dy));
      }
      return d;
    };
    for (const p of L) {
      if (!(p[1] > 0) || off(p[0], p[1]) >= room || off(p[0], 0) < room) continue;
      let lo = 0, hi = p[1];
      for (let k = 0; k < 30; k++) { const mid = (lo + hi) / 2; if (off(p[0], mid) >= room) lo = mid; else hi = mid; }
      p[1] = lo;
    }
  }

  /* Every facet of a massif: its corners [x, h] and the kind of each edge -
     'rim' (the silhouette), 'line' (a layer's own edge), 'diag' (a facet
     line between two layers) or 'base' (on the ground, never drawn).
     sceneryMesh leaves some lines out (economise) and cuts the facets into
     the pieces it draws (slice). */
  function massifTris(c, seed, tri) {
    const sp = LAYER_SPACE * Bg.S, wide = LAYER_WIDE * Bg.S;
    const L1 = layerBelow(c.crest, c.apexX, LAYER_R1, SPUR_DRIFT, 0.45, LAYER_GAP, sp, wide, seed + 11);
    clearOf(c.crest, L1, SLIVER);
    const L2 = layerBelow(L1, c.apexX, LAYER_R2, SPUR_DRIFT, 0.4, LAYER_GAP, sp * 2, wide * 1.6, seed + 23);
    const B = layerBelow(L2, c.apexX, 0, SPUR_DRIFT, 0.35, 0, sp * 3.5, wide * 2.4, seed + 37);
    for (const [U, L, r] of [[c.crest, L1, LAYER_R1], [L1, L2, LAYER_R2], [L2, B, 0]]) unblock(U, L, r);
    zipper(c.crest, L1, 'rim', 'line', 'diag', tri, false, SLIVER);
    zipper(L1, L2, 'line', 'line', 'diag', tri);
    zipper(L2, B, 'line', 'base', 'diag', tri);
  }
  /* The line economy, over one massif's facets (sceneryMesh, before they
     are cut): which of the lines inside it to leave out - a diagonal or a
     layer's own edge, never the silhouette. Two facets either side of a
     line taken out read as one; the triangles stay (the fill is one tone),
     so it costs nothing to draw.

       fans     the zipper joins every corner of a layer to all the corners
                of the next that lie over it, so a corner under a run of
                the crest's jags, or over a sparser layer, had them all:
                up to 10 lines at one point at 1440x900, 97 points with 7
                or more (the final QA lens's fans at the feet). At a point
                with more than FAN_CAP, the line with the least room on
                either side of it goes, until it has FAN_CAP.
       facets   low on a massif, where a short tab's card leaves only the
                feet on show, the strips between the low layers and the
                ground were a band of small triangles (8.8 a 100 px reaching
                the lowest 75 px at 1440x900, a third of them under 600 px^2:
                the lens's band under the writing tab's card). A facet as it
                is seen, under MIN_FACET px^2 with its lowest corner in the
                lowest MIN_LOW of the crest's height, gives up the longest
                line it shares with a neighbour, smallest first.

     Never the silhouette, and never a line whose going would leave another
     ending in mid-air (a point off the crest and off the ground with one
     line). Nor a line the silhouette's width hangs on: the silhouette is
     drawn inside its own facet only, from that facet's barycentric
     distance, so where the facet is a sliver along the crest or a narrow
     wedge at one of its corners the line beside it carries the width on.
     The facet rule took those out low on the massifs, and the near band's
     1.9 px silhouette just below the writing tab's card thinned to a
     dotted grey trace: at 1440x900 it inked less than 0.8 px along 31 px
     of one crest edge (54.5 px at 2560x1440), and along 96 px of crest in
     all, against 21.5 px with every line in (the final review). So no line
     goes that runs within RIM_HOLD px of a crest edge along more than
     RIM_ALONG px of it, more than 2 x rim from either end (at the corners
     every facet narrows to a point), but at a peak's foot, where only the
     silhouette may land (spread). Held wherever it came nearer than
     RIM_HOLD instead, the line from a crest edge's top end down a wedge
     9-14 degrees wide was held for the 0.2-2.9 px of the edge's middle it
     came that near along, where it buys nothing, and the facet rule took
     the wedge's other line instead.

     That other line ran beside a run-on. A facet's line is its distance to
     its edge's whole line, so where a facet under the crest is obtuse at a
     corner A of its crest edge AB the silhouette runs on past A inside it,
     along its other edge from A, AC, for rim / sin(180 deg - the angle at
     A); where the crest turns up at A (the massif's corner reflex) that is
     inside the massif, under the crest edge before A, and with AC taken out
     it was a stub of the silhouette (at 1440x900@1.5 four such corners
     showed in check-webgl-terrain.js's three scene states, 1-3 device px
     each, up to 56 levels off the fill). The facet rule had left 191 such
     run-ons bare that reach 1.7 px (the check's 2.5 device px) past the
     silhouette's width, at the ten sizes tried (check-scenery-mesh's nine
     and the 1425x900 page check-webgl-terrain draws), before any of this.
     Now AC goes last, in both rules, where the run-on is more than RUN_ON
     px past rim, and not at all past 2 x RUN_ON: 12 are left, and 'broad'
     is 0.17 at most where it was 0.12 (its limit is 0.25). It keeps the
     build where it was (14-16 ms at 1440x900, the sparser lower layers and
     the spread feet making fewer triangles to cut; what is held and the
     moved steps add about 1 ms: medians of 11.5-12.4 ms before, 12.3-13.7
     after, three runs of 41 builds). */
  function economise(facets, kinds, crest, rim) {
    const n = facets.length, S2 = Bg.S * Bg.S;
    /* every corner its number: by the array, else by where it is (the
       ground the layers copy at a peak's feet is separate arrays) */
    const byArray = new Map(), byPlace = new Map(), pts = [];
    const idOf = p => {
      let i = byArray.get(p);
      if (i === undefined) {
        const k = p[0] + ',' + p[1];
        i = byPlace.get(k);
        if (i === undefined) { i = pts.length; byPlace.set(k, i); pts.push(p); }
        byArray.set(p, i);
      }
      return i;
    };
    const fv = new Int32Array(3 * n);
    for (let fi = 0; fi < n; fi++) for (let k = 0; k < 3; k++) fv[3 * fi + k] = idOf(facets[fi][k]);
    const np = pts.length, fixed = new Uint8Array(np);
    for (const p of crest) { const i = byPlace.get(p[0] + ',' + p[1]); if (i !== undefined) fixed[i] = 1; }
    for (let i = 0; i < np; i++) if (pts[i][1] <= 0) fixed[i] = 1;
    /* the edges: the facets' slots they are, whether lined, whether one may go */
    const byEdge = new Map(), edges = [], deg = new Int32Array(np), at = [];
    for (let i = 0; i < np; i++) at.push([]);
    for (let fi = 0; fi < n; fi++) {
      for (let s = 0; s < 3; s++) {
        let a = fv[3 * fi + (s + 1) % 3], b = fv[3 * fi + (s + 2) % 3];
        if (a > b) { const t = a; a = b; b = t; }
        const k = a * np + b;
        let e = byEdge.get(k);
        if (!e) { e = { a, b, refs: [], lined: false, free: true, last: false }; byEdge.set(k, e); edges.push(e); at[a].push(e); at[b].push(e); }
        e.refs.push(fi, s);
        const w = facets[fi][3 + s];
        if (w > 0) e.lined = true;
        if (kinds[fi][s] === 'rim' || w === rim) e.free = false;
      }
    }
    for (const e of edges) if (e.lined) { deg[e.a]++; deg[e.b]++; }
    /* the lines held for the silhouette's width: within RIM_HOLD of a
       crest edge AB beside its middle (more than 2 x rim from A and B),
       along more than RIM_ALONG of it, but at a foot. The crest is in
       increasing x: the edges near PQ's span are found by halving */
    const foot = new Set(), kth = new Int32Array(np).fill(-1);
    crest.forEach((p, k) => {
      const i = byPlace.get(p[0] + ',' + p[1]);
      if (i === undefined) return;
      kth[i] = k;
      if (p[1] <= 0 && (k === 0 || k === crest.length - 1)) foot.add(i);
    });
    for (const e of edges) {
      if (!e.free || !e.lined || foot.has(e.a) || foot.has(e.b)) continue;
      const P = pts[e.a], Q = pts[e.b], xa = Math.min(P[0], Q[0]) - RIM_HOLD, xb = Math.max(P[0], Q[0]) + RIM_HOLD;
      let lo = 1, hi = crest.length - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (crest[mid][0] < xa) lo = mid + 1; else hi = mid; }
      for (let i = lo; i < crest.length && crest[i - 1][0] <= xb && e.free; i++) {
        const A = crest[i - 1], B = crest[i], l = Math.hypot(B[0] - A[0], B[1] - A[1]), s0 = 2 * rim, s1 = l - 2 * rim;
        if (s1 <= s0 || (A[1] <= 0 && B[1] <= 0)) continue;
        /* along AB (s) and in from it (d), at P and Q; PQ clipped to s0..s1,
           then to where it is within RIM_HOLD of AB (d is linear along it) */
        const ux = (B[0] - A[0]) / l, uy = (B[1] - A[1]) / l;
        const sP = (P[0] - A[0]) * ux + (P[1] - A[1]) * uy, sQ = (Q[0] - A[0]) * ux + (Q[1] - A[1]) * uy;
        const dP = (P[0] - A[0]) * uy - (P[1] - A[1]) * ux, dQ = (Q[0] - A[0]) * uy - (Q[1] - A[1]) * ux;
        if (Math.abs(sQ - sP) < 1e-9) continue;
        const a = (s0 - sP) / (sQ - sP), b = (s1 - sP) / (sQ - sP);
        let u0 = Math.max(0, Math.min(a, b)), u1 = Math.min(1, Math.max(a, b));
        if (u0 >= u1) continue;
        const d0 = dP + (dQ - dP) * u0, d1 = dP + (dQ - dP) * u1;
        if (d0 >= RIM_HOLD && d1 >= RIM_HOLD) continue;
        if (d0 >= RIM_HOLD) u0 += ((u1 - u0) * (d0 - RIM_HOLD)) / (d0 - d1);
        else if (d1 >= RIM_HOLD) u1 = u0 + ((u1 - u0) * (d0 - RIM_HOLD)) / (d0 - d1);
        if (Math.abs(sQ - sP) * (u1 - u0) > RIM_ALONG) e.free = false;
      }
    }
    /* the lines beside a run-on: at a facet's corner A on the crest where
       the crest turns up (going along it, p to A to q turns left), the
       facet obtuse at A; the run-on along AC is rim / sin(180 deg - the
       angle at A) */
    for (let fi = 0; fi < n; fi++) {
      for (let s = 0; s < 3; s++) {
        if (!(kinds[fi][s] === 'rim' || facets[fi][3 + s] === rim)) continue;
        for (const [ja, jb] of [[(s + 1) % 3, (s + 2) % 3], [(s + 2) % 3, (s + 1) % 3]]) {
          const ia = fv[3 * fi + ja], ic = fv[3 * fi + s], k = kth[ia];
          if (k <= 0 || k >= crest.length - 1) continue;
          const A = pts[ia], B = pts[fv[3 * fi + jb]], C = pts[ic], p = crest[k - 1], q = crest[k + 1];
          if ((A[0] - p[0]) * (q[1] - A[1]) - (A[1] - p[1]) * (q[0] - A[0]) <= 0) continue;
          const ux = B[0] - A[0], uy = B[1] - A[1], vx = C[0] - A[0], vy = C[1] - A[1];
          if (ux * vx + uy * vy >= 0) continue;
          const run = (rim * Math.hypot(ux, uy) * Math.hypot(vx, vy)) / Math.abs(ux * vy - uy * vx), e = byEdge.get(Math.min(ia, ic) * np + Math.max(ia, ic));
          if (e && run > rim + RUN_ON) { e.last = true; if (run > rim + 2 * RUN_ON) e.free = false; }
        }
      }
    }
    const can = e => e.free && e.lined && (fixed[e.a] || deg[e.a] > 2) && (fixed[e.b] || deg[e.b] > 2);
    const unline = e => {
      e.lined = false; deg[e.a]--; deg[e.b]--;
      for (let r = 0; r < e.refs.length; r += 2) facets[e.refs[r]][3 + e.refs[r + 1]] = 0;
    };
    /* fans, the most crowded point first */
    const crowded = [];
    for (let i = 0; i < np; i++) if (deg[i] > FAN_CAP) crowded.push(i);
    crowded.sort((p, q) => deg[q] - deg[p] || pts[p][0] - pts[q][0] || pts[p][1] - pts[q][1]);
    for (const v of crowded) {
      while (deg[v] > FAN_CAP) {
        const P = pts[v], ang = [];
        for (const e of at[v]) if (e.lined) { const o = pts[e.a === v ? e.b : e.a]; ang.push([Math.atan2(o[1] - P[1], o[0] - P[0]), e]); }
        ang.sort((x, y) => x[0] - y[0]);
        let best = null, room = Infinity;
        for (let i = 0; i < ang.length; i++) {
          const e = ang[i][1];
          if (!can(e)) continue;
          const a = ang[i][0], prev = ang[(i + ang.length - 1) % ang.length][0], next = ang[(i + 1) % ang.length][0];
          const g = Math.min((a - prev + 2 * Math.PI) % (2 * Math.PI), (next - a + 2 * Math.PI) % (2 * Math.PI));
          /* a line beside a run-on only where no other can go */
          if (best && (e.last !== best.last ? e.last : g >= room)) continue;
          room = g; best = e;
        }
        if (!best) break;
        unline(best);
      }
    }
    /* facets as they are seen: the triangles joined across every edge they
       share that has no line */
    const parent = new Int32Array(n), area = new Float64Array(n), low = new Float64Array(n);
    for (let fi = 0; fi < n; fi++) {
      const f = facets[fi];
      parent[fi] = fi;
      area[fi] = Math.abs((f[1][0] - f[0][0]) * (f[2][1] - f[0][1]) - (f[1][1] - f[0][1]) * (f[2][0] - f[0][0])) / 2;
      low[fi] = Math.min(f[0][1], f[1][1], f[2][1]);
    }
    const find = i => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
    const join = (i, j) => { i = find(i); j = find(j); if (i !== j) { parent[j] = i; area[i] += area[j]; low[i] = Math.min(low[i], low[j]); } };
    for (const e of edges) if (!e.lined && e.refs.length === 4) join(e.refs[0], e.refs[2]);
    let top = 0;
    for (const p of crest) top = Math.max(top, p[1]);
    const min = MIN_FACET * S2, under = MIN_LOW * top, small = [];
    for (let fi = 0; fi < n; fi++) if (find(fi) === fi && area[fi] < min && low[fi] < under) small.push(fi);
    small.sort((p, q) => area[p] - area[q] || p - q);
    for (const g0 of small) {
      for (let r = find(g0); area[r] < min; r = find(r)) {
        /* the longest line between it and a neighbour that may go */
        let best = null, len = 0;
        for (let fi = 0; fi < n; fi++) {
          if (find(fi) !== r) continue;
          for (let s = 0; s < 3; s++) {
            let a = fv[3 * fi + (s + 1) % 3], b = fv[3 * fi + (s + 2) % 3];
            if (a > b) { const t = a; a = b; b = t; }
            const e = byEdge.get(a * np + b);
            if (e.refs.length !== 4 || !can(e) || find(e.refs[0]) === find(e.refs[2])) continue;
            const l = Math.hypot(pts[a][0] - pts[b][0], pts[a][1] - pts[b][1]);
            if (best && (e.last !== best.last ? e.last : l <= len)) continue;
            len = l; best = e;
          }
        }
        if (!best) break;
        unline(best);
        join(best.refs[0], best.refs[2]);
      }
    }
  }

  /* Why the facets are cut before they are drawn, and why vertically.

     Every point of a massif stands on the floor under it, at its own x
     (standAt), and the floor curves: the swell, the swell event, the
     cursor's dents. A facet drawn as one flat triangle between corners at
     three different x is right only while the floor is near straight
     across it, and the wide, low ones - along the base, at the feet -
     turned inside out once it curved, their lines crossing their
     neighbours': at 1440x900 idle, 279 of 280 samples over 140 s had a
     lined triangle folded by more than 0.5 px (worst 13.8 px; 16.2 at
     390x844, 18.2 at 2560x1440), in every strip, the base's fans most; and
     9,562 with the pointer parked on a grid of 480 points (W2b review).

     A triangle with two corners on one vertical line cannot turn over: the
     two stand on the same floor and are pressed by the same g (standAt),
     so they keep their order, and the triangle its orientation, whatever
     the floor does. So every facet is cut along vertical lines at every x
     a corner of its massif stands at, and between those wherever two are
     further apart than gridAt allows (the ground, cut there too, then
     follows the floor, as the old fan over the base did), into pieces with
     two corners on one cut line (slice). With the floor's own height at
     every cut, though, the lines follow the floor as well, the silhouette
     included: at 1440x900, of the lined edges a cut line crosses, 38.5%
     bent more than 3 px at some time in 140 s and 30.1% of the silhouette's
     (by up to 13.9 px) - a rubber mountain, not straight line art.

     So a point where an edge is cut is drawn on the edge's straight line,
     and leaves it only where the floor bends away from that line by more
     than the point's slack (massifAt): half the height of the narrowest
     cross-section of a facet it is an end of, or all of it where the other
     end cannot move (a facet's corner, the ground), less SLACK_MARGIN.
     The two ends of every cross-section then keep their order, so no piece
     turns over, and an edge bends only as far as it must to stay that
     way: 10.9% of those edges more than 3 px in 140 s, 1.9% of the
     silhouette's (its edges by the feet), and half of them stay straight
     to a hundredth of a pixel. */
  /* The cut lines of a massif: every x its facets' corners stand at, and
     between them as many more, evenly, as keep no two more than `step`
     apart, in increasing x. */
  function cutsOf(xs, step) {
    xs.sort((p, q) => p - q);
    const out = [xs[0]];
    for (let i = 1; i < xs.length; i++) {
      const a = out[out.length - 1], g = xs[i] - a;
      if (!(g > 0)) continue;
      const n = Math.ceil(g / step - 1e-9);
      for (let k = 1; k < n; k++) out.push(a + (g * k) / n);
      out.push(xs[i]);
    }
    return out;
  }
  /* How far apart a massif's cut lines may be at depth d, in px: so far
     that the base's chord between two of them sags no more than
     SKIRT - SAG_ROOM below the floor's contour, which is at most K g^2 / 8
     for K the most the floor can curve there - its swells' amp * kx^2,
     the swell event's and the cursor's dent's depth / sigma^2 (both are
     Gaussians), in px^-1 (the bodies' wells reach the scenery's depths by
     a few hundredths of a px at most) - and never closer than BASE_STEP.
     23 px at 1440x900 and 40 at 3840x2160 (the floor sags 2.4 and 2.2 px
     below a chord at most: check-scenery-mesh.js); a phone's floor curves
     13 times as fast, and it keeps BASE_STEP. With the lines BASE_STEP
     apart everywhere the frame's GPU time at 1440x900@1.5 was 16.6% longer
     than before the facets were cut (Intel Arc, the card's rect occluded
     as the page draws it; 20.1% without); at these spacings it is 11.3%
     (14.4%), 0.14 ms - the extra triangles' edges, not the shader's math,
     which measured free. */
  function gridAt(d) {
    let k = CUR_DEPTH / (CUR_SIGMA2 / 2) + (EVENT_AMP0 + EVENT_AMP1) / (EVENT_SIGMA2 / 2);
    for (const w of WAVE) k += w.amp * w.kx * w.kx;
    const across = Bg.W * PERSP_X, bend = (k * Bg.H * WAVE_Y * d) / (across * across);
    return Math.max(BASE_STEP, Math.sqrt((8 * (SKIRT - SAG_ROOM)) / bend));
  }
  /* where x is in the sorted array a, which holds it */
  function indexOf(a, x) {
    let lo = 0, hi = a.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < x) lo = m + 1; else hi = m; }
    return lo;
  }
  /* A facet [a, b, c, wa, wb, wc] (corners [x, h], and the widths of the
     edges across from them) cut along the cut lines into the pieces between
     them, each a triangle with two of its corners on one cut line:
     piece(p, q, r) for each, and pair(p, q) for the two points the facet has
     on each cut line it spans, one above the other (its cross-section
     there). A point is [x, h, ba, bb, bc, k, edge, u, -1]: where it
     is; its barycentric coordinates in the facet (0 exactly on the edge
     across from that corner, which is what the line shader measures to, so
     a piece is drawn with its facet's lines); its cut line, cuts[k]; for a
     point inside an edge, the edge [L, R] (its corners, in increasing x)
     and how far along it, u (a corner of the facet has edge null); and
     a slot for sceneryMesh to keep its slack in. A point on an edge is found
     from L and R alone, so the two facets that share an edge cut it at the
     same points, to the bit. */
  function slice(f, cuts, piece, pair) {
    const P = [f[0], f[1], f[2]];
    const o = [0, 1, 2].sort((i, j) => P[i][0] - P[j][0]);
    const mid = P[o[1]][0];
    const corner = (i, k) => { const p = [P[i][0], P[i][1], 0, 0, 0, k, null, 0, -1]; p[2 + i] = 1; return p; };
    /* the point at cut k on the edge from corner i to corner j */
    const on = (i, j, k) => {
      const s = cuts[k], U = P[i], V = P[j];
      if (s === U[0]) return corner(i, k);
      if (s === V[0]) return corner(j, k);
      const [L, R] = U[0] < V[0] ? [U, V] : [V, U];
      const u = (s - L[0]) / (R[0] - L[0]), w = (s - U[0]) / (V[0] - U[0]);
      const p = [s, L[1] + (R[1] - L[1]) * u, 0, 0, 0, k, [L, R], u, -1];
      p[2 + i] = 1 - w; p[2 + j] = w;
      return p;
    };
    const k0 = indexOf(cuts, P[o[0]][0]), k2 = indexOf(cuts, P[o[2]][0]);
    let prev = null;
    for (let k = k0; k <= k2; k++) {
      const s = cuts[k];
      const a = on(o[0], o[2], k);
      const b = s < mid ? on(o[0], o[1], k) : s > mid ? on(o[1], o[2], k) : corner(o[1], k);
      const one = a[0] === b[0] && a[1] === b[1];
      if (!one) pair(a, b);
      if (prev) {
        const [a0, b0, one0] = prev;
        if (one0) piece(a0, a, b);
        else if (one) piece(a0, b0, a);
        else { piece(a0, b0, b); piece(a0, b, a); }
      }
      prev = [a, b, one];
    }
  }

  /* The scenery at the current size, as vertex arrays:

       massif   the ridges and the peaks, as the pieces their facets are cut
                into (slice): 24 floats a vertex, three a triangle (no
                shared vertices: each carries its facet's edge widths), near
                to far (the depth test then rejects what a nearer one hides
                before shading it)
                  x0, h, xc, hspan     where it stands, at rest: its x (px,
                                       view at rest, before the slide), its
                                       height over the floor (< 0: the
                                       skirt); the x the cursor's push is
                                       read at (a ridge: its own; a peak:
                                       its centre) and the height of the
                                       span it is read over (a ridge: the
                                       crest above it; a peak: its summit)
                  d, zb, slide, id     its depth; a nudge nearer in depth, so
                                       the peaks of one band (one d) overlap
                                       in a fixed order, later in front;
                                       1 for a peak, which slides; its id
                  b0, b1, w0, w1       its barycentric coordinates in its
                  w2, fill rgb         facet (two of three) and the facet's
                  line rgb, slack      edge widths, CSS px (the edge across
                                       from each corner); its fill and line;
                                       its slack, px (massifAt)
                  x0L, hL, x0R, hR     a point where an edge is cut: the
                                       edge's corners L and R (x0 and h, as
                                       above); L = R = the point itself for
                                       a facet's corner and on the ground,
                                       which stand where they are
       stroke   the trees and the conifers: 20 floats a vertex, six (a quad)
                a segment, far to near
                  p1, p2               the segment, px from the root, y up
                                       negative, before the bend
                  q1, q2               the segment it must not darken twice
                                       (its sibling at a fork, the other half
                                       of a chevron), or p1, p1 for none
                  along, across, hw, a which corner (0/1 along, -1/1 across),
                                       half its width (px) and its alpha
                  x0, d, h, id         the root (px, view at rest), its depth,
                                       the tree's height (its push's span)
                  e1, e2, 0, 0         how far past p1 and p2 it reaches (a
                                       chevron's apex, the trunk's foot)
       cloud    the clouds: 16 floats a vertex, three a triangle
                  lx, ly, cx, cy       px from its centre; the centre at rest
                  par, b0, b1, w0      its parallax; barycentric; the edge
                  w1, w2, a, id        widths of its outline and its alpha
                  tone rgb, 0          the facet's flat tone

     Built again for a new W, H or S, at most once every REBUILD_MS (the
     renderer's scenery(), which fits the meshes it has to the sizes in
     between). */
  const MASSIF_F = 28, STROKE_F = 20, CLOUD_F = 20;
  /* How far a massif's skirt and a trunk's root reach under the ground:
     the deepest the cursor's dents can sink the floor (CUR_DEPTH, the two
     dents never more than one together) at the nearest terrain depth, on
     screen, plus SKIRT. The terrain stands on the floor without the dents
     (refAt; scene.js sheetOn), so where a dent sinks the floor under a base
     this is what shows - the mountain, the trunk - and the nearer floor
     hides it everywhere else. */
  function sinkDepth(H) {
    let m = Infinity;
    for (const L of [RIDGES, BANDS, TREES, CONIFERS]) for (const o of L) if (o.d < m) m = o.d;
    return Math.ceil(CUR_DEPTH * (1 + CUR_EDGE) * H * WAVE_Y / m) + SKIRT;
  }
  /* THE FORKS (scene.js): the trees' and conifers' branches posed with the
     scene's turns at their joints (FORK.obj[object].off[segment]), which
     keep them out of the cursor's disc. sceneryMesh marks each segment (its
     vertices' last two floats): parent + 1 and a kind - 1 a tree branch on
     its parent's end, 2 a chevron arm whose second end is its apex, 3 one
     whose first end is (the apex on the conifer's trunk, its parent), 4 a
     trunk hinged at its root - plus 10 when it has the segment before it as
     its sibling (the overlap's other half, vSib); its object is its id less
     ID_STROKE, and its place in the object's own order is its place among
     the mesh's segments of that id. A branch starts at its parent's posed
     end at its own rest angle to the parent's posed one, plus its turn, so
     the turns carry through the tree. rest is the mesh's stroke array, out
     a copy written in place (both ends and the sibling's, every vertex); it
     returns whether out changed. Stateless: everything that poses a tree
     (the frame, the probes, scenery-twin.js) poses it the same way. */
  const POSE_SCRATCH = { n: 0, ang: null, ex: null, ey: null, rest: null, off: null };
  function poseStrokes(rest, out, wasPosed) {
    const F = STROKE_F, V = 6 * F, n = rest.length / V;
    if (FORK.idle) {
      if (!wasPosed) return false;
      out.set(rest);
      return true;
    }
    const P = POSE_SCRATCH;
    if (P.n < n) { P.n = n; P.ang = new Float64Array(n); P.ex = new Float64Array(n); P.ey = new Float64Array(n); P.rest = new Float64Array(n); P.off = new Float64Array(n); }
    let lastId = -1, first = 0;
    for (let i = 0; i < n; i++) {
      const o = i * V, kind = rest[o + 19] % 10, par = rest[o + 18] - 1, id = rest[o + 15];
      if (id !== lastId) { lastId = id; first = i; }
      const obj = FORK.obj[id - ID_STROKE], turn = obj && i - first < obj.m ? obj.off[i - first] : 0;
      const x1 = rest[o], y1 = rest[o + 1], x2 = rest[o + 2], y2 = rest[o + 3];
      const len = Math.sqrt((x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1));
      const ra = kind === 2 ? Math.atan2(x1 - x2, y2 - y1) : Math.atan2(x2 - x1, y1 - y2);
      P.rest[i] = ra;
      let jx = kind === 2 ? x2 : x1, jy = kind === 2 ? y2 : y1, ang = ra;
      if (kind === 1 && par >= 0) { jx = P.ex[par]; jy = P.ey[par]; ang = P.ang[par] + ra - P.rest[par]; }
      else if ((kind === 2 || kind === 3) && par >= 0) {
        const t = P.off[par], c = Math.cos(t), sn = Math.sin(t), ax = jx;
        jx = c * ax - sn * jy; jy = sn * ax + c * jy; ang = ra + t;
      }
      ang += turn;
      P.off[i] = turn;
      const ex = jx + Math.sin(ang) * len, ey = jy - Math.cos(ang) * len;
      P.ang[i] = ang; P.ex[i] = ex; P.ey[i] = ey;
      /* the segment's ends as drawn: a kind-2 arm's second end is its apex */
      const ax = kind === 2 ? ex : jx, ay = kind === 2 ? ey : jy, bx = kind === 2 ? jx : ex, by = kind === 2 ? jy : ey;
      const sib = rest[o + 19] >= 10;
      for (let v = 0; v < 6; v++) {
        const q = o + v * F;
        out[q] = ax; out[q + 1] = ay; out[q + 2] = bx; out[q + 3] = by;
        if (sib) { const s = q - V; out[q + 4] = out[s]; out[q + 5] = out[s + 1]; out[q + 6] = out[s + 2]; out[q + 7] = out[s + 3]; }
        else { out[q + 4] = ax; out[q + 5] = ay; out[q + 6] = ax; out[q + 7] = ay; }
      }
    }
    return true;
  }
  function sceneryMesh() {
    const W = Bg.W, H = Bg.H, SW = Bg.SW, sink = sinkDepth(H);
    const stroke = [], cloud = [], crests = [];
    const mix3 = (a, b, f) => [0, 1, 2].map(i => (a[i] + (b[i] - a[i]) * f) / 255);
    const objects = [];
    RIDGES.forEach((r, i) => objects.push({ kind: 'ridge', d: r.d, look: MASSIF_LOOK[i], src: r, id: ID_MASSIF + i, zb: 0 }));
    BANDS.forEach((b, i) => {
      for (let k = 0; k < b.n; k++) objects.push({ kind: 'peak', d: b.d, look: MASSIF_LOOK[RIDGES.length + i], src: b, k, id: ID_MASSIF + objects.length, zb: 2e-6 * (k + 1) });
    });
    /* near first, for the depth test's early-out */
    objects.sort((p, q) => p.d - q.d || q.zb - p.zb);
    /* Each ridge and peak cut into its pieces (slice) and every cut point
       its slack, then all of them written into one typed array, made once
       at its size, each point's slack looked up once and by a number: the
       pieces pushed into a plain array as they came, and every point's key
       a string, the build took 52 ms at 1440x900 (44% of it there). */
    const parts = [];
    let nv = 0;
    for (const o of objects) {
      const fill = mix3(COAT_RGB, SURFACE_RGB, o.look.fill), ink = mix3(COAT_RGB, LINE_RGB, o.look.ink);
      const width = { rim: o.look.rim, line: o.look.line / 2 };
      const c = o.kind === 'peak' ? peakCrest(o.src, o.k) : ridgeCrest(o.src);
      const x0 = o.kind === 'peak' ? c.fx * W : 0, seed = o.kind === 'peak' ? c.sd : o.src.seed;
      crests.push({ id: o.id, x0, d: o.d, crest: c.crest });
      const facets = [], xs = [], kinds = [];
      /* An edge between two neighbouring points of the crest is the
         silhouette whatever its strip calls it: every layer starts and ends
         on the ground at a peak's feet, so the strip under the crest meets them in a
         facet of nothing, and its next one runs from the crest's first
         corner down to the foot - along the crest - as a facet line (half
         the width, drawn half outside; the first 6-19 px of every peak's
         outline at 1440x900). Only an edge that reaches the ground can be
         one of these. */
      const crestAt = new Map(c.crest.map((p, i) => [p[0] + ',' + p[1], i]));
      const onCrest = (p, q) => {
        const i = crestAt.get(p[0] + ',' + p[1]), j = i === undefined ? undefined : crestAt.get(q[0] + ',' + q[1]);
        return j !== undefined && Math.abs(i - j) === 1;
      };
      massifTris(c, seed, (a, b, cc, kab, kbc, kca) => {
        const area = (b[0] - a[0]) * (cc[1] - a[1]) - (b[1] - a[1]) * (cc[0] - a[0]);
        if (Math.abs(area) < 1e-6) return;
        /* an edge along the ground is never drawn, whatever its kind (a
           peak's layers all end on the ground at its feet, so a strip's
           first and last edges between them can lie on the ground) */
        const w = (k, p, q) => (!k || (p[1] <= 0 && q[1] <= 0) ? 0 : (p[1] <= 0 || q[1] <= 0) && onCrest(p, q) ? width.rim
                                : k === 'diag' ? width.line : width[k] || 0);
        facets.push([a, b, cc, w(kbc, b, cc), w(kca, cc, a), w(kab, a, b)]);
        kinds.push([kbc, kca, kab]);
        xs.push(a[0], b[0], cc[0]);
      });
      economise(facets, kinds, c.crest, width.rim);
      const cuts = cutsOf(xs, gridAt(o.d)), nc = cuts.length;
      const peak = o.kind === 'peak';
      const hspan = new Float64Array(nc);
      for (let k = 0; k < nc; k++) hspan[k] = peak ? c.mh : Math.max(1, heightAt(c.crest, cuts[k]));
      /* Every corner its number, by where it is (at a foot the layers'
         corners are separate arrays at one place); a cut point is known by
         its edge's two corners and its cut line. */
      const byPlace = new Map(), byArray = new Map();
      const idOf = p => {
        let i = byArray.get(p);
        if (i === undefined) {
          const key = p[0] + ',' + p[1];
          i = byPlace.get(key);
          if (i === undefined) { i = byPlace.size; byPlace.set(key, i); }
          byArray.set(p, i);
        }
        return i;
      };
      const keyOf = p => (idOf(p[6][0]) * 65536 + idOf(p[6][1])) * nc + p[5];
      /* The pieces, and each cut point's slack: the least half-height of
         the cross-sections it is an end of, or the whole height where the
         other end stands still (a facet's corner, or on the ground: free
         is false for both), less SLACK_MARGIN. */
      const pieces = [], slack = new Map();
      const free = p => p[6] !== null && !(p[6][0][1] <= 0 && p[6][1][1] <= 0);
      const pair = (p, q) => {
        const fp = free(p), fq = free(q);
        if (!fp && !fq) return;
        const r = (Math.abs(p[1] - q[1]) - SLACK_MARGIN) / (fp && fq ? 2 : 1);
        if (fp) { const k = keyOf(p), was = slack.get(k); if (was === undefined || r < was) slack.set(k, r); }
        if (fq) { const k = keyOf(q), was = slack.get(k); if (was === undefined || r < was) slack.set(k, r); }
      };
      for (const f of facets) {
        slice(f, cuts, (p, q, r) => {
          if (Math.abs((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])) >= 1e-9) pieces.push(p, q, r, f);
        }, pair);
      }
      nv += (pieces.length / 4) * 3 + 6 * (nc - 1);
      parts.push({ o, x0, peak, fill, ink, cuts, hspan, pieces, slack, free, keyOf });
    }
    const massif = new Float32Array(nv * MASSIF_F);
    let mi = 0;
    for (const { o, x0, peak, fill, ink, cuts, hspan, pieces, slack, free, keyOf } of parts) {
      const slides = peak ? 1 : 0;
      /* each facet's centroid and shard seed (THE SHARDS): every facet the
         same way, each by its own share, 0.8-1 */
      const cen = new Map();
      const cenOf = f => {
        let c = cen.get(f);
        if (!c) {
          const n = cen.size;
          c = [x0 + (f[0][0] + f[1][0] + f[2][0]) / 3, (f[0][1] + f[1][1] + f[2][1]) / 3, 0.8 + 0.2 * hash1(o.id * 7.3 + n * 1.7), Math.min(f[0][1], f[1][1], f[2][1])];
          cen.set(f, c);
        }
        return c;
      };
      const put = (p, f, fc) => {
        /* once per point (two or three pieces share each): its slack */
        if (p[8] < 0) {
          const on = free(p);
          p[8] = on ? Math.max(0, slack.get(keyOf(p))) : 0;
          if (!on) p[7] = 0;
        }
        const L = p[7] > 0 ? p[6][0] : p, R = p[7] > 0 ? p[6][1] : p, M = massif;
        M[mi] = x0 + p[0]; M[mi + 1] = p[1]; M[mi + 2] = peak ? x0 : x0 + p[0]; M[mi + 3] = hspan[p[5]];
        M[mi + 4] = o.d; M[mi + 5] = o.zb; M[mi + 6] = slides; M[mi + 7] = o.id;
        M[mi + 8] = p[2]; M[mi + 9] = p[3]; M[mi + 10] = f[3]; M[mi + 11] = f[4];
        M[mi + 12] = f[5]; M[mi + 13] = fill[0]; M[mi + 14] = fill[1]; M[mi + 15] = fill[2];
        M[mi + 16] = ink[0]; M[mi + 17] = ink[1]; M[mi + 18] = ink[2]; M[mi + 19] = p[8];
        M[mi + 20] = x0 + L[0]; M[mi + 21] = L[1]; M[mi + 22] = x0 + R[0]; M[mi + 23] = R[1];
        /* a skirt's point is its own centroid: the ground under it, which no shard moves */
        M[mi + 24] = fc ? fc[0] : x0 + p[0]; M[mi + 25] = fc ? fc[1] : 0; M[mi + 26] = fc ? fc[2] : 0; M[mi + 27] = fc ? fc[3] : 0;
        mi += MASSIF_F;
      };
      /* A piece that meets an edge of its facet at a corner of the facet
         alone draws no line for that edge where the edge leaves the corner
         more than LINE_TURN from both of the piece's own sides there. The
         barycentric coordinates are interpolated across each piece, and a
         piece the floor bends (massifAt) is no exact part of its facet, so
         such a piece drew the edge's line swung about the corner, into a
         part of the massif the edge never runs by: stubs of the silhouette
         up to 6 px long at the 1.9 px rim (check-webgl-terrain: 4-9 px of
         them a state, by up to 80 levels). Where the edge runs along the
         piece's side (a steep edge less than a pixel across, its line's
         band all but wholly in the pieces beside it) the piece draws its
         share of the line, as every piece did. */
      const pw = [null, null, null, 0, 0, 0], turn = Math.cos(LINE_TURN);
      /* does edge j of facet f leave its corner V along the side V-s? */
      const along = (V, f, j, s) => {
        const i = V[2] === 1 ? 0 : V[3] === 1 ? 1 : 2, E = f[3 - i - j];
        const ux = E[0] - V[0], uh = E[1] - V[1], ax = s[0] - V[0], ah = s[1] - V[1];
        return ux * ax + uh * ah > turn * Math.hypot(ux, uh) * Math.hypot(ax, ah);
      };
      for (let i = 0; i < pieces.length; i += 4) {
        const a = pieces[i], b = pieces[i + 1], q = pieces[i + 2], f = pieces[i + 3];
        for (let j = 0; j < 3; j++) {
          let w = f[3 + j];
          if (w > 0) {
            const za = a[2 + j] === 0, zb = b[2 + j] === 0, zq = q[2 + j] === 0;
            if (za ? !zb && !zq : zb ? !zq : zq) {
              const V = za ? a : zb ? b : q, ones = V[2] === 1 || V[3] === 1 || V[4] === 1;
              if (ones && !along(V, f, j, za ? b : a) && !along(V, f, j, zq ? b : q)) w = 0;
            }
          }
          pw[3 + j] = w;
        }
        const fc = cenOf(f);
        put(a, pw, fc); put(b, pw, fc); put(q, pw, fc);
      }
      /* the skirt, SKIRT px under the ground between every two cut lines:
         unlined, and hidden by the floor in front */
      const none = [null, null, null, 0, 0, 0];
      for (let k = 1; k < cuts.length; k++) {
        const a = [cuts[k - 1], 0, 1, 0, 0, k - 1, null, 0, -1], b = [cuts[k - 1], -sink, 0, 1, 0, k - 1, null, 0, -1];
        const p = [cuts[k], -sink, 0, 0, 1, k, null, 0, -1], q = [cuts[k], 0, 0, 0, 1, k, null, 0, -1];
        put(a, none); put(b, none); put(p, none);
        put(a, none); put(p, none); put(q, none);
      }
    }

    /* the trees and conifers, far to near */
    const strokes = [];
    TREES.forEach((c, i) => strokes.push({ c, d: c.d, id: ID_STROKE + i, tree: true }));
    CONIFERS.forEach((c, i) => strokes.push({ c, d: c.d, id: ID_STROKE + TREES.length + i, tree: false }));
    strokes.sort((p, q) => q.d - p.d);
    for (const s of strokes) {
      const c = s.c, segs = [], base = stroke.length / (6 * STROKE_F);
      /* [p1x, p1y, p2x, p2y, q1x, q1y, q2x, q2y, hw, alpha, e1, e2, parent + 1, kind] (THE FORKS) */
      if (s.tree) {
        const levels = treeLevels(c);
        let first = 0;
        levels.forEach((lv, li) => {
          lv.segs.forEach((g, j) => {
            const sib = li > 0 && j % 2 === 1 ? lv.segs[j - 1] : null;
            /* a level's children come two to a parent, in the parent level's order */
            const par = li > 0 ? base + first - levels[li - 1].segs.length + (j >> 1) : -1;
            segs.push([g[0], g[1], g[2], g[3], sib ? sib[0] : g[0], sib ? sib[1] : g[1], sib ? sib[2] : g[0], sib ? sib[3] : g[1],
                       lv.lw / 2, Math.min(1, lv.a), li === 0 ? sink : 0, 0, par + 1, li > 0 ? (sib ? 11 : 1) : 4]);
          });
          first += lv.segs.length;
        });
      } else {
        /* the scene's layout (coniferLayout): the trunk, then each tier's
           strong chevron and its faint echo, two arms each meeting at the apex */
        const a = c.a;
        for (const g of coniferLayout(c)) {
          if (g[4] === 4) { segs.push([g[0], g[1], g[2], g[3], g[0], g[1], g[0], g[1], 1.8 * SW, Math.min(1, a * 0.9), sink, 0, 0, 4]); continue; }
          const hw = g[7] ? 0.95 * SW : 1.4 * SW, al = Math.min(1, g[7] ? a * 0.4 : a), prev = segs[segs.length - 1];
          if (g[4] === 2) segs.push([g[0], g[1], g[2], g[3], g[0], g[1], g[0], g[1], hw, al, 0, hw, base + 1, 2]);
          else segs.push([g[0], g[1], g[2], g[3], prev[0], prev[1], prev[2], prev[3], hw, al, hw, 0, base + 1, 13]);
        }
      }
      const x0 = c.fx * W;
      for (const g of segs) {
        for (const [along, across] of [[0, -1], [1, -1], [0, 1], [0, 1], [1, -1], [1, 1]]) {
          stroke.push(g[0], g[1], g[2], g[3], g[4], g[5], g[6], g[7], along, across, g[8], g[9], x0, s.d, c.h, s.id, g[10], g[11], g[12], g[13]);
        }
      }
    }

    /* the clouds: low-poly volumes - rings of the lobes' outline, jittered,
       zipped into facets around a centre at 0 - drawn as the mountains are
       (CLOUD_LOOK): one pale fill, every facet's edges lined, the outline a
       rim; each facet with its centroid and shard seed (CLOUD_VS) */
    const cloudLit = mix3(COAT_RGB, SURFACE_RGB, CLOUD_LOOK.fill), cloudShade = mix3(COAT_RGB, LINE_RGB, CLOUD_LOOK.shade);
    CLOUDS.forEach((c, ci) => {
      const lobes = [];
      for (let j = 0; j < c.n; j++) {
        const tt = (j + 0.5) / c.n;
        lobes.push([(tt - 0.5) * c.w * 1.5 + (hash1(c.seed + j) - 0.5) * c.w * 0.3,
                    (hash1(c.seed + j + 0.4) - 0.6) * c.h * 0.7,
                    c.w * (0.34 + 0.26 * hash1(c.seed + j + 0.8)),
                    c.h * (0.42 + 0.34 * hash1(c.seed + j + 1.2))]);
      }
      const radius = ang => {
        const dx = Math.cos(ang), dy = Math.sin(ang);
        let best = 0;
        for (const [lx, ly, rx, ry] of lobes) {
          const ox = -lx / rx, oy = -ly / ry, ux = dx / rx, uy = dy / ry;
          const A = ux * ux + uy * uy, Bq = 2 * (ox * ux + oy * uy), C = ox * ox + oy * oy - 1;
          const disc = Bq * Bq - 4 * A * C;
          if (disc > 0) best = Math.max(best, (-Bq + Math.sqrt(disc)) / (2 * A));
        }
        return best;
      };
      const M = 13, angs = [], baseR = [];
      for (let i = 0; i < M; i++) { const a = (Math.PI * 2 * i) / M; angs.push(a); baseR.push(radius(a)); }
      const rings = [];
      const levels = [1.0, 0.60, 0.26];
      for (let li = 0; li < 3; li++) {
        const pts = [];
        for (let i = 0; i < M; i++) {
          const jit = 1 + (hash1(c.seed + i * 3.7 + li * 9.1) - 0.5) * (li === 0 ? 0.22 : 0.34);
          const r = baseR[i] * levels[li] * jit;
          pts.push([Math.cos(angs[i]) * r, Math.sin(angs[i]) * r]);
        }
        rings.push(pts);
      }
      const centre = [(hash1(c.seed + 5.5) - 0.5) * c.w * 0.1, (hash1(c.seed + 6.6) - 0.5) * c.h * 0.1];
      let idx = 0;
      const ol = Math.min(1, CLOUD_LOOK.alpha * (0.6 + 0.4 * c.a)), lw = CLOUD_LOOK.line / 2;
      const facet = (p, q, r, rimPQ, ring) => {
        const gx = (p[0] + q[0] + r[0]) / 3, gy = (p[1] + q[1] + r[1]) / 3;
        const seed = 0.8 + 0.2 * hash1(c.seed + idx * 4.3);
        /* in relief: a facet turned from the light (CLOUD_LIGHT, from its
           centroid's direction off the centre) toward the shade, the outer
           ring - the cloud's sides - the most, the middle the least */
        const n = Math.hypot(gx, gy) || 1, dot = (gx / n) * CLOUD_LIGHT[0] + (gy / n) * CLOUD_LIGHT[1];
        const k = Math.max(0, Math.min(1, (0.5 - 0.5 * dot) * [1, 0.6, 0.25][ring] + (hash1(c.seed + idx * 7.9) - 0.5) * 0.06));
        const fill = [0, 1, 2].map(i => cloudLit[i] + (cloudShade[i] - cloudLit[i]) * k);
        idx++;
        const w2 = rimPQ ? CLOUD_LOOK.rim : lw;
        for (const [v, b0, b1] of [[p, 1, 0], [q, 0, 1], [r, 0, 0]]) {
          cloud.push(v[0], v[1], c.fx * W, c.fy * H, c.par, b0, b1, lw, lw, w2, seed, ID_CLOUD + ci,
                     fill[0], fill[1], fill[2], ol, gx, gy, 0, 0);
        }
      };
      for (let li = 0; li < 2; li++) {
        const o = rings[li], inn = rings[li + 1];
        for (let i = 0; i < M; i++) {
          const j = (i + 1) % M;
          facet(o[i], o[j], inn[i], li === 0, li);
          facet(o[j], inn[j], inn[i], false, li);
        }
      }
      for (let i = 0; i < M; i++) facet(rings[2][i], rings[2][(i + 1) % M], centre, false, 2);
    });
    return { massif, stroke: new Float32Array(stroke), cloud: new Float32Array(cloud), crests };
  }

  /* NB squares, two triangles each: (corner x, corner y, body) */
  function bodySquares() {
    const out = [];
    for (let i = 0; i < NB; i++) for (const [x, y] of [[-1, -1], [1, -1], [-1, 1], [-1, 1], [1, -1], [1, 1]]) out.push(x, y, i);
    return new Float32Array(out);
  }

  /* the least time (ms) between two builds of the scenery for new sizes
     (the renderer's scenery): a window being dragged is built for at most
     every REBUILD_MS, its meshes fitted to the sizes in between */
  const REBUILD_MS = 100;
  /* device px a level below level 0 draws past its corner of the canvas
     (THE LEVELS): the compositor's bilinear filtering reads one */
  const LEVEL_MARGIN = 2;

  /* ---- the renderer ------------------------------------------------------ */
  Bg.renderers.webgl = function (canvas, opts) {
    const onSettle = opts && typeof opts.onSettle === 'function' ? opts.onSettle : null;
    let gl = null, gl2 = true;
    try {
      gl = canvas.getContext('webgl2', ATTRS);
      if (!gl) { gl2 = false; gl = canvas.getContext('webgl', ATTRS); }
    } catch { gl = null; }
    if (!gl) { console.warn('background: no WebGL here; showing a still picture'); return null; }

    /* Per-frame scratch, so a frame allocates nothing. Everything draw
       uploads goes through these typed arrays (uniform*fv), never as a
       number argument: a double handed to a WebGL call is boxed on the JS
       heap, even in optimised code - with the uniforms passed as numbers a
       frame made 25-odd such boxes. SUN_AT and BODIES take sunAt's and
       bodiesAt's answers in place. */
    const U_VIEW = new Float32Array(4), U_PHASE = new Float32Array(NW), U_EVT = new Float32Array(3),
          U_DENT = new Float32Array(6), U_WELL = new Float32Array(2 * NB), U_BOX = new Float32Array(2),
          U_PX = new Float32Array(1), U_SUN = new Float32Array(4), U_RING = new Float32Array(4),
          U_K = new Float32Array(1), U_BODY = new Float32Array(4 * NB), SUN_AT = [0, 0, 0], BODIES = [],
          U_PUSH = new Float32Array(6), U_S = new Float32Array(1), U_BLOOM = new Float32Array(8), U_SKY = new Float32Array(2), OCC = new Float32Array(4),
          U_FIT = new Float32Array(4);
    let ready = false, W = 0, H = 0;
    let sheet, sun, bodies, ring, massifs, strokes, clouds, occluder, probe = null, depthProbe = null, layer = null, ids = null, spots = null;
    /* THE LEVELS: the level's size on the canvas (device px), the corner it
       draws (that and the margin), the view box or transform shown, and
       whether there is object-view-box (Chromium) */
    let rw = 0, rh = 0, lw = 0, lh = 0, shown = '';
    const VIEW_BOX = !!(window.CSS && window.CSS.supports && window.CSS.supports('object-view-box', 'inset(0px)'));
    let squareBuf, bodyBuf, meshBuf, meshCount = 0;
    /* the scenery's buffers, the size (W, H, S and SW) they were built for,
       and the wait after a build for a new size before the next (scenery) */
    let strokeRest = null, strokePosed = null, posed = false;
    let massifBuf = null, strokeBuf = null, cloudBuf = null, massifCount = 0, strokeCount = 0, cloudCount = 0,
        sceneryW = 0, sceneryH = 0, sceneryS = 0, scenerySW = 0, rebuildTimer = 0;

    function compile(type, src) {
      const vertex = type === gl.VERTEX_SHADER;
      const sh = gl.createShader(type);
      gl.shaderSource(sh, (vertex ? (gl2 ? VS3 : VS1) : (gl2 ? FS3 : FS1)) + src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        throw new Error((vertex ? 'a vertex' : 'a fragment') + ' shader did not compile: '
                        + String(gl.getShaderInfoLog(sh) || 'no log').trim().split('\n')[0]);
      }
      return sh;
    }
    /* a linked program and its uniforms, by name */
    function program(vsSrc, fsSrc, names) {
      const vs = compile(gl.VERTEX_SHADER, vsSrc), fs = compile(gl.FRAGMENT_SHADER, fsSrc);
      const p = gl.createProgram();
      gl.attachShader(p, vs);
      gl.attachShader(p, fs);
      ATTRIBS.forEach((a, i) => gl.bindAttribLocation(p, i, a));
      gl.linkProgram(p);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        throw new Error('a program did not link: ' + String(gl.getProgramInfoLog(p) || 'no log').trim().split('\n')[0]);
      }
      const u = {};
      for (const n of names) u[n] = gl.getUniformLocation(p, n);
      return { p, u };
    }
    function buffer(data) {
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      return b;
    }
    const WAVE_U = ['uView', 'uPhase', 'uEvt', 'uDent', 'uWell'];
    /* the attributes, by location; the scenery's are four to six vec4s
       (MASSIF_F, STROKE_F, CLOUD_F), and the probes' index comes after them */
    const ATTRIBS = ['aPos', 'aObj', 'aEdgeA', 'aEdgeB', 'aInk', 'aEnd', 'aCen', 'aIdx'];
    const STAND_U = WAVE_U.concat(['uBox', 'uPx', 'uPush', 'uS', 'uFit', 'uBloom']);
    /* Everything the GPU holds, from nothing: at the start and again after
       a context loss. Null when it worked, else why not. */
    function build() {
      ready = false;
      probe = depthProbe = layer = ids = spots = null;
      try {
        if (gl.isContextLost()) throw new Error('the context is lost');
        if (!gl2 && !gl.getExtension('OES_standard_derivatives')) throw new Error('no OES_standard_derivatives');
        sheet = program(SHEET_VS, SHEET_FS, WAVE_U.concat(['uBox', 'uPx']));
        sun = program(DISC_VS, SUN_FS, ['uBox', 'uDisc', 'uPx']);
        ring = program(DISC_VS, RING_FS, ['uBox', 'uDisc', 'uPx', 'uK']);
        bodies = program(BODY_VS, BODY_FS, ['uBox', 'uBody', 'uPx']);
        massifs = program(MASSIF_VS, MASSIF_FS, STAND_U);
        strokes = program(STROKE_VS, STROKE_FS, STAND_U);
        clouds = program(CLOUD_VS, CLOUD_FS, ['uBox', 'uPx', 'uSky', 'uFit', 'uS', 'uBloom', 'uPush']);
        occluder = program(OCC_VS, OCC_FS, ['uBox', 'uRect']);
        sceneryW = sceneryH = sceneryS = scenerySW = 0;
        massifBuf = strokeBuf = cloudBuf = null;
        clearTimeout(rebuildTimer);
        rebuildTimer = 0;
        squareBuf = buffer(new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]));
        bodyBuf = buffer(bodySquares());
        const mesh = sheetMesh();
        meshBuf = buffer(mesh);
        meshCount = mesh.length / 2;
        const e = gl.getError();
        if (e && !gl.isContextLost()) throw new Error('GL error 0x' + e.toString(16) + ' while building');
      } catch (err) {
        return err.message;
      }
      ready = true;
      return null;
    }
    const why = build();
    if (why) {
      console.warn('background: the WebGL renderer cannot run here (' + why + '); showing a still picture');
      return null;
    }
    let restoreFailed = false;
    canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); ready = false; }, false);
    canvas.addEventListener('webglcontextrestored', () => {
      const w = build();
      if (w && !restoreFailed) {
        restoreFailed = true;
        console.warn('background: the WebGL renderer could not be rebuilt after a context loss (' + w + '); showing a still picture');
      }
    }, false);

    /* the contract's resize(W, H, res, top): the canvas at top (level 0's
       density), a level below it in the canvas's top-left corner, shown
       over the whole box (THE LEVELS); a tool that gives no top gets the
       canvas at res */
    function resize(w, h, res, top) {
      W = w; H = h;
      const full = top > res ? top : res;
      const bw = Math.max(1, Math.round(W * full)), bh = Math.max(1, Math.round(H * full));
      if (canvas.width !== bw) canvas.width = bw;
      if (canvas.height !== bh) canvas.height = bh;
      rw = Math.min(bw, Math.max(1, Math.round(W * res))); rh = Math.min(bh, Math.max(1, Math.round(H * res)));
      if (!gl.isContextLost() && (gl.drawingBufferWidth !== bw || gl.drawingBufferHeight !== bh)) { rw = bw; rh = bh; }
      lw = rw < bw ? Math.min(bw, rw + LEVEL_MARGIN) : bw; lh = rh < bh ? Math.min(bh, rh + LEVEL_MARGIN) : bh;
      const part = rw < bw || rh < bh;
      const v = !part ? '' : VIEW_BOX ? 'inset(0px ' + (bw - rw) + 'px ' + (bh - rh) + 'px 0px)' : 'scale(' + bw / rw + ', ' + bh / rh + ')';
      if (v !== shown) {
        shown = v;
        if (VIEW_BOX) canvas.style.objectViewBox = v;
        else { canvas.style.transformOrigin = '0 0'; canvas.style.transform = v; }
      }
    }
    /* The frame's moving state at scene time t - the wave's (the swell's
       phases, the event, the dents, the wells, the view) and the terrain's
       push and scale - made once a frame (audit F19: it was made again for
       each of the three programs that read it) and then uploaded to each
       (setWave, setPush). */
    function frameState(t) {
      for (let i = 0; i < NW; i++) {
        const a = t * WAVE[i].kt;
        U_PHASE[i] = a - TAU * Math.floor(a / TAU);
      }
      U_EVT[0] = EVF.cx; U_EVT[1] = EVF.cd; U_EVT[2] = EVF.on ? EVF.sign * EVF.amp * EVF.env : 0;
      U_DENT[0] = CUR.xw; U_DENT[1] = CUR.d; U_DENT[2] = CUR_DEPTH * sheetOn(CUR);   /* the floor's share, faded before the terrain (scene.js sheetOn) */
      U_DENT[3] = RIP.xw; U_DENT[4] = RIP.d; U_DENT[5] = CUR_DEPTH * sheetOn(RIP);
      for (let i = 0; i < NB; i++) { U_WELL[2 * i] = bodiesW[i].xw; U_WELL[2 * i + 1] = bodiesW[i].d; }
      U_VIEW[0] = Bg.W; U_VIEW[1] = Bg.H; U_VIEW[2] = horizonY(); U_VIEW[3] = look.x * LOOK_X;
      for (let i = 0; i < 2; i++) {
        U_PUSH[3 * i] = TPUSH[i].sx; U_PUSH[3 * i + 1] = TPUSH[i].sy; U_PUSH[3 * i + 2] = TPUSH[i].on > 0 ? TPUSH[i].on : 0;
      }
      U_S[0] = Bg.S;
      /* the trees posed for the bloom (THE FORKS), uploaded when they change */
      if (strokeBuf && strokeRest && poseStrokes(strokeRest, strokePosed, posed)) {
        posed = BLOOM.on > 0;
        gl.bindBuffer(gl.ARRAY_BUFFER, strokeBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, strokePosed);
      }
      for (let i = 0; i < 2; i++) {
        const b = BLOOM.s[i];
        U_BLOOM[4 * i] = b.x; U_BLOOM[4 * i + 1] = b.y; U_BLOOM[4 * i + 2] = b.on > 0 ? b.on : 0; U_BLOOM[4 * i + 3] = 0;
      }
    }
    /* the wave's moving state, for the program in use (the sheet's, a
       standing one's or a probe's) */
    function setWave(u) {
      gl.uniform1fv(u.uPhase, U_PHASE);
      gl.uniform3fv(u.uEvt, U_EVT);
      gl.uniform3fv(u.uDent, U_DENT);
      gl.uniform2fv(u.uWell, U_WELL);
      gl.uniform4fv(u.uView, U_VIEW);
    }
    /* one attribute of `size` floats a vertex (the floor, the sun, the
       bodies, the probes); or n vec4s, interleaved (the scenery) - the
       other locations off, so no draw reads past a buffer it is not using */
    function attrib(buf, size) {
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, size, gl.FLOAT, false, 0, 0);
      for (let i = 1; i < ATTRIBS.length; i++) gl.disableVertexAttribArray(i);
    }
    function attribs(buf, n) {
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      for (let i = 0; i < ATTRIBS.length; i++) {
        if (i < n) {
          gl.enableVertexAttribArray(i);
          gl.vertexAttribPointer(i, 4, gl.FLOAT, false, 16 * n, 16 * i);
        } else gl.disableVertexAttribArray(i);
      }
    }
    /* the terrain's copy of the field, and the scale, for a standing program */
    function setPush(u) {
      gl.uniform3fv(u.uPush, U_PUSH);
      gl.uniform1fv(u.uS, U_S);
      gl.uniform4fv(u.uBloom, U_BLOOM);
    }
    /* The scenery's buffers, built again for a new size or scale: its meshes
       are made at one size (sceneryMesh), and a build takes 13-14 ms of JS
       (median at 1440x900, 390x844 and 3840x2160), most of a 60 Hz frame.
       A new size is built for in the first frame drawn at it, so one resize
       is one adjustment, unless the last build for a new size was less than
       REBUILD_MS ago: a window being dragged asks for one in every frame
       (in the harness 21-23 ms a frame when it built at every size:
       check-scenery-settle.js). Until that wait is over, frames draw the
       meshes they have, fitted to the size (U_FIT, FIT_GLSL), and the frame
       after it builds. Waiting instead for the size to hold 150 ms
       (SETTLE_MS) drew the old layout in the new box in every frame of the
       wait, and then the mountains and the trees jumped to their new size
       and place as far as the resize had moved everything else: two
       adjustments for one resize (the final QA lens, 1280x720 to 1440x900:
       a frame-to-frame difference of 10.15 at the resize and 10.2 again
       206 ms later, where the scene's own motion makes 0.06; headless, the
       scene held still, 7.7% of the px changed again at the build, and now
       none: check-scenery-settle.js). The first build, and a probe's (now),
       are at once, and start no wait. */
    function waitOver() {
      rebuildTimer = 0;
      if (onSettle && massifBuf && (sceneryW !== Bg.W || sceneryH !== Bg.H || sceneryS !== Bg.S)) onSettle();
    }
    function scenery(now) {
      if (massifBuf && sceneryW === Bg.W && sceneryH === Bg.H && sceneryS === Bg.S) { U_FIT[0] = U_FIT[1] = U_FIT[2] = U_FIT[3] = 0; return; }
      if (massifBuf && !now && rebuildTimer) {
        U_FIT[0] = Bg.W / sceneryW - 1; U_FIT[1] = Bg.H / sceneryH - 1; U_FIT[2] = Bg.S / sceneryS - 1; U_FIT[3] = Bg.SW / scenerySW - 1;
        return;
      }
      const again = !!massifBuf && !now;
      for (const b of [massifBuf, strokeBuf, cloudBuf]) if (b) gl.deleteBuffer(b);
      const m = sceneryMesh();
      massifBuf = buffer(m.massif); massifCount = m.massif.length / MASSIF_F;
      strokeBuf = buffer(m.stroke); strokeCount = m.stroke.length / STROKE_F;
      strokeRest = m.stroke; strokePosed = new Float32Array(m.stroke); posed = false;
      cloudBuf = buffer(m.cloud); cloudCount = m.cloud.length / CLOUD_F;
      sceneryW = Bg.W; sceneryH = Bg.H; sceneryS = Bg.S; scenerySW = Bg.SW;
      U_FIT[0] = U_FIT[1] = U_FIT[2] = U_FIT[3] = 0;
      if (again) { clearTimeout(rebuildTimer); rebuildTimer = setTimeout(waitOver, REBUILD_MS); }
    }
    /* a standing program (a massif's or a stroke's) made current, with the
       wave, the field and the view (frameState) */
    function stand(pg) {
      gl.useProgram(pg.p);
      setWave(pg.u);
      setPush(pg.u);
      gl.uniform2fv(pg.u.uBox, U_BOX);
      gl.uniform1fv(pg.u.uPx, U_PX);
      gl.uniform4fv(pg.u.uFit, U_FIT);
    }
    /* blended: over what is there, writing no depth (the sun, the trees and
       conifers, the bodies, the ring); else opaque, writing depth (the
       floor, the ridges and peaks). Either way through the depth test
       (LESS), so the card's depth rejects it (THE CARD). */
    function blended(on) {
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LESS);
      if (on) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);   /* premultiplied: the shaders output colour * alpha */
        gl.depthMask(false);
      } else {
        gl.disable(gl.BLEND);
        gl.depthMask(true);
      }
    }

    /* the contract's draw(t, still) */
    function paint(t, still) {
      if (!(W > 0 && H > 0) || gl.isContextLost()) return;
      /* a level below level 0 draws the canvas's top-left corner and the
         margin past it (THE LEVELS): W CSS px onto rw device px */
      const bw = gl.drawingBufferWidth, bh = gl.drawingBufferHeight, part = lw < bw || lh < bh;
      if (part) { U_BOX[0] = W * lw / rw; U_BOX[1] = H * lh / rh; U_PX[0] = rw / W; }
      else { U_BOX[0] = W; U_BOX[1] = H; U_PX[0] = bw / W; }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      if (part) gl.viewport(0, bh - lh, lw, lh);
      else gl.viewport(0, 0, bw, bh);
      gl.disable(gl.SCISSOR_TEST);
      gl.disable(gl.CULL_FACE);
      gl.colorMask(true, true, true, true);
      gl.depthMask(true);
      gl.clearColor(CLEAR_R, CLEAR_G, CLEAR_B, 1);
      gl.clearDepth(1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      if (!ready) return;   /* rebuilding failed after a loss: the page grey, nothing on it */
      frameState(t);

      /* the card's depth, first (THE CARD) */
      if (OCC[2] > OCC[0]) {
        blended(false);
        gl.colorMask(false, false, false, false);
        gl.useProgram(occluder.p);
        gl.uniform2fv(occluder.u.uBox, U_BOX);
        gl.uniform4fv(occluder.u.uRect, OCC);
        attrib(squareBuf, 2);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.colorMask(true, true, true, true);
      }

      /* the sun, behind everything (it writes no depth) */
      blended(true);
      const s = sunAt(SUN_AT);
      U_SUN[0] = s[0]; U_SUN[1] = s[1]; U_SUN[2] = s[2]; U_SUN[3] = 1;
      gl.useProgram(sun.p);
      gl.uniform2fv(sun.u.uBox, U_BOX);
      gl.uniform4fv(sun.u.uDisc, U_SUN);
      gl.uniform1fv(sun.u.uPx, U_PX);
      attrib(squareBuf, 2);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      scenery();
      /* the clouds, over the sun and behind everything else: opaque facets,
         writing no depth (whatever is drawn after them covers them) */
      gl.disable(gl.BLEND);
      gl.depthMask(false);
      gl.useProgram(clouds.p);
      gl.uniform2fv(clouds.u.uBox, U_BOX);
      gl.uniform1fv(clouds.u.uPx, U_PX);
      U_SKY[0] = skyX(0, 1); U_SKY[1] = tiltY();
      gl.uniform2fv(clouds.u.uSky, U_SKY);
      gl.uniform4fv(clouds.u.uFit, U_FIT);
      setPush(clouds.u);
      attribs(cloudBuf, CLOUD_F / 4);
      gl.drawArrays(gl.TRIANGLES, 0, cloudCount);

      /* the floor, opaque, through the depth buffer */
      blended(false);
      gl.useProgram(sheet.p);
      setWave(sheet.u);
      gl.uniform2fv(sheet.u.uBox, U_BOX);
      gl.uniform1fv(sheet.u.uPx, U_PX);
      attrib(meshBuf, 2);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, meshCount);

      /* the ridges and the peaks, opaque, each at its own depth: hidden
         where the floor in front of them rises, hiding the floor behind */
      stand(massifs);
      attribs(massifBuf, MASSIF_F / 4);
      gl.drawArrays(gl.TRIANGLES, 0, massifCount);

      /* the trees and the conifers: blended over what is there, through the
         depth test (the floor in front hides their feet, a nearer peak a
         conifer behind it) without writing it */
      blended(true);
      stand(strokes);
      attribs(strokeBuf, 5);
      gl.drawArrays(gl.TRIANGLES, 0, strokeCount);

      /* the bodies and the ring, over everything */
      blended(true);
      const list = bodiesAt(t, BODIES);
      for (let i = 0; i < NB; i++) {
        const b = list[i];
        U_BODY[4 * i] = b.x; U_BODY[4 * i + 1] = b.y; U_BODY[4 * i + 2] = b.size; U_BODY[4 * i + 3] = Math.min(1, 0.5 + b.s * 0.5);
      }
      gl.useProgram(bodies.p);
      gl.uniform2fv(bodies.u.uBox, U_BOX);
      gl.uniform4fv(bodies.u.uBody, U_BODY);
      gl.uniform1fv(bodies.u.uPx, U_PX);
      attrib(bodyBuf, 3);
      gl.drawArrays(gl.TRIANGLES, 0, 6 * NB);

      if (!still && ptr.seen && ptr.k > 0.01) {
        const r = RING_R + RING_WOBBLE * Math.sin(mk.x * 0.01 + mk.y * 0.01);
        U_RING[0] = mk.x; U_RING[1] = mk.y; U_RING[2] = r; U_RING[3] = r * (RING_OUTER - 1) + RING_LINE + 1;
        U_K[0] = ptr.k;
        gl.useProgram(ring.p);
        gl.uniform2fv(ring.u.uBox, U_BOX);
        gl.uniform4fv(ring.u.uDisc, U_RING);
        gl.uniform1fv(ring.u.uPx, U_PX);
        gl.uniform1fv(ring.u.uK, U_K);
        attrib(squareBuf, 2);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
    }

    /* ---- the probes (the header's test surface; the page never calls them) */
    /* an RGBA8 texture to draw into, with a 24-bit depth buffer if asked */
    function target(w, h, withDepth) {
      const fb = gl.createFramebuffer(), tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      let rb = null;
      if (withDepth) {
        rb = gl.createRenderbuffer();
        gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
        gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_STENCIL, w, h);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.RENDERBUFFER, rb);
      }
      const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      return { fb, tex, rb, ok };
    }
    function release(tg) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.deleteFramebuffer(tg.fb);
      gl.deleteTexture(tg.tex);
      if (tg.rb) gl.deleteRenderbuffer(tg.rb);
    }
    const unpack = (px, i) => (px[i] * 65536 + px[i + 1] * 256 + px[i + 2]) / 16777216;
    /* The shader's wave and projection at points = [xw0, d0, xw1, d1, ...]
       for scene time t (default Bg.simNow): [wave, screen x, screen y] per
       point, or null. */
    function probeWave(points, t) {
      if (!ready || gl.isContextLost()) return null;
      try {
        if (!probe) probe = program(PROBE_VS, PROBE_FS, WAVE_U.concat(['uGrid']));
        const cells = 3 * (points.length >> 1), gw = 256, gh = Math.max(1, Math.ceil(cells / gw));
        const data = new Float32Array(4 * cells);
        for (let i = 0; i < cells; i++) {
          const p = 2 * Math.floor(i / 3);
          data[4 * i] = points[p];
          data[4 * i + 1] = points[p + 1];
          data[4 * i + 2] = i % 3;
          data[4 * i + 3] = i;
        }
        const tg = target(gw, gh, false);
        if (!tg.ok) { release(tg); return null; }
        gl.viewport(0, 0, gw, gh);
        gl.disable(gl.BLEND);
        gl.disable(gl.DEPTH_TEST);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(probe.p);
        frameState(t === undefined ? Bg.simNow : t);
        setWave(probe.u);
        U_BOX[0] = gw; U_BOX[1] = gh;
        gl.uniform2fv(probe.u.uGrid, U_BOX);
        const buf = buffer(data);
        attrib(buf, 4);
        gl.drawArrays(gl.POINTS, 0, cells);
        const px = new Uint8Array(4 * gw * gh);
        gl.readPixels(0, 0, gw, gh, gl.RGBA, gl.UNSIGNED_BYTE, px);
        gl.deleteBuffer(buf);
        release(tg);
        const out = new Float64Array(cells);
        for (let i = 0; i < cells; i++) {
          const f = unpack(px, 4 * i);
          out[i] = i % 3 === 0 ? f * 128 - 64 : f * 32768 - 8192;
        }
        return out;
      } catch {
        return null;
      }
    }
    /* The floor's visible 1/d at every pixel of the drawing buffer, as the
       depth test leaves it, top row first: [width, height, v...], 0 where
       there is no floor. With dTest, a layer at that depth is then drawn
       through the depth test, as a terrain layer would be; where it wins,
       the pixel reads 1/dTest. Null if it cannot. */
    function probeDepth(dTest) {
      if (!ready || !(W > 0 && H > 0) || gl.isContextLost()) return null;
      try {
        if (!depthProbe) depthProbe = program(SHEET_VS, DEPTH_FS, WAVE_U.concat(['uBox']));
        if (!layer) layer = program(LAYER_VS, LAYER_FS, ['uD']);
        const bw = gl.drawingBufferWidth, bh = gl.drawingBufferHeight;
        const tg = target(bw, bh, true);
        if (!tg.ok) { release(tg); return null; }
        gl.viewport(0, 0, bw, bh);
        blended(false);
        gl.clearColor(0, 0, 0, 0);
        gl.clearDepth(1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.useProgram(depthProbe.p);
        frameState(Bg.simNow);
        setWave(depthProbe.u);
        U_BOX[0] = W; U_BOX[1] = H;
        gl.uniform2fv(depthProbe.u.uBox, U_BOX);
        attrib(meshBuf, 2);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, meshCount);
        if (dTest) {
          gl.useProgram(layer.p);
          U_K[0] = dTest;
          gl.uniform1fv(layer.u.uD, U_K);
          attrib(squareBuf, 2);
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        }
        const px = new Uint8Array(4 * bw * bh);
        gl.readPixels(0, 0, bw, bh, gl.RGBA, gl.UNSIGNED_BYTE, px);
        release(tg);
        const out = new Float32Array(2 + bw * bh);
        out[0] = bw; out[1] = bh;
        for (let y = 0; y < bh; y++) {
          const src = (bh - 1 - y) * bw;
          for (let x = 0; x < bw; x++) out[2 + y * bw + x] = unpack(px, 4 * (src + x)) / DEPTH_NEAR;
        }
        return out;
      } catch {
        return null;
      }
    }
    /* The shader's own placement of the scenery at scene time t (default
       Bg.simNow): { massif: [x, y per corner, sceneryMesh's order], stroke:
       [a.x, a.y, b.x, b.y per stroke vertex] } in CSS px, or null. */
    function probeScenery(t) {
      if (!ready || gl.isContextLost()) return null;
      try {
        if (!spots) {
          spots = { massif: program(SPOT_MASSIF_VS, PROBE_FS, STAND_U.concat(['uGrid', 'uWhich'])),
                    stroke: program(SPOT_STROKE_VS, PROBE_FS, STAND_U.concat(['uGrid', 'uWhich'])) };
        }
        scenery(true);
        frameState(t === undefined ? Bg.simNow : t);
        const massif = spot(spots.massif, massifBuf, massifCount, 2, MASSIF_F / 4);
        const stroke = spot(spots.stroke, strokeBuf, strokeCount, 4, STROKE_F / 4);
        return massif && stroke ? { massif, stroke } : null;
      } catch {
        return null;
      }
    }
    function spot(pg, buf, count, n, nv) {
      const AIDX = ATTRIBS.indexOf('aIdx');
      const cells = count * n, gw = 256, gh = Math.max(1, Math.ceil(cells / gw));
      const tg = target(gw, gh, false);
      if (!tg.ok) { release(tg); return null; }
      gl.viewport(0, 0, gw, gh);
      gl.disable(gl.BLEND);
      gl.disable(gl.DEPTH_TEST);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      stand(pg);
      gl.uniform2fv(pg.u.uGrid, new Float32Array([gw, gh]));
      const idx = new Float32Array(count);
      for (let i = 0; i < count; i++) idx[i] = i;
      const ib = buffer(idx);
      for (let w = 0; w < n; w++) {
        gl.uniform1f(pg.u.uWhich, w);
        attribs(buf, nv);
        gl.bindBuffer(gl.ARRAY_BUFFER, ib);
        gl.enableVertexAttribArray(AIDX);
        gl.vertexAttribPointer(AIDX, 1, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.POINTS, 0, count);
      }
      gl.disableVertexAttribArray(AIDX);
      const px = new Uint8Array(4 * gw * gh);
      gl.readPixels(0, 0, gw, gh, gl.RGBA, gl.UNSIGNED_BYTE, px);
      gl.deleteBuffer(ib);
      release(tg);
      const out = new Float64Array(cells);
      for (let i = 0; i < cells; i++) out[i] = unpack(px, 4 * i) * 32768 - 8192;
      return out;
    }
    /* What every pixel of the drawing buffer shows, drawn as the frame draws
       it (the ID_* shaders): { w, h, id: Uint8Array, v: Float32Array (its
       1/d; 0 for the sky's things and where nothing is) }, top row first;
       or null. */
    function probeIds() {
      if (!ready || !(W > 0 && H > 0) || gl.isContextLost()) return null;
      try {
        if (!ids) {
          ids = { sheet: program(SHEET_VS, ID_SHEET_FS, WAVE_U.concat(['uBox'])), massif: program(MASSIF_VS, ID_MASSIF_FS, STAND_U),
                  stroke: program(STROKE_VS, ID_STROKE_FS, STAND_U), cloud: program(CLOUD_VS, ID_CLOUD_FS, ['uBox', 'uSky', 'uS', 'uBloom', 'uPush']),
                  sun: program(DISC_VS, ID_SUN_FS, ['uBox', 'uDisc']) };
        }
        scenery(true);
        const bw = gl.drawingBufferWidth, bh = gl.drawingBufferHeight, t = Bg.simNow;
        const tg = target(bw, bh, true);
        if (!tg.ok) { release(tg); return null; }
        gl.viewport(0, 0, bw, bh);
        U_BOX[0] = W; U_BOX[1] = H; U_PX[0] = bw / W;
        gl.disable(gl.BLEND);
        gl.colorMask(true, true, true, true);
        gl.depthMask(true);
        gl.clearColor(0, 0, 0, 0);
        gl.clearDepth(1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.disable(gl.DEPTH_TEST);
        gl.depthMask(false);
        const sn = sunAt(SUN_AT);
        U_SUN[0] = sn[0]; U_SUN[1] = sn[1]; U_SUN[2] = sn[2]; U_SUN[3] = 1;
        gl.useProgram(ids.sun.p);
        gl.uniform2fv(ids.sun.u.uBox, U_BOX);
        gl.uniform4fv(ids.sun.u.uDisc, U_SUN);
        attrib(squareBuf, 2);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.useProgram(ids.cloud.p);
        gl.uniform2fv(ids.cloud.u.uBox, U_BOX);
        U_SKY[0] = skyX(0, 1); U_SKY[1] = tiltY();
        gl.uniform2fv(ids.cloud.u.uSky, U_SKY);
        setPush(ids.cloud.u);
        attribs(cloudBuf, CLOUD_F / 4);
        gl.drawArrays(gl.TRIANGLES, 0, cloudCount);
        blended(false);
        frameState(t);
        gl.useProgram(ids.sheet.p);
        setWave(ids.sheet.u);
        gl.uniform2fv(ids.sheet.u.uBox, U_BOX);
        attrib(meshBuf, 2);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, meshCount);
        stand(ids.massif);
        attribs(massifBuf, MASSIF_F / 4);
        gl.drawArrays(gl.TRIANGLES, 0, massifCount);
        gl.depthMask(false);
        stand(ids.stroke);
        attribs(strokeBuf, 5);
        gl.drawArrays(gl.TRIANGLES, 0, strokeCount);
        const px = new Uint8Array(4 * bw * bh);
        gl.readPixels(0, 0, bw, bh, gl.RGBA, gl.UNSIGNED_BYTE, px);
        release(tg);
        const id = new Uint8Array(bw * bh), v = new Float32Array(bw * bh);
        for (let y = 0; y < bh; y++) {
          const src = (bh - 1 - y) * bw;
          for (let x = 0; x < bw; x++) {
            const i = 4 * (src + x);
            id[y * bw + x] = px[i];
            v[y * bw + x] = (px[i + 1] * 256 + px[i + 2]) / 65536 / DEPTH_NEAR;
          }
        }
        return { w: bw, h: bh, id, v };
      } catch {
        return null;
      }
    }
    /* where the card is, in CSS px on the canvas (THE CARD); with no
       arguments, nowhere */
    function occlude(x0, y0, x1, y1) {
      if (x1 > x0 && y1 > y0) { OCC[0] = x0; OCC[1] = y0; OCC[2] = x1; OCC[3] = y1; } else OCC[0] = OCC[2] = 0;
    }
    /* the context is there and everything on it is built */
    function alive() { return ready && !gl.isContextLost(); }
    return { resize, draw: paint, occlude, alive, probeWave, probeDepth, probeScenery, probeIds };
  };
  Bg.renderers.webgl.sheetMesh = sheetMesh;
  Bg.renderers.webgl.sceneryMesh = sceneryMesh;
  Bg.renderers.webgl.poseStrokes = poseStrokes;
})();
