# Design notes: the "things to do" round

The first playable build was rated "pretty, but 2/10 for things to do". This round was built from a
parallel design pass (five independent lenses: toy design, play loops, creatures, VR interaction,
and a critic reconstructing the first ten minutes from the code) followed by a curated build.

## Diagnosis (why it was boring)

- Nothing asked anything of the player after the 17-second intro; the only goal was an invisible
  percentage on a sign.
- Progress was decoupled from play: ambient bubbles dying of old age drove the colour spread and
  Dot's reactions, so sitting still coloured the island as fast as painting did, and Dot's idle
  hints could never fire.
- The world was inert to touch. Only bubbles responded to the wand; paint balls hit nothing but
  the ground; strokes were inert once drawn.
- Everything interesting was within reach or beyond 14 m, with no reason to go anywhere.
- Dot was a narrator, not a playmate.

## Principles

- Nouns before numbers: put specific things in the world that have state and answer you.
- Same verbs, more consequences. No new buttons: paint, throw, poke, go.
- Every goal is visible from where you stand and pointed at by a friend.
- Rewards happen in the world, right there, and stay changed.
- No reading, no menus, no inventories, no timers, no failure. Any colour is the right colour.
- Keep the sketch-to-colour look, the polygon scale and the island size; no music, no hum.

## What shipped

| Feature | Lens it came from | What it adds |
| --- | --- | --- |
| Player-driven spread | critic | Only the player's own play feeds the colour spread and Dot; smaller spawn zone; stronger strokes |
| Sleepyheads (Critters) | creatures + loop | 13 sketch animals to find and wake with colour; they follow, hop, ribbit, sing |
| Guide | loop + critic | Dot leads you to the next sleeper, grey tree or sketch pond with a beacon; celebrations at the place |
| Boops | toy + VR | Everything reacts to the wand tip; balls ricochet, trampoline, splat onto trees; splat waves |
| Catch | VR + toy | Play catch with Dot; rally balls grow; hold-to-charge; fist = squeeze for hand tracking |
| Pond life | loop + toy | Feed the fountain with colour; koi that nibble and leap through your wand; bubbles near you |
| Riders | VR + toy | Tiny paint drops ride your long strokes like a roller coaster and fly off into splats |
| Extras | critic | Early, catchable, perching butterflies; the rainbow grows in; colour where you teleport |

## Deliberately not done

- Colour-matching tasks (a wrong answer is a fail state in disguise).
- Unlocks, currencies, inventories, timers, scores, or text objectives.
- New locomotion, more islands, or background music.
