<p align="center">
  <img src="assets/icons/icon-192.png" width="120" alt="Color Zone XR icon" />
</p>

<h1 align="center">Color Zone XR</h1>
<p align="center"><strong>Paint the world back to life.</strong><br/>
A joyful WebXR art playground for Meta Quest — no app store, no downloads, no assets to fetch. Open the link in the Quest browser and start painting.</p>

<p align="center">
  <img src="docs/screenshots/08-vr-world-alive.png" width="100%" alt="A fully painted island under a rainbow, seen through the headset" />
</p>

## The idea

The title screen shows a little floating island in full colour. The moment you step in, Dot — a paint-drop with big eyes — says hello, and the colours drain away until the island is a pencil sketch on warm paper: ink outlines, cross-hatched shade, a grey pond. Only the patch of grass at your feet stays green. "Pull the trigger and paint them back!"

- **Paint in the air.** Pull the trigger and glowing neon ribbons (with a soft light halo) follow your hand. Every stroke drips colour onto the land below, and the island blooms around it: grass tufts, daisies, tulips and spotted mushrooms pop up with a sparkle, trees take on your colours, the pond turns blue and the fountain starts to shine.
- **Colour spreads while you play.** The more you paint, pop and throw, the faster colour bleeds outward across the hills. Stop, and the magic settles.
- **Pop bubbles, throw paint.** Iridescent bubbles rise from the stone fountain and drift over — poke them for confetti and a splash of colour. Squeeze the grip to conjure a paint ball and hurl it: *splat*.
- **Meet Dot.** A little paint-drop buddy floats at your side, cheers when you paint, spins when bubbles pop, takes on your colour and offers hints if you get stuck.
- **Bring the whole world back.** At 25% butterflies arrive. At 50% a rainbow rises. At 75% the sun starts smiling. Paint it all and the sky fills with fireworks.

Everything is procedural: the island, plants, clouds, particles, the music and every sound are generated in code, so the whole experience is ~1 MB and works offline as an installable app.

<p align="center">
  <img src="docs/screenshots/04-vr-brushes.png" width="49%" alt="Six brushes: glow, rainbow, sparkle, cotton, stickers and bubbles" />
  <img src="docs/screenshots/10-vr-fireworks.png" width="49%" alt="The smiling sun and a rainbow over the painted island" />
</p>

## Play it

**On a Meta Quest (2, 3, 3S, Pro):** open the published page in the Quest browser and press **Enter VR**. Once GitHub Pages is enabled for this repository (Settings → Pages → *GitHub Actions*), the `Deploy to GitHub Pages` workflow publishes `main` automatically.

**On a computer:** open the same page and press **Explore on desktop** — mouse look, WASD to walk, left mouse to paint, right mouse to throw paint.

**Locally, for development:**

```bash
npm install
npm start
```

That serves `http://localhost:8080` for the desktop preview and, if `openssl` is installed, `https://<your-LAN-IP>:8443` for the headset (WebXR requires HTTPS; accept the self-signed certificate warning once).

## Controls

| Action | Quest Touch controllers | Hand tracking | Desktop |
| --- | --- | --- | --- |
| Paint | Trigger (pressure = thickness) | Pinch index + thumb | Left mouse |
| Pick a colour | Dip the wand tip into an orb on the left controller, or flick the left stick | Touch an orb on the back of your left hand | `1`–`9`, `0`, `-`, `=` |
| Change brush | `B` | Menu | `Tab` |
| Brush size | Right stick up / down | Menu | Mouse wheel, `Q` / `E` |
| Throw a paint ball | Hold grip, swing, release | — | Right mouse |
| Pop a bubble | Touch it with either wand | Touch it | Touch it with the wand |
| Undo | `A` or `Y` | Menu | `Z` |
| Menu | `X` | — | `M` |
| Teleport | Push left stick forward, aim, release | — | WASD to walk |
| Snap turn 30° | Flick right stick left / right | — | Mouse look |

The floating menu (point a wand's laser at a button and pull the trigger, or just poke it) has all six brushes, brush size, sound, undo, *Clear*, and *New world*, which rolls a brand-new island.

## Brushes

| | Brush | What it does |
| --- | --- | --- |
| ✦ | **Glow** | A neon ribbon of light with a travelling pulse |
| 🌈 | **Rainbow** | The hue cycles along the stroke |
| ✨ | **Sparkle** | A thin twinkling thread that sheds stars |
| ☁ | **Cotton** | Puffy, wobbling cotton-candy clouds |
| ★ | **Stickers** | Stars and hearts scattered along your path |
| ○ | **Bubbles** | Blows bubbles you can pop later |

Paintings auto-save in the browser and are restored on the next visit. Add `?fresh` to the URL to start clean, or `?seed=anything` for a specific island.

## How it's built

Plain ES modules and [three.js](https://threejs.org) (vendored, no bundler), so the code you read is the code that runs.

```
src/
  App.js              frame loop, player rig, XR session, systems
  world/              procedural island: terrain, sky, flora, clouds, pond, rainbow
    WorldMaterial.js  one shader for the environment — samples the paint map and reveals colour
  paint/              PaintMap (top-down colour render target), strokes, brushes, palette, wand
  fx/                 GPU particle pool, bubbles, thrown paint + splat decals
  audio/              procedural Web Audio: pad, pentatonic chimes, pops, fanfares
  input/              Quest controllers + hand tracking, desktop fallback, locomotion
  creatures/          Dot the buddy, butterflies
  systems/            milestones, auto-save
  ui/                 canvas-drawn menu, help sign, toasts
tools/
  serve.js            HTTPS dev server for the headset
  test/               headless Quest emulator + Playwright end-to-end test
```

A few of the tricks that make it feel good:

- **The paint map.** A 1024² render target seen from above. Strokes, drips, bubble pops and splats stamp soft circles of colour into it; every environment shader samples it to blend from sketch to colour, with a glowing "magic edge" at the boundary. A ping-pong pass lets colour bleed outward, driven by how actively you're playing.
- **The sketch look.** The same shader draws the unpainted world as a pencil illustration: warm paper, anti-aliased cross-hatching that only appears in shade, baked contact shadows (a second top-down map stamped once per island), and inverted-hull ink outlines on trees, rocks and props.
- **Blooming plants.** Thousands of instanced flowers, grass tufts and mushrooms start at scale zero and pop with an elastic bounce (in the vertex shader) when colour reaches them.
- **Silky strokes.** Tubes are extruded incrementally with parallel-transported frames, through a Catmull-Rom spline that lags one sample behind the hand, so fast scribbles stay smooth at any frame rate. Finished strokes are merged into batches to keep draw calls low.
- **GPU particles.** The CPU writes a particle's spawn state once; the shader integrates motion from time. Drips even know when they'll land so the ground splashes exactly on impact.
- **Music that follows you.** Chimes are pitched by the height of your hand on a pentatonic scale, so any painting is a melody, and the ambient pad brightens as the world fills with colour. Pops, splats, blooms and the fountain are positioned in 3D around you.

## Testing

```bash
npm test            # full run: desktop + emulated Quest, writes docs/screenshots
npm run test:quick  # skips the long milestone scenarios
npm run lint
```

`tools/test/xr-emulator.js` implements just enough of the WebXR API (session, stereo views, two Touch controllers with haptics, optional tracked hands) for three.js to run a real immersive session in headless Chromium. The test plays through the whole experience — every brush, palette picks, undo, throwing, popping, teleporting, snap turns, the menu, milestones, the finale, hand-tracked pinch painting — and asserts on gameplay state.

## Performance notes for Quest

- Draw calls stay in the dozens: instanced flora, batched strokes, single-mesh clouds and one particle pool per blend mode.
- No post-processing and no shadow maps; lighting is cheap hemisphere + sun toon shading inside the shaders. Fixed foveation is left at maximum and the session asks for 90 Hz where supported.
- Comfort first for kids: teleport with a soft blink and snap turns only, no smooth locomotion.

## License

MIT. three.js is © its authors and also MIT licensed (see `vendor/three/LICENSE`).
