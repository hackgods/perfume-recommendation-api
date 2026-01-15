import dotenv from "dotenv";
import pg from "pg";
import crypto from "crypto";
import { pipeline } from "@xenova/transformers";

dotenv.config({ path: ".env" });

const { Client } = pg;

const MODEL_ID = "Xenova/all-MiniLM-L6-v2";
const STRUCT_DIMS = 128;
const TEXT_DIMS = 384;
const FINAL_DIMS = STRUCT_DIMS + TEXT_DIMS;

const BATCH = Number(process.argv.find(x => x.startsWith("--batch="))?.split("=")[1] || 50);
const LIMIT = Number(process.argv.find(x => x.startsWith("--limit="))?.split("=")[1] || 0);

function normToken(s) {
  return String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

// Simple stable hash -> [0, dims)
function hashToIndex(str, dims) {
  const h = crypto.createHash("sha1").update(str).digest();
  // use first 4 bytes as uint32
  const n = h.readUInt32BE(0);
  return n % dims;
}

function l2Normalize(vec) {
  let sum = 0;
  for (const x of vec) sum += x * x;
  const norm = Math.sqrt(sum) || 1;
  return vec.map(x => x / norm);
}

function addHashedFeature(vec, key, weight = 1) {
  const idx = hashToIndex(key, vec.length);
  vec[idx] += weight;
}

function familiesFrom(accords = [], notes = []) {
  const a = new Set(accords.map(normToken));
  const n = new Set(notes.map(normToken));
  const hasAny = (set, arr) => arr.some(x => set.has(x));

  const families = [];

  if (hasAny(a, [
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
  ])) families.push("family:fresh");
  if (hasAny(a, [
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
  ])) families.push("family:woody");
  if (hasAny(a, [
    "amber", "white amber", "black amber", "ambergris", "amberwood",
    "amber xtreme", "ambermax", "ambrofix", "ambrox", "ambroxan", "cetalox",
    "orcanox", "mystikal", "sclarene", "nympheal", "physcool",
    "benzoin", "siam benzoin", "labdanum", "olibanum", "opoponax",
    "elemi", "elemi resin", "frankincense", "incense",
    "resin", "resins", "tolu balsam", "peru balsam", "copaiba balm",
    "gurjan balsam", "styrax", "cistus incanus",
    "smoke", "oud smoke", "coal", "gunpowder", "tar", "birch tar", "cade oil"
  ])) families.push("family:amber");
  if (hasAny(a, [
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
    "fruity notes", "fruits", "dried fruits" // often used as gourmand framing
  ])) families.push("family:gourmand");
  if (hasAny(a, [
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
  ])) families.push("family:floral");
  if (hasAny(a, [
    "musk", "white musk", "natural musk", "ambrette", "ambrette (musk mallow)",
    "ambrettolide", "helvetolide", "serenolide", "sylkolide",
    "powdery notes", "soap", "cotton flower", "skin", "silk",
    "aldehydes"
  ])) families.push("family:musky");
  if (hasAny(a, [
    "spices", "spicy notes", "aromatic spices",
    "pepper", "black pepper", "white pepper", "pink pepper", "sichuan pepper",
    "timur", "paprika", "chili pepper", "pimento", "pimento seeds", "pimento leaf",
    "cinnamon", "ceylon cinnamon", "clove", "cloves", "cardamom", "cardamon",
    "nutmeg", "indonesian nutmeg", "caraway", "cumin", "fenugreek",
    "fennel", "anise", "star anise", "saffron", "ginger", "indian ginger",
    "nigerian ginger", "tarragon", "oregano", "thyme"
  ])) families.push("family:spicy");
  if (hasAny(a, [
    "apple", "pear", "peach", "apricot", "plum", "cherry", "sour cherry",
    "berry", "berries", "strawberry", "raspberry", "blueberry", "blackberry",
    "black currant", "blackcurrant", "currant", "pomegranate", "grapes",
    "mango", "banana", "kiwi", "lychee", "litchi", "nectarine", "papaya",
    "melon", "watermelon", "fig", "quince", "dates", "cranberry", "guava",
    "passionfruit", "pitahaya", "prickly pear", "nashi pear", "citrus"
  ])) families.push("family:fruity");
  if (hasAny(a, [
    "leather", "russian leather", "saffiano leather", "suede",
    "animal notes", "civet", "castoreum", "blood", "skin", "rubber"
  ])) families.push("family:leather");

  return families;
}

function clamp01(x) {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function buildStructuredVector(p) {
  const vec = new Array(STRUCT_DIMS).fill(0);

  const accords = p.accords || [];
  const notes = p.notes_all || [];

  // hashed categorical features
  for (const a of accords) addHashedFeature(vec, `accord:${normToken(a)}`, 1.0);
  for (const n of notes) addHashedFeature(vec, `note:${normToken(n)}`, 1.0);

  if (p.brand) addHashedFeature(vec, `brand:${normToken(p.brand)}`, 1.5);
  if (p.perfumer) addHashedFeature(vec, `perfumer:${normToken(p.perfumer)}`, 1.2);

  // families
  for (const f of familiesFrom(accords, notes)) addHashedFeature(vec, f, 2.0);

  // numeric signals (scaled into features)
  // year: map 1900..2026 roughly -> 0..1
  const year = Number(p.year);
  const yearScaled = clamp01((year - 1900) / (2026 - 1900));

  // rating: 0..5 -> 0..1
  const ratingScaled = clamp01(Number(p.rating) / 5);

  // votes: log scale, cap at 1 (tune as needed)
  const votes = Number(p.total_votes);
  const votesScaled = clamp01(Math.log10(Math.max(1, votes)) / 5); // 10^5 votes -> 1.0

  // inject numeric features as hashed keys with weights
  addHashedFeature(vec, "num:year", yearScaled * 2.0);
  addHashedFeature(vec, "num:rating", ratingScaled * 2.0);
  addHashedFeature(vec, "num:votes", votesScaled * 2.0);

  return l2Normalize(vec);
}

function buildTextForEmbedding(p) {
  const parts = [
    `Name: ${p.name}`,
    `Brand: ${p.brand}`,
    p.year ? `Year: ${p.year}` : "",
    p.perfumer ? `Perfumer: ${p.perfumer}` : "",
    p.accords?.length ? `Main accords: ${p.accords.join(", ")}` : "",
    p.notes_all?.length ? `Notes: ${p.notes_all.join(", ")}` : "",
    p.description ? `Description: ${p.description}` : "",
  ];
  return parts.filter(Boolean).join("\n");
}

function concatAndNormalize(structVec, textVec) {
  const v = new Array(FINAL_DIMS);
  for (let i = 0; i < STRUCT_DIMS; i++) v[i] = structVec[i] || 0;
  for (let i = 0; i < TEXT_DIMS; i++) v[STRUCT_DIMS + i] = textVec[i] || 0;
  return l2Normalize(v);
}

async function main() {
  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) throw new Error("Missing DATABASE_URL");

  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();

  const embedder = await pipeline("feature-extraction", MODEL_ID);

  const perfumes = await client.query(
    `
    SELECT id, name, brand, year, perfumer, accords, notes_all, description
    FROM perfumes
    ORDER BY id
    ${LIMIT > 0 ? "LIMIT " + LIMIT : ""}
    `
  );

  console.log(`Embedding ${perfumes.rows.length} perfumes using ${MODEL_ID}...`);

  const upsertSql = `
    INSERT INTO perfume_embeddings (perfume_id, vector, model)
    VALUES ($1, $2, $3)
    ON CONFLICT (perfume_id) DO UPDATE SET
      vector = EXCLUDED.vector,
      model = EXCLUDED.model,
      updated_at = now();
  `;

  let done = 0;

  for (let i = 0; i < perfumes.rows.length; i += BATCH) {
    const batch = perfumes.rows.slice(i, i + BATCH);

    for (const p of batch) {
      const structVec = buildStructuredVector(p);
      const text = buildTextForEmbedding(p);

      const out = await embedder(text, { pooling: "mean", normalize: true });
      const textVec = Array.from(out.data); // should be 384 floats

      if (textVec.length !== TEXT_DIMS) {
        throw new Error(`Unexpected embedding dims: got ${textVec.length}, expected ${TEXT_DIMS}`);
      }

      const finalVec = concatAndNormalize(structVec, textVec);

      // pgvector accepts array literal format: '[1,2,3]'
      const pgVector = `[${finalVec.join(",")}]`;

      await client.query(upsertSql, [
        p.id,
        pgVector,
        `${MODEL_ID} + structured${STRUCT_DIMS}`,
      ]);

      done++;
      if (done % 50 === 0) console.log(`Upserted vectors: ${done}`);
    }
  }

  await client.end();
  console.log(`Done. Total vectors upserted: ${done}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
