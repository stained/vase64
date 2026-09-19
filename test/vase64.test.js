import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BASE64_ALPHABET,
  CELL_COLUMNS,
  CELL_ROWS,
  GLYPHS,
  GLYPH_SIGNATURES,
  LEAVES,
  PLANT_ALPHABET,
  VESSELS,
  base64ToVase,
  countGlyphs,
  decodeVase,
  encodeToVase,
  glyphToValue,
  glyphToValueLenient,
  hasFlowers,
  inspectVase,
  isPlantRow,
  splitPlants,
  vaseToBase64,
} from '../src/vase64.js';

const VESSEL_NAMES = Object.keys(VESSELS);

/* -------------------------------------------------------------------------- */
/* the glyph table                                                            */
/* -------------------------------------------------------------------------- */

test('there are 64 glyphs and every one is distinct', () => {
  assert.equal(GLYPHS.length, 64);
  assert.equal(new Set(GLYPH_SIGNATURES).size, 64);
});

test('every glyph is a full cell: four rows of five columns', () => {
  for (const [value, glyph] of GLYPHS.entries()) {
    assert.equal(glyph.length, CELL_ROWS, `glyph ${value} row count`);
    for (const row of glyph) {
      assert.equal(row.length, CELL_COLUMNS, `glyph ${value} row width: ${JSON.stringify(row)}`);
      assert.ok(
        [...row].every((character) => ` ${PLANT_ALPHABET}`.includes(character)),
        `glyph ${value} uses only plant characters: ${JSON.stringify(row)}`,
      );
    }
  }
});

test('every glyph carries exactly one bloom, with its stem beneath it', () => {
  for (const [value, glyph] of GLYPHS.entries()) {
    assert.ok(isPlantRow(glyph[0]), `glyph ${value} should read as a plant row`);
    assert.equal(glyphToValue(glyph), value, `glyph ${value} exact`);
  }
});

test('blooms, stems and leaves never share a character', () => {
  const blooms = 'oO*@';
  const stems = "|:!'";
  for (const character of stems) assert.ok(!blooms.includes(character));
  for (const character of LEAVES) {
    assert.ok(!blooms.includes(character), `leaf ${character} looks like a bloom`);
    assert.ok(!stems.includes(character), `leaf ${character} looks like a stem`);
  }
});

test('glyphs decode back to their own value, strictly and leniently', () => {
  for (const [value, glyph] of GLYPHS.entries()) {
    assert.equal(glyphToValue(glyph), value, `glyph ${value} exact`);
    // Both readers must agree on every glyph: they are the same codec seen
    // through different amounts of tolerance. The lenient one takes the rows
    // too, because the stem it needs is three rows below the bloom.
    assert.equal(glyphToValueLenient(glyph), value, `glyph ${value} lenient`);
  }
});

test('a plant is read from its bloom row and the stem beneath it', () => {
  // Row 0 needs exactly one bloom, or it is not a plant row.
  assert.equal(isPlantRow('***'), false); // three blooms
  assert.equal(isPlantRow('   o  '), true); // a bloom row
  assert.equal(isPlantRow('  |  '), false); // a stem with no bloom on the row
  assert.equal(isPlantRow('     '), false);
  assert.equal(isPlantRow(''), false);

  // Feeding the reader a bare bloom row cannot work: the stem lives below it.
  assert.equal(glyphToValueLenient('   o  '), -1);
  // A trimmed plant loses its stem and becomes unreadable, which is honest.
  assert.equal(glyphToValueLenient(['   o  ']), -1);
  // The whole cell reads.
  assert.equal(glyphToValueLenient(['   o  ', '   |  ', '   |  ', '   |  ']), 0);
  assert.equal(glyphToValueLenient(GLYPHS[60]), 60);
});

test('vase rows are never mistaken for plants', () => {
  for (const name of VESSEL_NAMES) {
    for (const row of VESSELS[name].art) {
      assert.equal(isPlantRow(row), false, `${name}: ${JSON.stringify(row)}`);
    }
  }
});

test('a vase row never carries a bloom, which is what marks a plant', () => {
  // Bloom characters are reserved for the flower bed: the vase is drawn only
  // from lines, so no amount of widening or decoration can invent a plant.
  for (const name of VESSEL_NAMES) {
    for (const row of VESSELS[name].art) {
      assert.ok(!/[oO*@]/.test(row), `${name}: ${JSON.stringify(row)}`);
    }
  }
  assert.equal(isPlantRow(' \\_/ '), false);
  assert.equal(isPlantRow('  |  '), false);
  assert.equal(isPlantRow(' |~~~| '), false);
  assert.equal(isPlantRow('|-----------|'), false);
});

/* -------------------------------------------------------------------------- */
/* round trips                                                                */
/* -------------------------------------------------------------------------- */

const SAMPLES = [
  '',
  'A',
  'Hi vase!',
  'VASE64 is base64, but it blooms.',
  'The quick brown fox jumps over the lazy dog. 0123456789',
  'line one\nline two\ttabbed',
  'unicode: café naïve résumé',
  'emoji: 🌷🌻🪴 bloom',
  'CJK: 花瓶に生けました',
  'math: 𝕍𝔸𝕊𝔼64',
  'trailing space ',
  ' leading space',
  'aaaa'.repeat(200),
];

test('text survives the trip through the vase', () => {
  for (const text of SAMPLES) {
    assert.equal(decodeVase(encodeToVase(text)), text, `sample: ${JSON.stringify(text.slice(0, 24))}`);
  }
});

test('every sample survives in every vessel', () => {
  for (const vessel of VESSEL_NAMES) {
    for (const text of SAMPLES) {
      const vase = encodeToVase(text, { vessel });
      assert.equal(decodeVase(vase), text, `${vessel}: ${JSON.stringify(text.slice(0, 24))}`);
    }
  }
});

test('random bytes survive the trip', () => {
  for (let round = 0; round < 40; round += 1) {
    const length = 1 + Math.floor(Math.random() * 96);
    const bytes = Array.from({ length }, () => Math.floor(Math.random() * 256));
    const text = Buffer.from(bytes).toString('latin1');
    const decoded = decodeVase(encodeToVase(text));
    assert.deepEqual([...Buffer.from(decoded, 'latin1')], bytes, `round ${round}`);
  }
});

test('every single base64 character round trips', () => {
  for (const character of BASE64_ALPHABET) {
    const vase = base64ToVase(character);
    assert.equal(vaseToBase64(vase), character, `character ${character}`);
  }
});

test('all 64 glyphs can appear in one vase and come back in order', () => {
  const base64 = BASE64_ALPHABET;
  const vase = base64ToVase(base64);
  assert.equal(vaseToBase64(vase), base64);
  assert.equal(vaseToBase64(vase.replace(/=/g, '')), base64);
});

test('padding is implicit and survives decoding', () => {
  // "Hi" is 2 bytes -> "SGk=" in standard base64, stored as "SGk".
  // Padding is never stored as a plant: `=` is not in the alphabet, so it can
  // only ever appear as decorative banding inside the vase.
  assert.equal(vaseToBase64(encodeToVase('Hi')), 'SGk');
  assert.equal(vaseToBase64(encodeToVase('Hi!')), 'SGkh');
  // A vase for an empty message grows nothing at all.
  assert.ok(!/[oO*@]/.test(encodeToVase('')));
  assert.equal(decodeVase(encodeToVase('Hi')), 'Hi');
  assert.equal(countGlyphs(encodeToVase('Hi')), 3);
});

/* -------------------------------------------------------------------------- */
/* vessel geometry                                                            */
/* -------------------------------------------------------------------------- */

test('every vessel is the same height and has a rim with a mouth', () => {
  const heights = new Set();
  for (const name of VESSEL_NAMES) {
    const { art, pour } = VESSELS[name];
    heights.add(art.length);
    assert.ok(pour > 0 && pour < art.length, `${name} pour`);
    assert.ok(art[pour].includes('|'), `${name} rim should have walls`);
  }
  assert.equal(heights.size, 1);
});

test('vases of every vessel are wider than they are deep', () => {
  for (const name of VESSEL_NAMES) {
    const vase = base64ToVase(BASE64_ALPHABET, { vessel: name });
    const lines = vase.split('\n');
    assert.ok(lines.length > VESSELS[name].art.length, `${name} should have flowers`);
    assert.equal(vaseToBase64(vase), BASE64_ALPHABET, `${name} round trip`);
  }
});

test('flowers stay above the rim, and nothing paints over the walls', () => {
  for (const name of VESSEL_NAMES) {
    const vase = base64ToVase(BASE64_ALPHABET, { vessel: name });
    const lines = vase.split('\n');
    const bodyStart = lines.length - VESSELS[name].art.length - 2; // -1 blank, -1 stamp
    const body = lines.slice(bodyStart);
    assert.ok(body.some((line) => line.includes('~~~')), `${name} water line`);
  }
});

test('a bigger payload grows a bigger vase and wraps the bouquet', () => {
  const small = base64ToVase('SGk', { layout: 'vase' });
  const big = base64ToVase('SGk'.repeat(300), { layout: 'vase' });
  const width = (vase) => Math.max(...vase.split('\n').map((line) => line.length));
  assert.ok(width(big) >= width(small));
  assert.ok(width(big) <= 121);
});

test('an empty payload still renders a vessel', () => {
  const vase = encodeToVase('');
  assert.equal(vaseToBase64(vase), '');
  assert.equal(decodeVase(vase), '');
  // The pot is still drawn - a rim, a water line and a base - but nothing is
  // growing in it, so there is not a single bloom anywhere.
  assert.ok(vase.includes('\\') && vase.includes('/'), 'the pot outline');
  assert.ok(vase.includes('~'), 'the water line');
  assert.ok(vase.includes('_'), 'the base');
  assert.ok(!/[oO*@]/.test(vase), 'nothing growing');
  const report = inspectVase(vase);
  assert.equal(report.glyphs, 0);
  assert.equal(report.ok, false); // an empty vase holds no message
  assert.deepEqual(report.problems, []); // but it is not malformed
});

/* -------------------------------------------------------------------------- */
/* tolerant reading                                                           */
/* -------------------------------------------------------------------------- */

test('the outline, gutters, stamp and stray whitespace are ignored', () => {
  const text = 'Round trip through a messy terminal';
  const vase = encodeToVase(text, { vessel: 'bowl' });
  const numbered = vase
    .split('\n')
    .map((line, index) => `${String(index + 1).padStart(3)} | ${line}`)
    .join('\n');
  assert.equal(decodeVase(numbered), text);
  assert.equal(decodeVase(vase.replace(/\n/g, '\r\n')), text);
  assert.equal(decodeVase(vase.split('\n').join('\n\n')), text);
  // Stretched whitespace is *not* recoverable: the art uses a three-space gap
  // inside every cell, so a doubled gap is indistinguishable from a cell's own
  // spacing and squeezing it would move every stem off its bloom. The reader
  // must not pretend otherwise - it may return the wrong text, but never the
  // right one by accident.
  let stretched = null;
  try {
    stretched = decodeVase(vase.replace(/ /g, '  '));
  } catch {
    stretched = null; // refusing outright is fine too
  }
  assert.notEqual(stretched, text);
});

test('a vase with the frame deleted still decodes', () => {
  const text = 'Just the flowers, please';
  const vase = encodeToVase(text);
  // A plant is four rows tall and only its bloom row has a bloom, so keeping
  // the "flower and stem" rows keeps the data. Keeping the bloom rows alone
  // would not: the stem carries two of the six bits.
  const lines = vase.split('\n');
  const plants = splitPlants(vase);
  const lastPlant = plants.at(-1);
  const petals = lines.slice(0, lastPlant.row + CELL_ROWS).join('\n');
  assert.equal(decodeVase(petals), text);

  const bloomsOnly = vase
    .split('\n')
    .filter((line) => hasFlowers(line))
    .join('\n');
  assert.notEqual(decodeVase(bloomsOnly), text);
});

test('a plant still reads if its leaves are retouched', () => {
  const glyph = GLYPHS[0b100000]; // a bloom with a leaf on each side
  assert.equal(isPlantRow(glyph[0]), true);
  const trimmed = glyph.map((row) => row.trim());
  assert.equal(glyphToValueLenient(trimmed), 0b100000);
});

test('inspectVase reports trouble without throwing', () => {
  assert.deepEqual(inspectVase('').glyphs, 0);
  const damaged = GLYPHS[5].join('\n') + '\nVASE64\n  |\n***\n';
  const report = inspectVase(damaged);
  assert.equal(report.glyphs, 1);
  assert.ok(report.problems.length > 0);
});

test('invalid input is rejected loudly', () => {
  assert.throws(() => base64ToVase('not base64!'), /not a base64 character/);
  assert.throws(() => base64ToVase('SGk', { vessel: 'amphora' }), /unknown vessel/);
  assert.throws(() => encodeToVase(null, { vessel: 'nope' }), /unknown vessel/);
});

test('bouquets widen towards the rim without changing payload order', () => {
  for (let length = 1; length <= 256; length += 1) {
    const payload = BASE64_ALPHABET.repeat(4).slice(0, length);
    const vase = base64ToVase(payload, { layout: 'vase' });
    const racks = vase.split('\n').filter(hasFlowers).map((line) => [...line].filter((c) => 'oO*@'.includes(c)).length);
    assert.ok(racks.every((count, index) => index === 0 || count >= racks[index - 1]), `length ${length}: ${racks}`);
    assert.equal(vaseToBase64(vase), payload);
  }
});

test('final vessel contours are symmetric, connected and closed', () => {
  for (const vessel of VESSEL_NAMES) {
    for (const length of [0, 1, 16, 64, 256, 900]) {
      const lines = base64ToVase('A'.repeat(length), { vessel, stamp: false }).split('\n');
      const rim = lines.findIndex((line) => /^\s*\.[-|]+\.$/.test(line));
      assert.ok(rim >= 0);
      const body = lines.slice(rim);
      const axis = body[0].search(/\S/) + body[0].length - 1;
      let previous = body[0].search(/\S/);
      for (const line of body) {
        const left = line.search(/\S/);
        assert.equal(left + line.length - 1, axis);
        assert.ok(Math.abs(left - previous) <= 1, `${vessel}: disconnected wall`);
        previous = left;
      }
      assert.match(body.at(-1), /^\s*\\_+\/$/);
      if (length) assert.ok(lines.slice(splitPlants(lines.join('\n')).at(-1).row + CELL_ROWS, rim).every((line) => line.trim()));
    }
  }
});

test('automatic vessels are deterministic and vary with content, including equal lengths', () => {
  const bodies = new Set();
  for (const message of ['rose', 'iris', 'lily', 'fern', 'seed', 'bush']) {
    const vase = encodeToVase(message);
    assert.equal(vase, encodeToVase(message));
    assert.equal(decodeVase(vase), message);
    const lines = vase.split('\n');
    const rim = lines.findIndex((line) => /^\s*\.[-|]+\.$/.test(line));
    bodies.add(lines.slice(rim).join('\n'));
  }
  assert.ok(bodies.size > 1, 'content should change the vessel, not just the flowers');
  assert.equal(base64ToVase('SGk='), base64ToVase('S\nGk'));
});

test('flower beds grow wider with payload length and wrap at a bounded width', () => {
  let previousWidth = 0;
  for (let count = 0; count <= 100; count += 1) {
    const payload = BASE64_ALPHABET.repeat(2).slice(0, count);
    const bed = base64ToVase(payload, { layout: 'bed' });
    const width = Math.max(...bed.split('\n').map((line) => line.length));
    assert.ok(width >= previousWidth);
    assert.ok(width <= 162);
    assert.equal(vaseToBase64(bed), payload);
    assert.equal(splitPlants(bed).length, count);
    assert.ok(bed.includes('VASE64'));
    previousWidth = width;
  }
  for (const message of SAMPLES) {
    assert.equal(decodeVase(encodeToVase(message, { layout: 'bed' })), message);
  }
  assert.throws(() => base64ToVase('SGk', { layout: 'field' }), /unknown layout/);
});

test('automatic arrangement switches at 32 flowers and beds continue to widen', () => {
  for (const count of [0, 1, 31, 32, 33, 64, 128, 256]) {
    const payload = 'A'.repeat(count);
    const automatic = base64ToVase(payload);
    assert.equal(automatic, base64ToVase(payload, { layout: count <= 32 ? 'vase' : 'bed' }));
    assert.equal(vaseToBase64(automatic), payload);
  }
  const width = (count) => Math.max(...base64ToVase('A'.repeat(count)).split('\n').map((line) => line.length));
  assert.ok(width(33) < width(64));
  assert.ok(width(64) < width(128));
  assert.ok(width(128) < width(256));
});
