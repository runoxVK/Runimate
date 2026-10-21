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

Projects and library items are stored in each browser separately. To move work between PC and iPad,
use **Save to file** (`.runimate`) and **Library → Export / Import** (`.runilib`).
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
`sw.js` + `manifest.webmanifest` (offline / installable), `serve.py` (local + LAN server).
