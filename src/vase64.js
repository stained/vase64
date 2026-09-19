/*!
 * VASE64 - base64, but it blooms.
 *
 * The codec is deliberately tiny and dependency free so the same file can be
 * loaded by the browser (as an ES module) and by node (tests + CLI).
 *
 * Encoding pipeline
 * -----------------
 *   text  ->  UTF-8 bytes  ->  standard base64  ->  one 2-row plant glyph
 *                                                  per base64 character
 *
 * A glyph is 5 columns wide and 2 rows tall:
 *
 *      leaf   stem   bloom   stem   leaf      <- the bloom row carries the value
 *        .    stem    .     stem    .        <- the body row makes it a plant
 *
 * The value is chopped into three independent 2-bit fields, which is what makes
 * the mapping a bijection:
 *
 *      bits 4-5  (v >> 4)  bloom  -> o  O  *  @      (petals grow)
 *      bits 2-3  (v >> 2)  stem   -> |:  !|  :|  !'
 *      bits 0-1  (v)       leaves -> none  (  )  both
 *
 * Blooms, stems and leaves each draw from their own character set, so a row is
 * unambiguous: two stems, one bloom, and whatever leaves survive editing. Only
 * the bloom row is ever read back.
 *
 * Because every glyph is exactly 2 rows tall, the flower is a perfectly
 * regular grid: plants sit side by side above the rim and a vase is drawn
 * around them. Nothing about the vase carries data, so it can be redrawn,
 * resized or thrown away without losing a single bit. That also means a vase
 * with the frame stripped is still a valid VASE64 document.
 */

export const BASE64_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Value of a base64 character, or -1 when the character is not in the alphabet. */
export function base64Value(character) {
  return BASE64_ALPHABET.indexOf(character);
}

/* -------------------------------------------------------------------------- */
/* glyph table                                                                */
/* -------------------------------------------------------------------------- */

/** Column layout of a glyph: three leaf slots and the two stems between them. */
const GLYPH_COLUMNS = 5;

/** The four stems, in the order their codes are assigned. */
const STEMS = ['|', '!', ':', "'"];

/** The four blooms, in the order their codes are assigned: the tiers grow. */
const BLOOMS = ['o', 'O', '*', '@'];

/** Stems are grouped in pairs, selected by bits 2-3. */
const STEM_STYLES = [['|', ':'], ['!', '|'], [':', '|'], ['!', "'"]];

/** Leaf slots, indexed by bits 0-1. */
const LEAF_MODES = [
  { left: ' ', right: ' ' },
  { left: '/', right: ' ' },
  { left: ' ', right: '\\' },
  { left: '/', right: '\\' },
];

/**
 * Every character a plant row may contain. The vase is drawn only from lines
 * (`|` `\` `/` `_`), so any row with exactly one bloom and two stems is a
 * plant row and everything else in it is foliage. Only the bloom row carries
 * data; the vine below it is decoration.
 */
export const LEAVES = '/\\';
export const PLANT_ALPHABET = `${BLOOMS.join('')}${STEMS.join('')}${LEAVES}`;

/**
 * The character sets a plant is built from, as strings, for callers that want
 * to colour or describe a vase. Exported so there is exactly one definition of
 * them: the web app inlines this module into the same scope as itself, where a
 * second `const BLOOMS` would be a hard syntax error.
 */
export const BLOOM_CHARACTERS = BLOOMS.join('');
export const STEM_CHARACTERS = STEMS.join('');

function buildGlyph(value) {
  const bloom = BLOOMS[(value >> 4) & 0b11];
  const leaf = LEAF_MODES[value & 0b11];
  const [left, right] = STEM_STYLES[(value >> 2) & 0b11];
  return [`${leaf.left}${left}${bloom}${right}${leaf.right}`, ` ${left} ${right} `];
}

/** value (0-63) -> the two rows of its plant, top row first. */
export const GLYPHS = Array.from({ length: 64 }, (_, value) => buildGlyph(value));

/** The 64 glyphs joined as one string, used to spot structural collisions. */
export const GLYPH_SIGNATURES = GLYPHS.map((glyph) => glyph.join('\n'));

const GLYPH_LOOKUP = new Map(GLYPHS.map((glyph, value) => [glyph.join('\n'), value]));
const BLOOM_LOOKUP = new Map(BLOOMS.map((bloom, index) => [bloom, index]));
// Each stem position carries its own two bits, so both positions have to be
// read back before the pair can be turned into a style index: the table above
// uses all four combinations (`|:` `!|` `:|` `!;`), and no linear combination
// of two two-bit digits can invert that. Reading the pair through a table also
// keeps `|o:` from collapsing into `!o:`.
const STEM_LOOKUP = new Map(STEMS.map((stem, index) => [stem, index]));
const STEM_PAIRS = new Map(
  STEM_STYLES.map(([left, right], index) => [`${left}${right}`, index]),
);
const stemFromPair = (left, right) => {
  const style = STEM_PAIRS.get(`${STEMS[left]}${STEMS[right]}`);
  return style === undefined ? -1 : style;
};

/**
 * Read a pair of rows back into a 6-bit value.
 * @returns {number} 0-63, or -1 when the rows are not a glyph.
 */
export function glyphToValue(topRow, bottomRow = '') {
  const exact = GLYPH_LOOKUP.get(`${topRow}\n${bottomRow}`);
  if (exact !== undefined) return exact;
  return glyphToValueLenient(topRow);
}

/**
 * Recover a value from a glyph whose leaves have been retouched or whose
 * gutter collapsed. Blooms carry bits 4-5 (they are unique per glyph), stems
 * carry bits 2-3, leaves are decorative enough to survive being mangled.
 *
 * @returns {number} 0-63, or -1 when no bloom / stem can be found.
 */
export function glyphToValueLenient(row = '') {
  let bloomIndex = -1;
  const stems = [];
  for (const character of row) {
    const bloom = BLOOM_LOOKUP.get(character);
    if (bloom !== undefined) {
      if (bloomIndex !== -1) return -1; // two blooms in one row: not a glyph
      bloomIndex = bloom;
      continue;
    }
    if (STEM_LOOKUP.has(character)) stems.push(STEM_LOOKUP.get(character));
  }
  if (bloomIndex === -1 || stems.length !== 2) return -1;
  const leaves = leafModeFromRow(row);
  if (leaves === -1) return -1;
  const style = stemFromPair(stems[0], stems[1]);
  if (style === -1) return -1;
  return (bloomIndex << 4) | (style << 2) | leaves;
}

/** Bits 0-1 as read off the leaves surrounding the bloom. */
function leafModeFromRow(row) {
  const bloomAt = row.search(/[oO*@]/);
  if (bloomAt === -1) return -1;
  const left = row.slice(0, bloomAt).includes('/');
  const right = row.slice(bloomAt + 1).includes('\\');
  if (left && right) return 0b11;
  if (left) return 0b01;
  if (right) return 0b10;
  return 0b00;
}

/** Is this line the top half of a plant? */
export function isPlantRow(line = '') {
  const planted = countPlants(line);
  return planted.blooms === 1 && planted.stems === 2;
}

/** Count the blooms and stems on a line. */
function countPlants(line = '') {
  let blooms = 0;
  let stems = 0;
  for (const character of line) {
    if (character === ' ') continue;
    if (BLOOM_LOOKUP.has(character)) blooms += 1;
    else if (STEM_LOOKUP.has(character)) stems += 1;
  }
  return { blooms, stems };
}

/**
 * Does this line carry flowers? Only bloom rows do - the stem rows under them
 * are decoration, and the vase has no blooms at all.
 */
export function hasFlowers(line = '') {
  for (const character of line) {
    if (BLOOM_LOOKUP.has(character)) return true;
  }
  return false;
}

/**
 * Split a flower row into individual glyphs.
 *
 * A row of flowers is a field, not a single plant: it packs as many glyphs as
 * fit. Each bloom anchors one glyph - the stem before it, the two stems after
 * it, and the leaves those stems carry - so a leaf overhanging from the next
 * plant is picked up by that plant instead of confusing this one.
 *
 * @returns {Array<string>} one glyph per plant, left to right.
 */
export function splitGlyphs(row = '') {
  const glyphs = [];
  let cursor = 0;
  while (cursor < row.length) {
    const bloomAt = findBloom(row, cursor);
    if (bloomAt === -1) break;
    const leftStem = findStemBefore(row, bloomAt, cursor);
    if (leftStem === -1) {
      cursor = bloomAt + 1;
      continue;
    }
    // Every glyph is exactly GLYPH_COLUMNS wide, so the left stem fixes both
    // edges: one column for the leaf to its left, and the bloom two along.
    const start = Math.max(cursor, leftStem - 1);
    glyphs.push(row.slice(start, start + GLYPH_COLUMNS));
    cursor = start + GLYPH_COLUMNS;
  }
  return glyphs;
}

/** Index of the next bloom at or after `from`, or -1. */
function findBloom(row, from) {
  for (let index = from; index < row.length; index += 1) {
    if (BLOOM_LOOKUP.has(row[index])) return index;
  }
  return -1;
}

/** Index of the stem belonging to the bloom at `bloomAt`, or -1. */
function findStemBefore(row, bloomAt, from) {
  for (let index = bloomAt - 1; index >= from; index -= 1) {
    if (STEM_LOOKUP.has(row[index])) return index;
  }
  return -1;
}

/* -------------------------------------------------------------------------- */
/* text <-> bytes                                                             */
/* -------------------------------------------------------------------------- */

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8', { fatal: false });

/* -------------------------------------------------------------------------- */
/* the garden                                                                */
/* -------------------------------------------------------------------------- */

export const DEFAULT_OPTIONS = Object.freeze({
  /** Which shape to pour the flowers into. */
  vessel: 'bud',
  /** Leave a blank row between the flowers and the rim. */
  breathingRoom: true,
  /** Sign the work. */
  stamp: true,
});

/* -------------------------------------------------------------------------- */
/* vessels                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * A vessel is a *curve*, not a picture.
 *
 * Each vessel lists a handful of control points - "at 40% of the height the
 * vase is 7 columns wide" - and the art is generated from them. That is how
 * ASCII art actually gets its shapes: you decide the silhouette, then pick a
 * character per row from the *slope* of that silhouette, because `/` and `\`
 * read as a diagonal and `_` reads as a horizontal edge.
 *
 *   `points`  [t, width] control points, t from 0 (rim) to 1 (base)
 *   `steps`   how many rows the body is drawn over
 *   `water`   t range that gets the `~` surface
 *   `band`    t range that gets an `=` band
 *   `pour`    row where the vase begins; flowers stack strictly above it, and
 *             its width is the mouth the bouquet is poured through
 *
 * Two conventions make the result look right rather than merely correct:
 *
 *   * widths are forced odd, so every row has a centre column and the vase
 *     stays symmetric as it is widened;
 *   * `steps` is chosen so each row changes width by about two columns, which
 *     is one column each side. On a text grid a cell is about twice as tall as
 *     it is wide, so that finally makes a 45 degree slope look like 45 degrees.
 */
const VESSEL_PROFILES = {
  bud: {
    name: 'Bud vase',
    blurb: 'A slim taper for short messages.',
    points: [
      [0.0, 15],
      [0.55, 9],
      [1.0, 7],
    ],
    steps: 11,
    water: [0.6, 0.72],
    band: [0.82, 0.92],
    pour: 1,
  },
  bowl: {
    name: 'Bowl',
    blurb: 'A wide mouth that swallows long payloads.',
    points: [
      [0.0, 21],
      [0.55, 15],
      [1.0, 7],
    ],
    steps: 11,
    water: [0.55, 0.66],
    band: [0.76, 0.86],
    pour: 1,
  },
  urn: {
    name: 'Urn',
    blurb: 'A tall body for the very long haul.',
    points: [
      [0.0, 13],
      [0.22, 9],
      [0.55, 17],
      [1.0, 13],
    ],
    steps: 11,
    water: [0.5, 0.6],
    band: [0.72, 0.82],
    pour: 1,
  },
};

/* -------------------------------------------------------------------------- */
/* drawing a curve as ASCII                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Interpolate the width at position `t` (0 at the rim, 1 at the base).
 *
 * The curve is a smoothstep between control points rather than a straight
 * line: real vases curve, and a straight interpolation gives every row the
 * same slope, which reads as a traffic cone.
 */
function widthAt(points, t) {
  const clamped = Math.min(1, Math.max(0, t));
  let before = points[0];
  let after = points[points.length - 1];
  for (let index = 1; index < points.length; index += 1) {
    if (clamped <= points[index][0]) {
      before = points[index - 1];
      after = points[index];
      break;
    }
  }
  const span = after[0] - before[0];
  const local = span === 0 ? 0 : (clamped - before[0]) / span;
  const eased = local * local * (3 - 2 * local);
  return before[1] + (after[1] - before[1]) * eased;
}

/** Force a width to odd, so the row has a centre column to sit on. */
function oddWidth(width) {
  const whole = Math.max(3, Math.round(width));
  return whole % 2 === 0 ? whole - 1 : whole;
}

/**
 * Pick a wall character from how far *that* wall moves between two rows.
 *
 * On a text grid a cell is about twice as tall as it is wide, so a diagonal
 * covers about half a cell per row: one column of movement per row is already
 * a fairly steep line, and anything more has to be drawn as a step. Each side
 * is asked separately, because a vase that widens on the left and narrows on
 * the right needs two different characters.
 *
 * `shift` is how far the wall moves *towards the axis* going down the vase, so
 * a positive shift means the silhouette is closing in.
 */
function wallFor(shift, side) {
  if (shift === 0) return '|';
  const left = side === 'left';
  if (shift > 0) return left ? '\\' : '/';
  return left ? '/' : '\\';
}

/**
 * Draw one vessel profile into a rectangular block of ASCII. Every row is
 * padded out to the widest one, so the vase is symmetric about a fixed axis
 * however the curve moves.
 */
function buildVesselArt(spec) {
  const stepAt = (step) => (spec.steps === 1 ? 1 : step / (spec.steps - 1));

  // Work out every row's width first, so each wall can be drawn from the step
  // the drawing actually takes rather than from the ideal curve behind it.
  //
  // The steps are then limited to two columns (one per side). A character can
  // only lean one column per row before it stops being a line, so a curve that
  // asks for more than that would be drawn as a jump and the contour would
  // break; clamping keeps the silhouette followable, at the cost of a slightly
  // tighter curve than the control points asked for.
  const widths = [];
  for (let step = 0; step < spec.steps; step += 1) {
    const wanted = oddWidth(widthAt(spec.points, stepAt(step)));
    const previous = widths[step - 1];
    widths.push(
      previous === undefined ? wanted : Math.min(Math.max(wanted, previous - 2), previous + 2),
    );
  }

  const natural = Math.max(...widths);
  const centred = (width, body) =>
    ' '.repeat((natural - width) / 2) + body + ' '.repeat((natural - width) / 2);

  // Where a row of this width puts its left wall.
  const wallAt = (width) => (natural - width) / 2;

  // Above the body: the flared opening, then the lip the bouquet sits in.
  const rim = oddWidth(widthAt(spec.points, 0));
  const art = [centred(rim, `\\${' '.repeat(rim - 2)}/`), centred(rim, `|${' '.repeat(rim - 2)}|`)];

  for (let step = 0; step < spec.steps; step += 1) {
    const t = stepAt(step);
    const width = widths[step];
    const next = widths[Math.min(step + 1, spec.steps - 1)];
    const last = step === spec.steps - 1;
    // How far the silhouette moves towards its axis on the way to the next
    // row: positive when the vase narrows, negative when it flares.
    const shift = last ? 0 : wallAt(next) - wallAt(width);

    let fill = ' ';
    if (spec.water && t >= spec.water[0] && t <= spec.water[1]) fill = '~';
    else if (spec.band && t >= spec.band[0] && t <= spec.band[1]) fill = '=';

    // The base closes with a flat run of underscores.
    const interior = (last ? '_' : fill).repeat(width - 2);
    const left = last ? '\\' : wallFor(shift, 'left');
    const right = last ? '_' : wallFor(shift, 'right');
    art.push(centred(width, left + interior + right));
  }
  return art;
}

/** Build the art, the natural width and the rim from one profile. */
function assembleVessel([key, spec]) {
  const art = buildVesselArt(spec);
  return [
    key,
    Object.freeze({
      ...spec,
      key,
      art: Object.freeze(art),
      naturalWidth: Math.max(...art.map((row) => row.length)),
    }),
  ];
}

/** The finished vessels: profile, art and natural width, all frozen. */
export const VESSELS = Object.freeze(
  Object.fromEntries(Object.entries(VESSEL_PROFILES).map(assembleVessel)),
);

/** Vessel legend: what counts as a wall, and what has to be non-wall. */
const WALL = /[|\\/_]/;

/**
 * Flatten a vessel template into rows of cells plus their walls.
 */
function parseVessel(vessel) {
  return vessel.art.map((row) => {
    const cells = [...row].map((character) => ({ character, wall: WALL.test(character) }));
    const walls = [];
    cells.forEach((cell, column) => {
      if (cell.wall) walls.push(column);
    });
    return {
      cells,
      first: walls[0],
      last: walls[walls.length - 1],
      spans: walls.length > 0,
    };
  });
}

/**
 * The span between a row's walls: none when the row has no walls, the gap when
 * it has two, and the mirrored gap when a single wall is the whole row.
 */
function hollowSpan(row) {
  if (!row.spans) return 0;
  return row.first === row.last ? 2 * (row.first + 1) - 1 : row.last - row.first - 1;
}

/**
 * The interior width a row has once the vase is `width` columns wide, plus the
 * column its left wall lands on.
 *
 * Both edges are derived from the shared axis rather than from each other:
 * scaling a left offset and a span separately lets the two round in opposite
 * directions, which is what makes one side of a vase fatter than the other.
 */
function scaleRow(row, width, natural) {
  const interior = Math.max(1, Math.round(hollowSpan(row) * (width / natural)));
  // Odd interiors leave one centre column; even ones straddle it. Forcing odd
  // keeps the two walls the same distance from the axis.
  const span = interior % 2 === 1 ? interior : interior + 1;
  // Centre the span on the axis rather than preserving the raw offsets: the
  // drawing's own rows are not perfectly concentric, and scaling that
  // irregularity is what makes a widened vase look lopsided.
  const wall = Math.max(0, Math.floor((width - 1 - span) / 2));
  return { span, wall };
}

/** The hollow span a row has once the vase is `width` columns wide. */
function spanAt(row, width, natural) {
  if (!row.spans) return 0;
  return scaleRow(row, width, natural).span;
}

/**
 * Draw one vase row `width` columns wide on the axis every row shares. The
 * span is re-tiled with the row's own filler, so a water line stays a water
 * line and a plain body row stays hollow.
 */
function buildVaseRow(row, width, natural) {
  const padding = (content) =>
    ' '.repeat(Math.max(0, Math.round((width - content.length) / 2))) + content;

  // A row with no walls is decoration: centre it and leave the rest to the
  // rows above and below, which do have walls.
  if (!row.spans) return padding(row.cells.map((cell) => cell.character).join(''));
  // A row that narrows to one column is that column, bled out across the crop.
  if (row.first === row.last) return row.cells[row.first].character.repeat(Math.max(1, width));

  const { span, wall } = scaleRow(row, width, natural);
  const filler = row.cells
    .slice(row.first + 1, row.last)
    .map((cell) => cell.character)
    .filter((character) => character !== ' ');
  const interior = [];
  for (let index = 0; index < span; index += 1) {
    interior.push(filler.length === 0 ? ' ' : filler[index % filler.length]);
  }
  return (
    ' '.repeat(wall) +
    row.cells[row.first].character +
    interior.join('') +
    row.cells[row.last].character
  );
}

const BED = Object.freeze({
  /** One glyph plus a column of elbow room. */
  min: GLYPH_COLUMNS + 2,
  /** Where a short message stops growing the vase. */
  default: 25,
  /** Hard ceiling, in columns, for the whole canvas. */
  max: 121,
  /** How much bed each extra row of flowers buys. */
  perRow: 2,
});

/**
 * Turn base64 text into an ASCII vase.
 *
 * @param {string} base64
 * @param {object} [options]
 * @returns {string}
 */
export function base64ToVase(base64, options = {}) {
  const config = { ...DEFAULT_OPTIONS, ...options };
  if (typeof base64 !== 'string') throw new TypeError('base64ToVase expects a string');
  const vessel = VESSELS[config.vessel ?? 'bud'];
  if (!vessel) {
    throw new Error(
      `VASE64: unknown vessel "${config.vessel}" (try ${Object.keys(VESSELS).join(', ')})`,
    );
  }

  const values = [];
  for (const character of base64) {
    if (character === '=' || character === '\n' || character === '\r') continue;
    const value = base64Value(character);
    if (value === -1) {
      throw new Error(`VASE64: "${character}" is not a base64 character`);
    }
    values.push(value);
  }

  const rows = parseVessel(vessel);
  const natural = vessel.naturalWidth;
  const rim = rows[vessel.pour];

  // The flower bed is the canvas everything else is measured against. It grows
  // with the message, which both keeps a big bouquet from becoming a single
  // endless column and widens the vase it is poured into.
  const rowsWanted = Math.ceil(values.length / GLYPH_COLUMNS);
  const bedWidth = Math.max(
    BED.min,
    Math.min(BED.default + Math.max(0, rowsWanted - 1) * BED.perRow, BED.max),
  );
  const columns = Math.max(1, Math.floor(bedWidth / GLYPH_COLUMNS));
  // One column of vase on either side: the bouquet overhangs its rim the way a
  // real one does, and the widest rows still line up under it. An odd canvas
  // width has a single centre column, which is what lets every row of the vase
  // centre on the same axis exactly.
  const evenBed = bedWidth + 2;
  const width = evenBed % 2 === 1 ? evenBed : evenBed + 1;
  // Flowers are placed on that same axis, not against their own left edge.
  // Flooring the half-column is what keeps an even-width row of flowers and an
  // odd-width vase row on the identical centre column.
  const axis = (width - 1) / 2;
  const place = (content) =>
    ' '.repeat(Math.max(0, Math.floor(axis - (content.length - 1) / 2))) + content;

  const lines = [];
  for (let start = 0; start < values.length; start += columns) {
    const chunk = values.slice(start, start + columns);
    const top = [];
    const bottom = [];
    for (const value of chunk) {
      const glyph = GLYPHS[value];
      top.push(glyph[0]);
      bottom.push(glyph[1]);
    }
    // `place` centres each row on the vase's axis, which is what makes a short
    // final row finish the bouquet instead of leaning to one side. Adding any
    // padding here as well would centre it twice and push it off-axis.
    lines.push(place(top.join('')).trimEnd());
    lines.push(place(bottom.join('')).trimEnd());
  }

  if (config.breathingRoom && values.length > 0) lines.push('');

  // buildVaseRow aligns each row on the axis itself, so nothing is padded
  // twice. The stamp is what gives the canvas its margin, so a wide vase that
  // fills the stage still sits clear of the floating panel.
  for (const row of rows) lines.push(buildVaseRow(row, width, natural).trimEnd());

  if (config.stamp) {
    lines.push('');
    const signature = 'VASE64';
    lines.push(place(signature));
  }
  return lines.join('\n');
}

/**
 * Pull the base64 back out of a vase.
 *
 * Blank lines, the vase outline, line-number gutters and the stamp are all
 * ignored; only the bloom rows contribute data, and each row may hold many
 * plants.
 *
 * @param {string} vase
 * @returns {string} base64 (unpadded, as stored)
 */
export function vaseToBase64(vase) {
  if (typeof vase !== 'string') throw new TypeError('vaseToBase64 expects a string');
  let base64 = '';
  for (const rawLine of vase.split(/\r?\n/)) {
    const line = stripGutter(rawLine).replace(/\s+$/, '');
    for (const glyph of splitGlyphs(line)) {
      const value = glyphToValueLenient(glyph);
      if (value !== -1) base64 += BASE64_ALPHABET[value];
    }
  }
  return base64;
}

/** Drop a leading `12 | ` gutter when one is present. */
function stripGutter(line) {
  return line.replace(/^\s*\d+\s*[|│]\s?/, '');
}

/* -------------------------------------------------------------------------- */
/* public API                                                                 */
/* -------------------------------------------------------------------------- */

export function encodeToVase(text, options = {}) {
  const bytes = textEncoder.encode(String(text ?? ''));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const base64 = typeof btoa === 'function'
    ? btoa(binary)
    : Buffer.from(bytes).toString('base64');
  return base64ToVase(base64, options);
}

export function decodeVase(vase) {
  return decodeBase64(vaseToBase64(vase));
}

export function decodeBase64(base64) {
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  const binary = typeof atob === 'function'
    ? atob(padded)
    : Buffer.from(padded, 'base64').toString('binary');
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return textDecoder.decode(bytes);
}

/** How many glyphs a vase document holds. */
export function countGlyphs(vase) {
  return vaseToBase64(vase).length;
}

/**
 * Check a document without decoding it. Useful for the UI's live status line.
 *
 * @returns {{ok: boolean, glyphs: number, problems: Array<{line: number, message: string}>}}
 */
export function inspectVase(vase) {
  const problems = [];
  let glyphs = 0;
  const lines = String(vase ?? '').split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = stripGutter(lines[index]).replace(/\s+$/, '');
    if (!hasFlowers(line)) continue;
    const found = splitGlyphs(line);
    if (found.length === 0) {
      problems.push({ line: index + 1, message: 'carries a bloom but no complete plant' });
      continue;
    }
    let readable = 0;
    for (const glyph of found) {
      if (glyphToValueLenient(glyph) === -1) {
        problems.push({
          line: index + 1,
          message: `could not read a 6-bit value from ${JSON.stringify(glyph)}`,
        });
      } else {
        readable += 1;
      }
    }
    glyphs += readable;
  }
  return { ok: problems.length === 0 && glyphs > 0, glyphs, problems };
}

/** The garden, as text. Handy for docs, tests and the UI's help panel. */
export function glyphTable() {
  return GLYPHS.map((glyph, value) => {
    const bits = value.toString(2).padStart(6, '0');
    return `${String(value).padStart(2)} ${BASE64_ALPHABET[value]} ${bits}  ${glyph[0]}  ${glyph[1]}`;
  }).join('\n');
}
