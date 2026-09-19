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

/**
 * A plant is a cell six columns wide and four rows tall:
 *
 *      row 0   the bloom, with a leaf on each side     <- carries the value
 *      row 1   foliage
 *      row 2   a node, where the branches meet
 *      row 3   the stem, rooted in the vase
 *
 * The bloom sits in the middle of the cell and the stem directly under it, so
 * plants in adjacent cells never overlap and a bloom is always the only bloom
 * anywhere near its own column.
 */
export const CELL_COLUMNS = 5;
export const CELL_ROWS = 4;
/** Columns the bloom row is drawn across, leaving a gap between plants. */
const CELL_CONTENT = 5;

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

/**
 * The two rows under the bloom, indexed by stem style: a node where the
 * branches meet, then the foliage hanging off it. Both are six columns wide
 * with the stem's own column blank, because the stem is written in afterwards
 * - that is what keeps it lined up with the bloom two rows above.
 */
/** The column of a cell the stem is drawn in, from the bloom to the root. */
const STEM_COLUMN = 2;
/**
 * The two rows between the bloom and the root, indexed by stem style: a node
 * where the branches meet, then the foliage hanging off it. Each is a six
 * column pattern with column 3 left blank, because the stem is stamped into
 * that column afterwards so it lines up with the bloom above.
 */
const STEM_DECORATION = [
  { node: '  |  ', foliage: '  |  ' },
  { node: ' --+ ', foliage: ' --!-' },
  { node: '  :  ', foliage: '  :  ' },
  { node: "  '  ", foliage: "  '  " },
];

/**
 * Every character a plant may contain. The vase is drawn only from lines
 * (`|` `\\` `/` `_`), so a row with a bloom and a stem is a plant row and
 * anything else in it is foliage. Blooms and stems never overlap, which is what
 * makes a row readable at all.
 */
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
 * writing into a fixed array rather than by counting spaces in a template:
 *
 *      row 0   /  |  o  |              bloom row, carries the value
 *      row 1   /     \             the leaves, wider than the bloom
 *      row 2      --+--                a node where the branches meet
 *      row 3      |                    the stem, rooted in the vase
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
 * case newlines separate the rows. Only the first row and the stem row are
 * consulted, because those are the two the writer controls.
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
 * Recover a value from a plant whose decoration has been retouched or whose
 * lower rows were trimmed away.
 *
 * Blooms carry bits 4-5 and are unique per glyph; the stem carries bits 2-3 and
 * stands directly underneath the bloom, so it survives a trimmed vine. Leaves
 * are decoration and only have to be present enough to read bits 0-1.
 *
 * @returns {number} 0-63, or -1 when no bloom / stem can be found.
 */
export function glyphToValueLenient(cell) {
  const rows = Array.isArray(cell) ? cell : String(cell).split('\n');
  const bloomRow = rows[0] ?? '';
  const stemRow = rows[CELL_ROWS - 1] ?? '';

  // Exactly one bloom, and the same stem character on both sides of it.
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
  /** One plant plus a column of elbow room. */
  min: CELL_COLUMNS + 2,
  /** Where a short message stops growing the vase. */
  default: 25,
  /** Hard ceiling, in columns, for the whole garden. */
  max: 121,
  /** How much wider the garden gets for each extra rack of plants. */
  perRack: 4,
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
    const columns = Math.max(2, Math.round(capacity * hump));
    racks_.push(columns);
    total += columns;
  }
  return { bedWidth, racks: racks_, capacity: total };
}

/**
 * Fit `count` plants into the smallest dome that will hold them, and hand back
 * the racks to draw. Only the racks that ended up in use are returned, and the
 * last one is trimmed to the plants that are left.
 */
function planGarden(count) {
  if (count === 0) return { bedWidth: BED.min, racks: [] };
  for (let racks = 1; racks <= BED.maxRacks; racks += 1) {
    const plan = gardenPlan(racks);
    if (plan.capacity < count) continue;
    const used = [];
    let planted = 0;
    for (const columns of plan.racks) {
      if (planted >= count) break;
      const take = Math.min(columns, count - planted);
      used.push(take);
      planted += take;
    }
    return { bedWidth: plan.bedWidth, racks: used };
  }
  // Long past the point of being readable as a garden: full-width racks keep it
  // lossless even if it stops looking like a bouquet.
  const capacity = Math.max(1, Math.floor(BED.max / CELL_COLUMNS));
  const racks = new Array(Math.ceil(count / capacity)).fill(capacity);
  return { bedWidth: BED.max, racks };
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

  // The garden is a stack of racks. Each rack is one plant tall and holds as
  // many plants as it is wide, and the racks get narrower towards the top so
  // the bouquet finishes in a dome rather than a flat-topped slab. The reading
  // order stays row-major - left to right, bottom rack to top - which is what
  // keeps the decode unambiguous however the silhouette moves.
  const plan = planGarden(values.length);
  const bedWidth = plan.bedWidth;
  const width = bedWidth + 2;
  // The garden is centred on the vase's axis as a whole block, not row by row:
  // a grid only lines up if every row starts in the same column. Flooring the
  // half-column keeps an even-width grid and an oddly wide vase on the
  // identical centre column.
  const leftPad = Math.max(0, Math.floor((width - 1) / 2 - (bedWidth - 1) / 2));
  const place = (content) => ' '.repeat(leftPad) + content;

  const lines = [];
  let planted = 0;
  for (const columns of plan.racks) {
    const slice = values.slice(planted, planted + columns);
    planted += slice.length;
    const rackWidth = columns * CELL_COLUMNS;
    // A narrow rack is centred in the bed, which is what rounds the top.
    const inset = Math.floor((bedWidth - rackWidth) / 2);
    for (let cellRow = 0; cellRow < CELL_ROWS; cellRow += 1) {
      const across = slice.map((value) => GLYPHS[value][cellRow]).join('');
      lines.push(place(' '.repeat(inset) + across).trimEnd());
    }
  }

  if (config.breathingRoom && values.length > 0) lines.push('');

  // buildVaseRow aligns each row on the axis itself, so nothing is padded
  // twice. The stamp is what gives the canvas its margin, so a wide vase that
  // fills the stage still sits clear of the floating panel.
  for (const row of rows) lines.push(buildVaseRow(row, width, natural).trimEnd());

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
 * ignored; only the bloom rows contribute data, and each row may hold many
 * plants.
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
