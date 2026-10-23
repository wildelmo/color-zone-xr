# Cloud paintings

Painted clouds for the sky. Each one is a cut-out PNG placed on a panel in one
of the sky's parallax layers. `manifest.json` lists them; when it's missing or
empty, the app falls back to its procedural clouds (`?clouds=procedural`
forces that, for comparison).

## Adding paintings

```sh
python3 tools/prep_clouds.py <kind> painting.png [more.png ...] [--light left|right]
```

- `kind`: `tower` (tall cumulus), `hero` (big wide cumulus), `bank` (long low
  band for the horizon), `small` (small fair-weather cloud for overhead).
- `--light`: the side the sun lights the cloud from in the painting. The app
  mirrors panels so the light always comes from the sun's side.

The tool cuts the cloud out of a plain or gently graded sky background, keeps
the painted edges soft, removes the background tint from them, trims, scales
to at most 2048 px wide and adds the file to `manifest.json`.

## What makes a good painting

- **One cloud per image**, whole, not touching the edges, with sky all round it.
- **Plain sky background**, ideally an even mid sky blue. A gentle vertical
  gradient is fine; another cloud behind it is not.
- **Lit from one side** (say which with `--light`), with a clear shadow side and
  a flatter, darker base.
- **Large**: 1536 px wide or more.
