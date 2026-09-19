# VASE64

**base64, but it blooms.**

VASE64 turns UTF-8 text into base64, then draws each unpadded base64 character
as an ASCII flower. Short messages form a vase; longer messages spread into
flower beds. Paste the complete garden back into Decode to recover the text.

## Try it

[Get the standalone HTML app](https://github.com/stained/vase64/blob/main/index.html).
On GitHub, use **Download raw file**, then double-click the downloaded
`index.html` to open it in your browser. The GitHub file page shows the source;
the downloaded file is the app.

The generated page contains the codec, interface, and stylesheet, so it works
offline without a server or dependencies.

Type text and the garden grows automatically. **Grow garden** also runs the
encoder explicitly. **Decode** accepts a garden or plain base64. **Copy** and
**Download** export the garden when encoding, or the recovered text when
decoding. **Fit**, zoom, and **Hide controls** change only the display.
Breathing room and the VASE64 signature are built in.

The bloom count excludes base64 padding. Bytes counts UTF-8 bytes; Chars counts
JavaScript UTF-16 code units, so an emoji may count as more than one. Lines
counts the displayed output lines, including blank lines.

## How encoding works

```text
text -> UTF-8 bytes -> base64 -> 5-column, 4-row flowers -> vase or beds
```

Base64 uses `A–Z`, `a–z`, `0–9`, `+`, and `/`: 64 values, each carrying six
bits. The encoder splits each value into three two-bit fields:

| Bits | Feature | Four possibilities |
| --- | --- | --- |
| 4–5 | Bloom | `o`, `O`, `*`, `@` |
| 2–3 | Stem | `\|`, `!`, `:`, `'` |
| 0–1 | Leaves | none, left `/`, right `\`, both |

There are 4 × 4 × 4 = 64 unique plants. This is a one-to-one mapping, not
random decoration. For example, base64 `D` (value 3) becomes:

```text
/ o \
/ | \
  |
  |
```

The decoder reads the bloom and leaf positions in the first row, and the stem
in the same column in the fourth row. The middle two rows and marks around
the bottom stem are decoration. Removing a leaf from the first row changes
the encoded value; removing the bottom stem makes the plant unreadable.

Base64 `=` padding is not drawn. It is reconstructed when decoding the bytes.
The interface displays flowers rather than the intermediate base64 string.
This is an encoding, not encryption.

## Automatic arrangements

- Up to **32 flowers** form a vase. This is based on UTF-8 payload size, not
  the number of visible text characters.
- Longer messages form flower beds. Their width grows with the flower count:
  `ceil(sqrt(count * 4))` plants per row, capped at 32. Beyond that cap, more
  text adds rows. Each bed is at most 162 text columns including its border.
- A stable hash of the payload selects the vase profile (bud, bowl, or urn)
  and a small width variation, or the soil texture for beds. The same text
  produces the same art with the same options.

Vase flowers are arranged in a dome, narrower at the top. Decorative stems
connect the lowest flowers to the mouth. Vessel profiles use smoothstep
interpolation and are rasterised at their final size, limiting each wall to
one column of movement per row. Vase width is capped separately from bouquet
width. Flower beds instead give each planting row its own shallow soil border.

Reading order is always **left to right, top to bottom**. Vase outlines,
connecting stems, soil, spacing between complete plants, and the signature
carry no payload data. You can remove a frame without losing the message,
provided the complete plant cells and their order remain intact.

## Decoding and copy/paste

Use a monospaced font and preserve spaces inside the flowers. The decoder
ignores blank lines, trailing spaces, the frame, and the signature. It also
accepts line-number prefixes such as ` 12 | ` added by another editor, although
the app does not generate line numbers.

The glyph reader first tries a full four-row match, then falls back to the
bloom, leaf flags, and aligned bottom stem. This tolerates changes to
non-data decoration; it cannot reliably recover deleted data-bearing marks
or reflowed spacing. There is no checksum or error correction: some changes
can decode to different text without being detected.

`encodeToVase` and `decodeVase` are text APIs. `base64ToVase` and `vaseToBase64`
can transport the base64 representation of arbitrary bytes; `vaseToBase64`
returns it without padding. Text decoding uses UTF-8 and may replace invalid
byte sequences with replacement characters.

## Command line

```sh
node bin/vase64.js encode "hello world"
node bin/vase64.js encode -f README.md > garden.txt
node bin/vase64.js decode < garden.txt
node bin/vase64.js encode "hi" --layout bed
```

Without text or `--file`, input is read from stdin. Files are read as UTF-8 text.

| Option | Meaning |
| --- | --- |
| `-f`, `--file <path>` | Read text from a file |
| `-l`, `--layout <name>` | `auto` (default), `vase`, or `bed` |
| `-h`, `--help` | Show usage |

Exit codes: `0` success, `1` bad usage or unreadable input, `2` no decoded text
from nonempty input. The CLI appends a newline to its output.

## Library

```js
import { encodeToVase, decodeVase } from './src/vase64.js';

const garden = encodeToVase('hello world');
decodeVase(garden); // 'hello world'

// Optional library overrides; these are not interface controls.
encodeToVase('hello', { layout: 'bed' });
encodeToVase('hello', { vessel: 'urn', stamp: false, breathingRoom: false });
```

Defaults are `layout: 'auto'`, `vessel: 'auto'`, `stamp: true`, and
`breathingRoom: true`. An explicit vessel chooses vase mode when layout is
`auto`; an explicit `layout: 'bed'` takes precedence over a valid vessel option.
The module has no dependencies and runs in browsers and Node.

## Development

| File | Role |
| --- | --- |
| `src/vase64.js` | Glyphs, encoding, decoding, and layout |
| `app.js` | Interface, colouring, sizing, copy/download |
| `styles.css` | Styling |
| `dev.html` | Source page with ES module imports |
| `index.html` | Generated self-contained page |
| `build.mjs` | Inlines the sources and validates the bundle |
| `bin/vase64.js` | CLI |
| `test/` | Codec and single-file interface tests |

```sh
npm run serve  # http://localhost:8080 — serves dev.html
npm run build  # regenerate index.html after source edits
npm test
```

Use a server for `dev.html`: browser file-origin restrictions block its module
imports when opened directly from disk. The build checks for external script
or stylesheet references, leftover module syntax, and script parsing errors.

Tests cover the 64 glyphs, text and Unicode round trips, automatic layout
boundaries, width growth, connected vessel geometry, forgiving paste handling,
and execution of the generated page against a minimal DOM. Browser visual
checks complement these tests.

## Licence

MIT.
