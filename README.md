# Runimate

Stick-figure animation in the style of Stick Nodes Pro — pose figures by dragging their nodes,
stretch and resize them, tween between keyframes — plus drawing on frames, drawings that stick
to bones, and a reusable asset library. Runs in the browser on Windows and iPad (installable as an app).

## Run it

**On this PC:** double-click `Start Runimate.bat` (needs Python), or run `python serve.py` and open
http://localhost:8040.

**On your iPad (same Wi-Fi):** start the server on the PC; it prints a line like
`On your iPad: http://192.168.1.20:8040`. Open that address in Safari, then Share → *Add to Home Screen*
for a full-screen app. If the iPad can't connect, allow Python through Windows Firewall (private networks).

**Where your work is saved:** every animation autosaves in the browser. On a computer with Chrome or Edge
you can also pick a **projects folder** (Ctrl+O → *Choose a projects folder…*): each animation then
autosaves there as `<name>.runimate`, and your library as `Runimate library.runilib`. After a browser
restart click **Reconnect folder** in the top bar to allow saving again. iPad Safari can't write to
folders, so there use **Save to file** (Share → Save to Files) as your backup. To move work between PC
and iPad, open the `.runimate` file on the other device and use **Library → Export / Import** (`.runilib`).
For the iPad app to work offline and keep a stable home, host the folder on any HTTPS static host
(e.g. GitHub Pages) — it's plain static files, no build step.

## How it works

| Thing | How |
| --- | --- |
| Pose | Drag the round nodes (Rotate mode). **Stretch** mode changes bone length, **IK** mode drags a hand/foot and bends the elbow/knee. The square main node or the body moves the figure; round handle rotates, square handle scales. Shift snaps to 15°. |
| Frames | `N` new frame (copies poses), `Shift+N` duplicate incl. drawings. Drag thumbnails to reorder. |
| Timing | Project FPS, plus per-keyframe **in-betweens** (`T` / `Alt+T`) that either **Tween** (with easing) or **Hold**. The scrubber previews every generated frame. |
| Onion skin | `O`; the arrow next to the button sets frames before/after and strength. |
| Drawing | Brush (pressure + smoothing + taper), eraser (partial or whole stroke), fill shape, line/rect/ellipse, lasso select, eyedropper. |
| Joining | Select a figure (e.g. the Sword), press `J` (or *Attach to a joint…*), then tap the joint it should follow (e.g. a hand). It now moves with that joint on every frame; its X / Y / Turn become offsets from the joint. *Scale with* follows the parent's size; `Shift+J` detaches in place. |
| Colour & fade | Joint colour can apply to **all frames** or **this frame** (tweens between keyframes). Each joint has a per-frame **opacity** (0 hides it), and each figure a per-frame **fade**. |
| Motions | Select an animated figure → *Save motion…* stores its keyframes (angles, movement, colours, timing) in the Library. Select any figure with the same joints and tap the motion to apply it, with a repeat count (walk cycles keep walking forward). |
| Sound | Timeline **♪** button → *Import sound…* (mp3, wav, m4a…). Clips show as waveforms under the timeline; drag them to slide, scrub to hear where words land. Playback follows the audio clock for lip-sync, and MP4 exports include the mix. |
| Camera | `C` picks the Camera tool: drag the orange frame to pan, the round handle to rotate, the corner to zoom (arrow keys work too). Every keyframe can have its own camera and in-betweens glide between them; add **Shake** for impacts. Playback, thumbnails and exports show the camera's shot (`Shift+C` toggles that while playing). |
| Rulers | `Q` toggles a **straight** or **circle** ruler (`Shift+Q` straight), `M` turns on **mirror symmetry**. Strokes started near a ruler follow it, or every stroke does with *Snap from anywhere* (parallel lines / concentric circles). Drag the white handles to place it, or use the Ruler button's angle, radius and move controls from the keyboard. |
| Layers | **Frame-by-frame** drawing layers (own drawing per keyframe), **Sprite** layers (one drawing you move/turn/scale per frame, tweened), figure layers and image layers for tracing. |
| Bone art | Select a joint → *Draw on this bone*, or lasso strokes → *Attach to a bone*. The art follows (and optionally stretches with) the bone in every frame and is saved with the figure. |
| Library | Save any figure (rig, colours, bone art, pose) or drawing; insert it into any project. Export/import as `.runilib`. |
| Copy/paste | `Ctrl+C/V` figures, strokes, layers, or frames (when nothing is selected). `Ctrl+Shift+C/V` copy/paste a pose between frames or matching figures. |
| Export | Animated GIF, MP4 (H.264), PNG sequence (.zip), sprite sheet, single PNG, or the project file. On iPad use *Share / Save to Photos*. |
| Keyboard | Everything has a shortcut — `?` lists them, `Ctrl+K` searches every command, `F6` moves focus between areas, `Tab` + arrow keys pose joints. |
| iPad gestures | Pinch / two-finger drag to zoom & pan, two-finger tap undo, three-finger tap redo, long-press for the context menu. Once an Apple Pencil is used, fingers stop drawing. |

## Files

`index.html`, `css/`, `js/` (ES modules, no build), `vendor/mp4-muxer.mjs` (MIT, for MP4 export),
`sw.js` + `manifest.webmanifest` (offline / installable), `serve.py` (local + LAN server), `tests/` (browser tests).

## Tests

Automated browser tests drive the real app in a hidden Chrome or Edge window: posing (rotate, IK,
keyboard), frames and in-betweens, drawing, eraser, lasso, bone art, rulers and mirror, iPad touch and
pen input, the camera, every export format, autosave/reload, the library, and every command.

One-time setup (needs Node.js 18+ and Python):

```bash
npm install
```

Run everything:

```bash
npm test
```

Each run starts its own server on a free port with a fresh browser profile, so your saved animations are
never touched. Screenshots from the runs land in `tests/output/`. If the browser isn't found, set
`CHROME_PATH` to a Chrome/Edge executable; set `PYTHON` if Python isn't on your PATH as `python`.
