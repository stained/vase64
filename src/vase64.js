/*!
 * VASE64: UTF-8 text -> base64 -> one 5-column, 4-row plant per
 * unpadded base64 character. Each plant stores six bits:
 * bloom (o O * @), stem (| ! : '), and leaves (none, left, right, both).
 * The decoder reads the bloom and leaves in row 0 and the stem in row 3.
 * Rows 1 and 2 are decorative; row 3 must retain its aligned stem.
 * Up to 32 plants form a vase; longer payloads become widening flower beds.
 * Frames, connecting stems, soil and the signature carry no payload data.
 * This dependency-free module runs in the browser and Node.
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

/**
 * A plant is a cell five columns wide and four rows tall:
 *
 *      row 0   the bloom and optional leaves          <- four data bits
 *      row 1   foliage
 *      row 2   a node, where the branches meet
 *      row 3   the aligned stem                       <- two data bits
 *
 * The bloom sits in the middle of the cell and the stem directly under it, so
 * plants in adjacent cells never overlap and a bloom is always the only bloom
 * anywhere near its own column.
 */
export const CELL_COLUMNS = 5;
export const CELL_ROWS = 4;

/** The four blooms, in the order their codes are assigned: the tiers grow. */
const BLOOMS = ['o', 'O', '*', '@'];

/** The four stems, in the order their codes are assigned. */
const STEMS = ['|', '!', ':', "'"];

/** Leaf slots, indexed by bits 0-1. */
const LEAF_MODES = [
  { left: ' ', right: ' ' },
  { left: '/', right: ' ' },
  { left: ' ', right: '\\' },
  { left: '/', right: '\\' },
];

/** The column of a cell the stem is drawn in, from the bloom to the root. */
const STEM_COLUMN = 2;
/** Patterns for rows 2 and 3. The stem is stamped into column 2 (zero-based). */
const STEM_DECORATION = [
  { node: '  |  ', foliage: '  |  ' },
  { node: ' --+ ', foliage: ' --!-' },
  { node: '  :  ', foliage: '  :  ' },
  { node: "  '  ", foliage: "  '  " },
];

/** Bloom characters are reserved for plants; frames and soil never use them. */
export const LEAVES = '/\\';
export const PLANT_ALPHABET = `${BLOOMS.join('')}${STEMS.join('')}${LEAVES}-+`;

/**
 * The character sets a plant is built from, as strings, for callers that want
 * to colour or describe a vase. Exported so there is exactly one definition of
 * them: the web app inlines this module into the same scope as itself, where a
 * second `const BLOOMS` would be a hard syntax error.
 */
export const BLOOM_CHARACTERS = BLOOMS.join('');
export const STEM_CHARACTERS = STEMS.join('');

/**
 * Build one plant. The value is read as three independent 2-bit fields, which
 * is what makes the 64 glyphs a bijection onto the base64 alphabet:
 *
 *   bits 4-5  bloom     o O * @
 *   bits 2-3  stem      | ! : '
 *   bits 0-1  leaves    none, left, right, both
 *
 * A cell is five columns wide and four rows tall. Every row is built by
 * writing into a fixed array. Row 0 contains the bloom and leaf flags;
 * row 1 repeats the leaves around a stem; rows 2 and 3 use the patterns above.
 *
 * The bloom sits in column 2 and the stem directly under it in the same
 * column, so the reader can always find one from the other.
 */
function buildGlyph(value) {
  const bloom = BLOOMS[(value >> 4) & 0b11];
  const style = (value >> 2) & 0b11;
  const stem = STEMS[style];
  const leaf = LEAF_MODES[value & 0b11];
  const decoration = STEM_DECORATION[style];

  // Every row is assembled from its columns, so the bloom and the stem beneath
  // it land in the same one without any counting of spaces.
  const row = (fills) => {
    const cells = new Array(CELL_COLUMNS).fill(' ');
    for (const [column, character] of Object.entries(fills)) cells[column] = character;
    return cells.join('');
  };

  // The stem is drawn in one column - STEM_COLUMN - from the bloom down to the
  // root, so the reader can find the two from each other. The decoration rows
  // are stamped over that column rather than the other way round.
  const stamped = (pattern) => {
    const cells = [...pattern];
    cells[STEM_COLUMN] = stem;
    return cells.join('');
  };

  return [
    // A single stem, with the bloom sitting on top of it in the same column.
    row({ 0: leaf.left, [STEM_COLUMN]: bloom, 4: leaf.right }),
    row({ 0: leaf.left, [STEM_COLUMN]: stem, 4: leaf.right }),
    stamped(decoration.node),
    stamped(decoration.foliage),
  ];
}

/** value (0-63) -> the four rows of its plant, bloom row first. */
export const GLYPHS = Array.from({ length: 64 }, (_, value) => buildGlyph(value));

/** The 64 glyphs joined as one string, used to spot structural collisions. */
export const GLYPH_SIGNATURES = GLYPHS.map((glyph) => glyph.join('\n'));

const GLYPH_LOOKUP = new Map(GLYPHS.map((glyph, value) => [glyph.join('\n'), value]));
const BLOOM_LOOKUP = new Map(BLOOMS.map((bloom, index) => [bloom, index]));
const STEM_LOOKUP = new Map(STEMS.map((stem, index) => [stem, index]));

/**
 * Read a plant back into a 6-bit value.
 *
 * A cell can be given as its four rows (an array) or as one string, in which
 * case newlines separate the rows. Try a full-cell match first, then fall back
 * to the bloom/leaf row and the aligned stem in the fourth row.
 *
 * @returns {number} 0-63, or -1 when this is not a plant.
 */
export function glyphToValue(cell) {
  const rows = Array.isArray(cell) ? cell : String(cell).split('\n');
  const exact = GLYPH_LOOKUP.get(rows.slice(0, CELL_ROWS).join('\n'));
  if (exact !== undefined) return exact;
  return glyphToValueLenient(cell);
}

/**
 * Recover a value from a plant whose non-data decoration has changed.
 * Row 0 stores bloom bits 4-5 and leaf bits 0-1; row 3 stores stem bits 2-3.
 * Removing a bloom-row leaf changes the value. Removing the bottom stem
 * makes the plant unreadable. Spacing must preserve their shared column.
 *
 * @returns {number} 0-63, or -1 when no bloom / stem can be found.
 */
export function glyphToValueLenient(cell) {
  const rows = Array.isArray(cell) ? cell : String(cell).split('\n');
  const bloomRow = rows[0] ?? '';
  const stemRow = rows[CELL_ROWS - 1] ?? '';

  // Exactly one bloom, with a stem in the same column three rows below.
  const bloomAt = bloomRow.search(/[oO*@]/);
  if (bloomAt === -1) return -1;
  if (/[oO*@]/.test(bloomRow.slice(bloomAt + 1))) return -1;
  // The stem is directly under the bloom: one column, no guessing. Rows are
  // normalised by `tidyVase` before they get here, so the two always line up.
  const style = STEM_LOOKUP.get(stemRow[bloomAt]);
  if (style === undefined) return -1;

  const leaves = leafModeFromRow(bloomRow, bloomAt);
  if (leaves === -1) return -1;
  return (BLOOM_LOOKUP.get(bloomRow[bloomAt]) << 4) | (style << 2) | leaves;
}

/** Bits 0-1 as read off the leaves beside the bloom. */
function leafModeFromRow(row, bloomAt) {
  const left = row.slice(0, bloomAt).includes('/');
  const right = row.slice(bloomAt + 1).includes('\\');
  if (left && right) return 0b11;
  if (left) return 0b01;
  if (right) return 0b10;
  return 0b00;
}

/** Is this the bloom row of a plant? */
export function isPlantRow(line = '') {
  return countPlants(line).blooms === 1;
}

/** Count the blooms and stems on a line. */
function countPlants(line = '') {
  let blooms = 0;
  let stems = 0;
  for (const character of line) {
    if (BLOOM_LOOKUP.has(character)) blooms += 1;
    else if (STEM_LOOKUP.has(character)) stems += 1;
  }
  return { blooms, stems };
}

/**
 * Does this line carry flowers? Only bloom rows do - the rows beneath them are
 * the rest of the plant, and the vase has no blooms at all.
 */
export function hasFlowers(line = '') {
  for (const character of line) {
    if (BLOOM_LOOKUP.has(character)) return true;
  }
  return false;
}

/**
 * Find every plant in a vase.
 *
 * A bloom anchors a plant and is never ambiguous: the stem is directly beneath
 * it, the leaves are beside it, and no other bloom is within a cell of it. The
 * decoration rows are carried along so a caller can show or redraw the whole
 * plant, but the value comes from the bloom row and the stem.
 *
 * @param {string} text the whole vase
 * @returns {Array<{row: number, column: number, rows: string[], value: number}>}
 */
export function splitPlants(text = '') {
  const lines = String(text).split('\n');
  const plants = [];
  for (let row = 0; row < lines.length; row += 1) {
    const line = lines[row];
    for (let column = 0; column < line.length; column += 1) {
      if (!BLOOM_LOOKUP.has(line[column])) continue;
      // Two blooms this close together cannot both be plants.
      if (line.slice(column + 1, column + CELL_COLUMNS).match(/[oO*@]/)) continue;
      // The cell starts STEM_COLUMN columns to the left of the bloom, so the
      // rows come back in the same shape the writer built them in.
      const left = column - STEM_COLUMN;
      const rows = [];
      for (let step = 0; step < CELL_ROWS; step += 1) {
        rows.push((lines[row + step] ?? '').slice(left, left + CELL_COLUMNS));
      }
      plants.push({ row, column: left, rows, value: glyphToValueLenient(rows) });
    }
  }
  return plants;
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
  /** Vase shape is chosen from the payload; explicit vessels remain a library override. */
  vessel: 'auto',
  layout: 'auto',
  /** Give the connecting stems two extra rows above the rim. */
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
 * Each side moves at most one column per row. The wall character follows
 * that movement so consecutive rows keep a connected contour.
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
function buildVesselArt(spec, targetWidth = Math.max(...spec.points.map(([, width]) => width))) {
  const scale = targetWidth / Math.max(...spec.points.map(([, width]) => width));
  const steps = Math.max(spec.steps, Math.ceil(spec.steps * scale * 0.65));
  const stepAt = (step) => (steps === 1 ? 1 : step / (steps - 1));

  // Work out every row's width first, so each wall can be drawn from the step
  // the drawing actually takes rather than from the ideal curve behind it.
  //
  // The steps are then limited to two columns (one per side). A character can
  // only lean one column per row before it stops being a line, so a curve that
  // asks for more than that would be drawn as a jump and the contour would
  // break; clamping keeps the silhouette followable, at the cost of a slightly
  // tighter curve than the control points asked for.
  const widths = [];
  for (let step = 0; step < steps; step += 1) {
    const wanted = oddWidth(widthAt(spec.points, stepAt(step)) * scale);
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
  const rim = widths[0];
  const art = [centred(rim, `.${'-'.repeat(rim - 2)}.`), centred(rim, `|${' '.repeat(rim - 2)}|`)];

  for (let step = 0; step < steps; step += 1) {
    const t = stepAt(step);
    const width = widths[step];
    const next = widths[Math.min(step + 1, steps - 1)];
    const last = step === steps - 1;
    // How far the silhouette moves towards its axis on the way to the next
    // row: positive when the vase narrows, negative when it flares.
    const shift = last ? 0 : wallAt(next) - wallAt(width);

    let fill = ' ';
    if (spec.water && t >= spec.water[0] && t <= spec.water[1]) fill = '~';
    else if (spec.band && t >= spec.band[0] && t <= spec.band[1]) fill = '=';

    // The base closes with a flat run of underscores.
    const interior = (last ? '_' : fill).repeat(width - 2);
    const left = last ? '\\' : wallFor(shift, 'left');
    const right = last ? '/' : wallFor(shift, 'right');
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

const BED = Object.freeze({
  /** One plant plus a column of elbow room. */
  min: CELL_COLUMNS + 2,
  /** Where a short message stops growing the vase. */
  default: 35,
  /** Hard ceiling, in columns, for the whole garden. */
  max: 121,
  /** How much wider the garden gets for each extra rack of plants. */
  perRack: 8,
  /** Beyond this the bouquet stops being a bouquet and becomes a field. */
  maxRacks: 36,
});

/**
 * How many plants a dome of `racks` rows can hold, and how wide that garden is.
 *
 * Each rack is one plant tall and holds as many plants as it is wide. The
 * racks narrow towards the top on a quarter sine, so the bouquet finishes in a
 * dome; a straight taper would give a pyramid, which reads as a stack of
 * shelves. A garden with more racks is also given a wider base, so a long
 * message spreads out rather than growing into one very tall column.
 */
function gardenPlan(racks) {
  const bedWidth = Math.min(BED.max, BED.default + (racks - 1) * BED.perRack);
  const capacity = Math.max(1, Math.floor(bedWidth / CELL_COLUMNS));
  let total = 0;
  const racks_ = [];
  for (let rack = 0; rack < racks; rack += 1) {
    const t = racks === 1 ? 1 : rack / (racks - 1);
    // A sine hump, then softened by a power below 1: a pure sine gives a
    // pointed top, and raising it flattens the shoulders so the bouquet reads
    // as rounded rather than as a cone.
    const hump = Math.pow(Math.sin((Math.PI / 2) * (1 - t)), 0.45);
    // Two columns minimum: a rack of one is a lone stalk standing above the
    // rest, which reads as a mistake rather than as the top of a bouquet.
    const columns = Math.max(2, Math.round(capacity * (0.35 + 0.65 * hump)));
    racks_.push(columns);
    total += columns;
  }
  return { bedWidth, racks: racks_, capacity: total };
}

/**
 * Fit `count` plants into the smallest dome that will hold them, and hand back
 * the racks to draw in display order, sharing unused space across the dome.
 */
function planGarden(count) {
  if (count === 0) return { bedWidth: BED.min, racks: [] };
  for (let racks = 1; racks <= BED.maxRacks; racks += 1) {
    const plan = gardenPlan(racks);
    if (plan.capacity < count) continue;
    // Fill the entire silhouette proportionally, then read top to bottom.
    // Keeping the spare capacity spread out avoids a lone remainder at the rim.
    const topDown = [...plan.racks].reverse();
    const used = topDown.map((columns) => Math.floor(columns * count / plan.capacity));
    let remaining = count - used.reduce((sum, columns) => sum + columns, 0);
    for (let index = used.length - 1; remaining > 0; index = (index - 1 + used.length) % used.length) {
      if (used[index] < topDown[index]) { used[index] += 1; remaining -= 1; }
    }
    return { bedWidth: plan.bedWidth, racks: used.filter(Boolean) };
  }
  // Long past the point of being readable as a garden: full-width racks keep it
  // lossless even if it stops looking like a bouquet.
  const capacity = Math.max(1, Math.floor(BED.max / CELL_COLUMNS));
  const racks = new Array(Math.ceil(count / capacity)).fill(capacity);
  return { bedWidth: BED.max, racks };
}

/** Stable visual seed from the payload values, independent of padding and newlines. */
function gardenSeed(values) {
  let seed = 2166136261;
  for (const value of values) seed = Math.imul(seed ^ value, 16777619) >>> 0;
  return seed;
}

/** A bed grows horizontally first, then adds equally wide beds below it. */
function renderFlowerBeds(values, config) {
  // Grow width with payload size while sharing flowers across rows. Cap at
  // 32 flowers (160 columns); beyond that, only the number of rows grows.
  const columns = Math.max(1, Math.min(32, values.length, Math.ceil(Math.sqrt(values.length * 4))));
  const interior = columns * CELL_COLUMNS;
  const width = interior + 2;
  const lines = [];
  const soil = ['.', ':', '='][gardenSeed(values) % 3];
  for (let start = 0; start < Math.max(1, values.length); start += columns) {
    if (start) lines.push('');
    const plants = values.slice(start, start + columns);
    for (let row = 0; row < CELL_ROWS && plants.length; row += 1) {
      lines.push((' ' + plants.map((value) => GLYPHS[value][row]).join('')).trimEnd());
    }
    const roots = plants.map((_, index) => 1 + index * CELL_COLUMNS + STEM_COLUMN);
    if (config.breathingRoom && plants.length) {
      const stems = new Array(width).fill(' ');
      for (const x of roots) stems[x] = '|';
      lines.push(stems.join('').trimEnd());
    }
    const rim = [...('.' + '-'.repeat(interior) + '.')];
    for (const x of roots) rim[x] = '|';
    lines.push(rim.join(''));
    lines.push('|' + soil.repeat(interior) + '|');
    lines.push('\\' + '_'.repeat(interior) + '/');
  }
  if (config.stamp) lines.push('', ' '.repeat(Math.max(0, Math.floor((width - 6) / 2))) + 'VASE64');
  return lines.join('\n');
}

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
  if (!['auto', 'vase', 'bed'].includes(config.layout)) {
    throw new Error(`VASE64: unknown layout "${config.layout}" (try auto, vase or bed)`);
  }
  if (config.vessel !== 'auto' && !VESSELS[config.vessel]) {
    throw new Error(`VASE64: unknown vessel "${config.vessel}" (try auto, ${Object.keys(VESSELS).join(', ')})`);
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

  const layout = config.layout === 'auto'
    ? (config.vessel !== 'auto' || values.length <= 32 ? 'vase' : 'bed')
    : config.layout;
  if (layout === 'bed') return renderFlowerBeds(values, config);
  const seed = gardenSeed(values);
  const vessel = VESSELS[config.vessel === 'auto' ? Object.keys(VESSELS)[seed % 3] : config.vessel];

  // The payload always follows display order: left to right, top to bottom.
  const plan = planGarden(values.length);
  const bedWidth = plan.bedWidth;
  const width = Math.max(vessel.naturalWidth, bedWidth + 2);
  // The garden is centred on the vase's axis as a whole block, not row by row:
  // a grid only lines up if every row starts in the same column. Flooring the
  // half-column keeps an even-width grid and an oddly wide vase on the
  // identical centre column.
  const leftPad = Math.max(0, Math.floor((width - 1) / 2 - (bedWidth - 1) / 2));
  const place = (content) => ' '.repeat(leftPad) + content;

  const lines = [];
  let planted = 0;
  let roots = [];
  for (const columns of plan.racks) {
    const slice = values.slice(planted, planted + columns);
    planted += slice.length;
    const rackWidth = columns * CELL_COLUMNS;
    // A narrow rack is centred in the bed, which is what rounds the top.
    const inset = Math.floor((bedWidth - rackWidth) / 2);
    roots = slice.map((_, index) => leftPad + inset + index * CELL_COLUMNS + STEM_COLUMN);
    for (let cellRow = 0; cellRow < CELL_ROWS; cellRow += 1) {
      const across = slice.map((value) => GLYPHS[value][cellRow]).join('');
      lines.push(place(' '.repeat(inset) + across).trimEnd());
    }
  }

  // Draw at the final resolution; never stretch an already rasterised outline.
  const proportion = { bud: 0.72, bowl: 0.92, urn: 0.68 }[vessel.key];
  const vesselWidth = oddWidth(Math.max(vessel.naturalWidth, Math.min(45, width * proportion * (config.vessel === 'auto' ? 0.9 + ((seed >>> 8) % 21) / 100 : 1))));
  const art = buildVesselArt(vessel, vesselWidth);
  const artWidth = Math.max(...art.map((row) => row.length));
  const offset = Math.floor((width - artWidth) / 2);
  const body = art.map((row) => [...(' '.repeat(Math.max(0, offset)) + row)]);
  if (roots.length) {
    const first = body[0].indexOf('.');
    const last = body[0].lastIndexOf('.');
    const centre = (first + last) / 2;
    const half = Math.max(0, Math.min((roots.at(-1) - roots[0]) / 2, Math.floor((last - first - 4) / 2)));
    const targets = roots.map((_, index) => Math.round(centre +
      (roots.length === 1 ? 0 : (index / (roots.length - 1) * 2 - 1) * half)));
    const distance = Math.max(...roots.map((x, index) => Math.abs(targets[index] - x)));
    const height = Math.max(1, distance) + (config.breathingRoom ? 2 : 0);
    let previous = roots;
    for (let step = 1; step <= height; step += 1) {
      const row = new Array(width).fill(' ');
      const next = roots.map((x, index) => Math.round(x + (targets[index] - x) * step / height));
      next.forEach((x, index) => { row[x] = x === previous[index] ? '|' : x > previous[index] ? '\\' : '/'; });
      lines.push(row.join('').trimEnd());
      previous = next;
    }
    // Carry the stems through the lip and into the vessel.
    for (let row = 0; row < Math.min(4, body.length - 1); row += 1) {
      const left = body[row].findIndex((character) => character !== ' ');
      const right = body[row].findLastIndex((character) => character !== ' ');
      for (const x of targets) if (x > left && x < right) body[row][x] = '|';
    }
  }
  for (const row of body) lines.push(row.join('').trimEnd());

  if (config.stamp) {
    lines.push('');
    const signature = 'VASE64';
    const centred = Math.max(0, Math.floor((width - 1) / 2 - (signature.length - 1) / 2));
    lines.push(' '.repeat(centred) + signature);
  }
  return lines.join('\n');
}

/**
 * Pull the base64 back out of a vase.
 *
 * Blank lines, the vase outline, line-number gutters and the stamp are all
 * ignored. Bloom rows locate plants; their leaves and bottom stems recover
 * the six-bit values in display order.
 *
 * @param {string} vase
 * @returns {string} base64 (unpadded, as stored)
 */
export function vaseToBase64(vase) {
  if (typeof vase !== 'string') throw new TypeError('vaseToBase64 expects a string');
  const cleaned = tidyVase(vase);
  let base64 = '';
  for (const plant of splitPlants(cleaned)) {
    if (plant.value !== -1) base64 += BASE64_ALPHABET[plant.value];
  }
  return base64;
}

/** Drop a leading `12 | ` gutter when one is present. */
function stripGutter(line) {
  return line.replace(/^\s*\d+\s*[|│]\s?/, '');
}

/**
 * Prepare a pasted vase for reading: drop line numbers, trailing spaces and
 * blank lines.
 *
 * Runs of spaces are deliberately left alone. The art uses a three-space gap
 * *inside* every cell, which is indistinguishable from a stretched gap between
 * cells, so squeezing one would break the other. Whitespace that has been
 * doubled on its way here cannot be recovered, and the reader says so rather
 * than guessing.
 */
function tidyVase(vase) {
  const lines = String(vase)
    .split(/\r?\n/)
    .map((line) => stripGutter(line.replace(/\r$/, '')).replace(/\s+$/, ''));

  // Blank lines inside the garden would fall between a plant's bloom and the
  // stem three rows below it, cutting the plant in half. Blank lines after the
  // last plant are left alone - that is the gap before the vase.
  const lastPlanted = lines.reduce(
    (last, line, index) => (/[oO*@|:!']/.test(line) ? index : last),
    -1,
  );
  const kept = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === '' && index > lastPlanted) kept.push('');
    else if (line !== '') kept.push(line);
  }
  return kept.join('\n');
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
  const plants = splitPlants(tidyVase(vase ?? ''));
  let glyphs = 0;
  for (const plant of plants) {
    if (plant.value === -1) {
      problems.push({
        line: plant.row + 1,
        message: `could not read a 6-bit value from the plant at column ${plant.column + 1}`,
      });
    } else {
      glyphs += 1;
    }
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
