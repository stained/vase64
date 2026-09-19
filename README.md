# VASE64

**base64, but it blooms.**

VASE64 is a base64 encoder and decoder that refuses to look like base64. Your
plain text is turned into base64 the ordinary way, and then every base64
character is planted as a little ASCII flower in an ASCII vase. Paste the vase
back in and you get your text again, byte for byte.

```
  /!O|  !*| /!o| /|O:\/|O: /|O:\ :O|
   ! |  ! |  ! |  | :  | :  | :  : |
  /!@| /!O'  |o:\/|o: /:*| /!O'  |o:\
   ! |  ! '  | :  | :  | :  : |  ! |
       ...                           
|                                   |
|~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~|
|                                   |
|-----------------------------------|
|                                   |
|________________|

                  VASE64
```

It is a real, lossless codec — not a picture of one. The tests round-trip every
one of the 64 plants, random binary data, emoji, and text in every vessel.

## Try it

**Double-click `index.html`.** That is the whole website: one file, 50 kB, with
the codec, the app and the stylesheet inlined. No server, no build step, no
dependencies, no network calls.

It has to be one file, because a browser refuses to load an ES module from
`file://` — the origin is `null`, so the request is blocked as cross-origin:

```
Access to script at 'file:///…/app.js' from origin 'null' has been blocked by CORS policy
```

So `index.html` is *generated* with everything inlined. The sources stay
readable and separately importable, which is what the CLI and the tests use:

| File | Role |
| --- | --- |
| `src/vase64.js` | the codec — the only file that matters |
| `app.js` | the bench: direction, live output, copy/download |
| `styles.css` | styling |
| `dev.html` | the page markup; loads the three above as real modules |
| `index.html` | **generated** single file for opening off disk |

Working on the app is nicer with real files, so use the dev page, which needs a
server:

```sh
npm run serve      # http://localhost:8080
npm run build      # regenerate index.html after editing app.js or the codec
```

`npm run build` fails loudly if the bundle would not work: if it still
references a sibling file, still contains module syntax, or does not parse as a
single classic script. That last check is not theoretical — the codec and the
app both used to declare `BLOOMS`, which is harmless across two modules and a
hard `SyntaxError` once they share one scope.

## Command line

The same codec backs a small CLI.

```sh
node bin/vase64.js encode "hello world"          # text -> vase
node bin/vase64.js encode -f README.md > r.vase  # a file, in an urn
node bin/vase64.js decode < r.vase               # vase -> text

node bin/vase64.js encode "hi" --vessel bowl
```

| Option | Meaning |
| --- | --- |
| `-f`, `--file <path>` | read the input from a file |
| `-v`, `--vessel <name>` | `bud`, `bowl`, or `urn` |
| `-h`, `--help` | usage |

Exit codes: `0` success, `1` bad usage or unreadable input, `2` nothing to
decode.

## How it works

The pipeline is deliberately ordinary until the very last step:

```
text ──UTF-8──▶ bytes ──base64──▶ A–Za–z0–9+/ ──plant──▶ vase
```

1. **Text to bytes.** UTF-8, so emoji and CJK work like anything else.
2. **Bytes to base64.** Standard base64, exactly as `btoa` produces it. The UI
   shows you this intermediate value, because that is the part that is
   genuinely base64.
3. **Base64 to vase.** Each base64 character carries 6 bits. Those 6 bits are
   split into three 2-bit fields, and each field picks a feature of one plant:

   | Bits | Field | Options |
   | --- | --- | --- |
   | 4–5 | bloom | `o` `O` `*` `@` (the tiers grow) |
   | 2–3 | stem | `\|:` `!\|` `:\|` `!'` |
   | 0–1 | leaves | none, `/`, `\`, or both |

   That is 4 × 4 × 4 = 64 distinct plants, which is exactly the size of the
   base64 alphabet, so the mapping is a bijection. A plant is five columns
   wide and two rows tall:

   ```
    leaf  stem  bloom  stem  leaf     <- the bloom row carries the value
      .   stem    .    stem    .      <- the vine makes it a plant
   ```

Only the bloom row is ever read back, so the vine underneath each plant is pure
decoration. **Nothing about the vase itself carries data.** It can be widened,
redrawn, or deleted entirely, and the message survives — the tests prove that
by decoding a vase with the frame stripped off.

A longer message buys a wider vase, which in turn fits more plants per row, so
a few hundred bytes of text still reads as a bouquet instead of one endless
column.

### Vessels are curves, not pictures

Each vessel is a handful of control points — "at 55% of the height the vase is
15 columns wide" — and the ASCII art is generated from them:

```js
bud: {
  name: 'Bud vase',
  points: [
    [0.0, 15],   // [t, width], t from 0 at the rim to 1 at the base
    [0.55, 9],
    [1.0, 7],
  ],
  steps: 11,
  water: [0.6, 0.72],   // the t range that gets a `~` surface
  band: [0.82, 0.92],   // the t range that gets an `=` band
  pour: 1,              // the rim: flowers stack strictly above it
}
```

The width is interpolated with a smoothstep rather than straight lines, because
a linear interpolation gives every row the same slope and the result reads as a
traffic cone. Each row's wall character then comes from the *step the drawing
actually takes* on that side, not from the ideal curve:

- no movement → `|`
- moving towards the axis → `\` on the left, `/` on the right
- flaring away from it → `/` on the left, `\` on the right

That distinction matters because a text cell is about twice as tall as it is
wide, so a character can only lean about half a cell per row. Asking each wall
about its own movement is also what stops a vase looking lopsided: computing
the wall from the shared change in width makes one side lean while the other
stands straight.

Two conventions keep the drawing on a single axis:

- **widths are odd**, so every row has a centre column;
- **the canvas width is odd**, so an even-width row of flowers and an
  odd-width row of vase still land on the same centre column.

Because the drawing and the geometry come from one description, the walls can
never disagree with the mouth they describe, and adding a fourth vessel means
adding five numbers rather than drawing a picture.

## Decoding is forgiving on purpose

A vase is meant to be pasted around: into chat, into a comment, into a
terminal. So the reader ignores blank lines, the vase outline, the `VASE64`
signature, and line-number gutters like ` 12 | `. It also accepts plain base64
directly, since that is the intermediate step.

Two readers exist and the tests assert they agree on all 64 plants:

- an **exact** reader that matches a whole plant, and
- a **lenient** reader that reads the bloom and stems even if the leaves have
  been trimmed by an editor.

## Project layout

```
index.html          generated single-file site — double-click this
build.mjs           the inliner
dev.html            page markup for development (loads modules, needs a server)
styles.css          styling
app.js              the bench: direction, live output, copy/download
src/vase64.js       the codec — the only file that matters
bin/vase64.js       a CLI over the same module
test/vase64.test.js
test/single-file.test.mjs
examples/           a few vases to decode
```

## Tests

```sh
npm test
```

31 tests in two files:

- `test/vase64.test.js` — 24 tests over the codec: the glyph table (all 64
  distinct, all decodable), round trips across sample text, random binary, emoji
  and CJK, every vessel, lossy-looking input like stripped frames and pasted
  gutters, and the error paths.
- `test/single-file.test.mjs` — 7 tests that execute the exact inline script
  from `index.html` against a small fake DOM, so the shipped file is tested for
  what it is: one classic script that has to work with no imports and no server.

## Use as a library

```js
import { encodeToVase, decodeVase } from './src/vase64.js';

const vase = encodeToVase('hello world');
decodeVase(vase); // 'hello world'

encodeToVase('hello', { vessel: 'urn', stamp: false });
```

The module is a plain ES module with no dependencies, so it works in the
browser and in Node without a build step.

## Licence

MIT.
