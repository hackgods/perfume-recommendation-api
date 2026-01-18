import dotenv from "dotenv";
import pg from "pg";

dotenv.config({ path: ".env" });

const { Client } = pg;

const ACCORDS_TOP_M = 30;
const NOTES_TOP_N = 120;

function normToken(s) {
  return String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function decayWeight(rank, base = 0.85) {
  return Math.pow(base, Math.max(0, rank - 1));
}

function normalizeWeights(map) {
  // map: token -> weight
  let sum = 0;
  for (const w of map.values()) sum += w;
  if (!sum) return new Map();
  const out = new Map();
  for (const [k, w] of map.entries()) out.set(k, w / sum);
  return out;
}

function toArray(map) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([t, w]) => ({ t, w: Number(w.toFixed(6)) }));
}

// Define family indicators (accords/notes that signal each family)
const FAMILY_INDICATORS = {
  "family:fresh": {
    accords: [
      "citrus", "citruses", "bergamot", "lemon", "lime", "yuzu", "citron",
      "grapefruit", "pomelo", "mandarin", "tangerine", "orange", "clementine",
      "kumquat", "finger lime", "litsea cubeba", "verbena", "vervain",
      "petitgrain", "orange leaf", "orange peel",
      "aquatic", "aqual", "aquozone", "ozonic", "water notes", "watery notes",
      "sea notes", "sea water", "sea salt", "salt", "marine notes", "algae",
      "seaweed", "seagrass", "mineral notes", "rain notes", "steam accord",
      "dew drop", "ice",
      "green", "green notes", "green leaves", "grass", "green grass", "ivy",
      "herbal notes", "aromatic notes", "aromatic spices", "clary sage",
      "sage", "basil", "rosemary", "thyme", "mint", "spearmint", "peppermint",
      "eucalyptus", "juniper", "juniper berries", "bay leaf", "cypress",
      "cypress leaf", "mugane",
      "aldehydes", "evernyl"
    ],
    notes: []
  },
  "family:woody": {
    accords: [
      "woody", "woods", "woodsy notes", "precious woods", "blonde woods",
      "dry wood", "driftwood", "teak wood", "mahogany", "ebony", "ebony wood",
      "cedar", "cedarwood", "atlas cedar", "virginia cedar", "texas cedar",
      "chinese cedar", "himalayan cedar",
      "sandalwood", "guaiac wood", "palo santo", "hinoki wood",
      "amyris", "cashmeran", "cashmere wood", "amberwood", "georgywood",
      "belambra tree", "wolfwood", "akigalawood", "clearwood",
      "iso e super",
      "vetiver", "patchouli", "oak", "oakmoss", "moss", "papyrus", "paper",
      "cork", "sycamore", "forest fruits"
    ],
    notes: []
  },
  "family:amber": {
    accords: [
      "amber", "white amber", "black amber", "ambergris", "amberwood",
      "amber xtreme", "ambermax", "ambrofix", "ambrox", "ambroxan", "cetalox",
      "orcanox", "mystikal", "sclarene", "nympheal", "physcool",
      "benzoin", "siam benzoin", "labdanum", "olibanum", "opoponax",
      "elemi", "elemi resin", "frankincense", "incense",
      "resin", "resins", "tolu balsam", "peru balsam", "copaiba balm",
      "gurjan balsam", "styrax", "cistus incanus",
      "smoke", "oud smoke", "coal", "gunpowder", "tar", "birch tar", "cade oil"
    ],
    notes: []
  },
  "family:gourmand": {
    accords: [
      "sweet", "sweet notes", "sugar", "brown sugar", "burnt sugar", "sugar cane",
      "caramel", "toffee", "praline", "cotton candy", "marshmallow", "marshamallow",
      "bubble gum", "coca-cola", "tonic water",
      "vanilla", "ethylvanillin", "coumarin", "tonka", "tonka bean",
      "chocolate", "dark chocolate", "cocoa", "cacao", "cacao butter", "milk chocolate",
      "coffee", "espresso", "mocha", "cappuccino",
      "milk", "condensed milk", "almond milk", "soy milk", "custard",
      "butter", "buttercream", "ice cream", "kulfi",
      "cake", "cupcake", "cookie", "biscuit", "cone waffle", "madeleine",
      "creme brulee", "panacotta", "meringue", "puff pastry", "bread",
      "chestnut", "hazelnut", "pistachio", "walnut", "sesame",
      "liquor", "rum", "whiskey", "bourbon whiskey", "brandy", "cognac",
      "champagne", "beer", "ale", "amaretto", "aperol",
      "candied", "dragée", "jellybean", "gummy candies", "popcorn",
      "fruity notes", "fruits", "dried fruits"
    ],
    notes: []
  },
  "family:floral": {
    accords: [
      "floral", "flowers", "floral notes", "floral bouquet", "exotic floral notes",
      "rose", "damask rose", "bulgarian rose", "turkish rose", "taif rose",
      "grasse rose", "rose de mai", "may rose", "tea rose", "rose water",
      "jasmine", "jasmine sambac", "egyptian jasmine", "indian jasmine",
      "orange blossom", "neroli", "tuberose", "ylang ylang", "tiare flower",
      "gardenia", "magnolia", "lily", "lily of the valley", "hyacinth",
      "freesia", "peony", "violet", "parma violet", "iris", "orris", "orris root",
      "osmanthus", "narcissus", "mimosa", "honeysuckle", "frangipani",
      "lotus", "water lily", "orchid", "black orchid", "white orchid",
      "chrysanthemum", "carnation", "calla lily", "camelia", "blue lotus",
      "poppy", "red poppy", "amaryllis", "bellflower", "bluebell",
      "wisteria", "hibiscus", "rangoon creeper", "mock orange",
      "almond blossom", "apple blossom", "peach blossom", "pear blossom",
      "mango blossom", "olive blossom", "coconut blossom", "silk tree blossom"
    ],
    notes: []
  },
  "family:musky": {
    accords: [
      "musk", "white musk", "natural musk", "ambrette", "ambrette (musk mallow)",
      "ambrettolide", "helvetolide", "serenolide", "sylkolide",
      "powdery notes", "soap", "cotton flower", "skin", "silk",
      "aldehydes"
    ],
    notes: []
  },
  "family:spicy": {
    accords: [
      "spices", "spicy notes", "aromatic spices",
      "pepper", "black pepper", "white pepper", "pink pepper", "sichuan pepper",
      "timur", "paprika", "chili pepper", "pimento", "pimento seeds", "pimento leaf",
      "cinnamon", "ceylon cinnamon", "clove", "cloves", "cardamom", "cardamon",
      "nutmeg", "indonesian nutmeg", "caraway", "cumin", "fenugreek",
      "fennel", "anise", "star anise", "saffron", "ginger", "indian ginger",
      "nigerian ginger", "tarragon", "oregano", "thyme"
    ],
    notes: []
  },
  "family:fruity": {
    accords: [],
    notes: [
      "apple", "pear", "peach", "apricot", "plum", "cherry", "sour cherry",
      "berry", "berries", "strawberry", "raspberry", "blueberry", "blackberry",
      "black currant", "blackcurrant", "currant", "pomegranate", "grapes",
      "mango", "banana", "kiwi", "lychee", "litchi", "nectarine", "papaya",
      "melon", "watermelon", "fig", "quince", "dates", "cranberry", "guava",
      "passionfruit", "pitahaya", "prickly pear", "nashi pear", "citrus"
    ]
  },
  "family:leather": {
    accords: [
      "leather", "russian leather", "saffiano leather", "suede",
      "animal notes", "civet", "castoreum", "blood", "skin", "rubber"
    ],
    notes: []
  }
};

// Normalize all family indicators
for (const [family, indicators] of Object.entries(FAMILY_INDICATORS)) {
  FAMILY_INDICATORS[family].accords = new Set(indicators.accords.map(normToken));
  FAMILY_INDICATORS[family].notes = new Set(indicators.notes.map(normToken));
}

function buildFamilyWeights(accordsW, notesW) {
  // accordsW: Map<token, weight>
  // notesW: Map<token, weight>
  const familyWeights = new Map();

  for (const [family, indicators] of Object.entries(FAMILY_INDICATORS)) {
    let weight = 0;

    // Sum weights from matching accords
    for (const [accord, accordWeight] of accordsW.entries()) {
      if (indicators.accords.has(normToken(accord))) {
        weight += accordWeight;
      }
    }

    // Sum weights from matching notes
    for (const [note, noteWeight] of notesW.entries()) {
      if (indicators.notes.has(normToken(note))) {
        weight += noteWeight;
      }
    }

    // Only include families with non-zero weight
    if (weight > 0) {
      familyWeights.set(family, weight);
    }
  }

  // Normalize family weights
  return normalizeWeights(familyWeights);
}

function buildAccordWeights(accords, allowedAccordsSet) {
  const map = new Map();
  let rank = 1;
  for (const raw of accords || []) {
    const t = normToken(raw);
    if (!t || !allowedAccordsSet.has(t)) { rank++; continue; }
    const w = decayWeight(rank, 0.85);
    // keep max if duplicates
    map.set(t, Math.max(map.get(t) || 0, w));
    rank++;
  }
  return normalizeWeights(map);
}

function buildNoteWeights(notesJson, notesAll, allowedNotesSet) {
  const top = (notesJson?.top || []).map(normToken);
  const mid = (notesJson?.middle || []).map(normToken);
  const base = (notesJson?.base || []).map(normToken);
  const all = (notesJson?.all || []).map(normToken);

  const hasPyramid = top.length || mid.length || base.length;

  const map = new Map();

  const add = (arr, w) => {
    for (const t of arr) {
      if (!t || !allowedNotesSet.has(t)) continue;
      map.set(t, Math.max(map.get(t) || 0, w));
    }
  };

  if (hasPyramid) {
    add(top, 1.0);
    add(mid, 0.75);
    add(base, 0.6);

    // if pyramid exists, still allow `all` as fallback for missing notes
    add(all, 0.65);
  } else {
    // linear structure
    add(all.length ? all : (notesAll || []).map(normToken), 0.7);
  }

  return normalizeWeights(map);
}

async function main() {
  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) throw new Error("Missing DATABASE_URL");

  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();

  const topAccords = await client.query(
    `
    SELECT a AS token, COUNT(*) AS freq
    FROM perfumes, unnest(accords) a
    GROUP BY a
    ORDER BY freq DESC
    LIMIT $1
    `,
    [ACCORDS_TOP_M]
  );

  const topNotes = await client.query(
    `
    SELECT n AS token, COUNT(*) AS freq
    FROM perfumes, unnest(notes_all) n
    GROUP BY n
    ORDER BY freq DESC
    LIMIT $1
    `,
    [NOTES_TOP_N]
  );

  const allowedAccords = new Set(topAccords.rows.map(r => normToken(r.token)));
  const allowedNotes = new Set(topNotes.rows.map(r => normToken(r.token)));

  await client.query("BEGIN");
  await client.query("DELETE FROM dna_vocab");
  let rank = 1;
  for (const r of topAccords.rows) {
    await client.query(
      `INSERT INTO dna_vocab(kind, token, freq, rank) VALUES ('accord', $1, $2, $3)`,
      [normToken(r.token), Number(r.freq), rank++]
    );
  }
  rank = 1;
  for (const r of topNotes.rows) {
    await client.query(
      `INSERT INTO dna_vocab(kind, token, freq, rank) VALUES ('note', $1, $2, $3)`,
      [normToken(r.token), Number(r.freq), rank++]
    );
  }
  await client.query("COMMIT");

  const perfumes = await client.query(
    `SELECT id, brand, year, accords, notes_json, notes_all
     FROM perfumes
     ORDER BY id`
  );

  const upsert = `
    INSERT INTO perfume_dna (perfume_id, dna)
    VALUES ($1, $2)
    ON CONFLICT (perfume_id) DO UPDATE SET
      dna = EXCLUDED.dna,
      updated_at = now();
  `;

  let count = 0;
  for (const p of perfumes.rows) {
    const accordsW = buildAccordWeights(p.accords, allowedAccords);
    const notesW = buildNoteWeights(p.notes_json, p.notes_all, allowedNotes);
    const familiesW = buildFamilyWeights(accordsW, notesW);

    const dna = {
      accords: toArray(accordsW),
      notes: toArray(notesW),
      families: toArray(familiesW),
      meta: {
        year: p.year ?? null,
        brand: p.brand ?? null,
      },
      vocab: { accords_top_m: ACCORDS_TOP_M, notes_top_n: NOTES_TOP_N },
    };

    await client.query(upsert, [p.id, JSON.stringify(dna)]);
    count++;
    if (count % 200 === 0) console.log(`Generated DNA for ${count} perfumes...`);
  }

  await client.end();
  console.log(`Done. DNA generated for ${count} perfumes.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
