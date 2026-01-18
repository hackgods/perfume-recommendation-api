import { pool } from "../database/pool";
import {
  getSimilarPerfumes,
  getPerfumeDna,
  getUserFingerprint,
  findClones,
  CloneFinderResult,
} from "../database/queries";
import {
  SimilarPerfumesRequest,
  SimilarPerfumesResponse,
  RecommendationResult,
  DnaCard,
  TasteFingerprint,
} from "../types/recommendations";
import { NotFoundError, ValidationError } from "../lib/errorHandler";

export async function getSimilarPerfumesRecommendations(
  request: SimilarPerfumesRequest,
  requestId?: string
): Promise<SimilarPerfumesResponse> {
  const { liked_perfume_ids, limit = 10, gender } = request;

  if (liked_perfume_ids.length === 0) {
    throw new ValidationError("At least one liked perfume ID is required", requestId);
  }

  if (liked_perfume_ids.length > 10) {
    throw new ValidationError("Maximum 10 liked perfumes allowed", requestId);
  }

  const validLimit = Math.min(Math.max(1, limit), 20);

  const uniqueIds = [...new Set(liked_perfume_ids)];
  if (uniqueIds.length !== liked_perfume_ids.length) {
    throw new ValidationError("Duplicate perfume IDs are not allowed", requestId);
  }

  const perfumeIds = uniqueIds.map((id) => Number(id));
  if (perfumeIds.some((id) => !Number.isInteger(id) || id <= 0)) {
    throw new ValidationError("All perfume IDs must be positive integers", requestId);
  }

  const checkQuery = `
    SELECT id FROM perfumes WHERE id = ANY($1::bigint[])
  `;
  const checkResult = await pool.query(checkQuery, [perfumeIds]);

  if (checkResult.rows.length !== perfumeIds.length) {
    const foundIds = new Set(checkResult.rows.map((r: { id: number }) => r.id));
    const missingIds = perfumeIds.filter((id) => !foundIds.has(id));
    throw new NotFoundError(
      `Perfume IDs not found: ${missingIds.join(", ")}`,
      requestId
    );
  }

  const embeddingCheckQuery = `
    SELECT perfume_id FROM perfume_embeddings WHERE perfume_id = ANY($1::bigint[])
  `;
  const embeddingResult = await pool.query(embeddingCheckQuery, [perfumeIds]);

  if (embeddingResult.rows.length !== perfumeIds.length) {
    const foundIds = new Set(embeddingResult.rows.map((r: { perfume_id: number }) => r.perfume_id));
    const missingIds = perfumeIds.filter((id) => !foundIds.has(id));
    throw new NotFoundError(
      `Embeddings not found for perfume IDs: ${missingIds.join(", ")}`,
      requestId
    );
  }

  const dbResults = await getSimilarPerfumes(perfumeIds, validLimit, gender);

  const results: RecommendationResult[] = dbResults.map((row) => ({
    id: row.id,
    name: row.name,
    brand: row.brand,
    year: row.year,
    description: row.description || null,
    perfumer: row.perfumer || null,
    gender: row.gender || null,
    accords: Array.isArray(row.accords) ? row.accords : [],
    notes: Array.isArray(row.notes_all) ? row.notes_all : [],
    image: `https://fimgs.net/mdimg/perfume-thumbs/375x500.${row.id}.2x.avif`,
    score: Math.round(row.final_score * 1000) / 1000,
    signals: {
      sim: Math.round(row.signals.sim * 1000) / 1000,
      dna: Math.round(row.signals.dna * 1000) / 1000,
      ward: Math.round(row.signals.ward * 1000) / 1000,
      qual: Math.round(row.signals.qual * 1000) / 1000,
      perf: Math.round(row.signals.perf * 1000) / 1000,
    },
    why: {
      because_similar_to: row.why.because_similar_to,
      shared_notes: Array.isArray(row.why.shared_notes)
        ? row.why.shared_notes
        : [],
      shared_accords: Array.isArray(row.why.shared_accords)
        ? row.why.shared_accords
        : [],
      wardrobe: Array.isArray(row.why.wardrobe) ? row.why.wardrobe : [],
      performance: row.why.performance,
    },
  }));

  // Fetch DNA cards for each recommendation
  const resultsWithDna: RecommendationResult[] = await Promise.all(
    results.map(async (result) => {
      const dnaCard = await getPerfumeDnaCard(result.id);
      return {
        ...result,
        dna_card: dnaCard || undefined,
      };
    })
  );

  // Fetch user taste fingerprint
  const fingerprint = await getUserTasteFingerprint(perfumeIds);

  return {
    liked_count: perfumeIds.length,
    results: resultsWithDna,
    fingerprint: fingerprint || undefined,
  };
}

export async function getPerfumeDnaCard(
  perfumeId: number
): Promise<DnaCard | null> {
  const dbResult = await getPerfumeDna(perfumeId);
  if (!dbResult) {
    return null;
  }

  return {
    families: dbResult.families || [],
    accords: dbResult.accords || [],
    notes: dbResult.notes || [],
  };
}

export function generateTasteSummary(fingerprint: TasteFingerprint): string {
  const topFamilies = fingerprint.families
    .filter((f) => f.percentage > 0)
    .slice(0, 2)
    .map((f) => f.name.toLowerCase());

  const topNotes = fingerprint.notes
    .filter((n) => n.percentage > 0)
    .slice(0, 2)
    .map((n) => n.name.toLowerCase());

  if (topFamilies.length === 0 && topNotes.length === 0) {
    return "Your taste profile is still developing.";
  }

  // Get descriptor based on dominant family
  const dominantFamily = fingerprint.families[0]?.name.toLowerCase() || "";
  let descriptor = "";
  if (dominantFamily.includes("gourmand") || dominantFamily.includes("sweet")) {
    descriptor = "warm and cozy";
  } else if (dominantFamily.includes("fresh") || dominantFamily.includes("citrus")) {
    descriptor = "fresh and clean";
  } else if (dominantFamily.includes("woody")) {
    descriptor = "earthy and sophisticated";
  } else if (dominantFamily.includes("amber") || dominantFamily.includes("resin")) {
    descriptor = "warm and resinous";
  } else if (dominantFamily.includes("floral")) {
    descriptor = "elegant and romantic";
  } else if (dominantFamily.includes("spicy")) {
    descriptor = "bold and aromatic";
  } else if (dominantFamily.includes("fruity")) {
    descriptor = "vibrant and playful";
  } else if (dominantFamily.includes("musky")) {
    descriptor = "sensual and animalic";
  } else {
    descriptor = "unique and distinctive";
  }

  // Ensure we have at least 2 families and 2 notes for templates
  const family1 = topFamilies[0] || "fragrant";
  const family2 = topFamilies[1] || topFamilies[0] || "fragrant";
  const note1 = topNotes[0] || "notes";
  const note2 = topNotes[1] || topNotes[0] || "notes";

  // Select a random template (1-10) based on hash of user data for consistency
  // Using a simple hash of families to ensure same user gets same template
  const templateHash = (family1 + family2).split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const templateIndex = (templateHash % 10) + 1;

  const templates = [
    // Template 1: Warm & Confident (daily default)
    `You're drawn to ${family1} and ${family2} scents, especially ones built around ${note1} and ${note2}. Your taste leans ${descriptor}.`,
    
    // Template 2: Personality-Based
    `Your fragrance taste is very ${descriptor}. You gravitate toward ${family1}/${family2} styles with touches of ${note1} and ${note2}.`,
    
    // Template 3: Vibe-Oriented
    `Your vibe is ${descriptor}. You clearly love ${family1} and ${family2} scents with a strong hit of ${note1} and ${note2}.`,
    
    // Template 4: Time & Occasion Framing
    `You seem to prefer ${descriptor} fragrances. ${family1.charAt(0).toUpperCase() + family1.slice(1)} and ${family2} dominate your taste, especially when ${note1} and ${note2} are involved.`,
    
    // Template 5: Compliment-First
    `You have a strong taste for ${family1} and ${family2} fragrances. Notes like ${note1} and ${note2} show up a lot in what you love.`,
    
    // Template 6: Storytelling
    `Your collection tells a clear story: ${family1} and ${family2} at the core, layered with ${note1} and ${note2}. Overall, it feels very ${descriptor}.`,
    
    // Template 7: Discovery-Oriented
    `You consistently enjoy ${family1} and ${family2} profiles. When ${note1} or ${note2} appear, they usually win you over.`,
    
    // Template 8: Casual & Friendly
    `Looks like you're really into ${family1} and ${family2} scents. Anything with ${note1} and ${note2} fits your taste perfectly.`,
    
    // Template 9: Signature Fragrance Framing
    `Your signature style sits around ${family1} and ${family2}, with ${note1} and ${note2} doing most of the heavy lifting.`,
    
    // Template 10: Emotional & Sensory
    `You're drawn to ${descriptor} scents that live in the ${family1}/${family2} space, especially when you smell ${note1} or ${note2}.`,
  ];

  return templates[templateIndex - 1] || templates[0];
}

export async function getUserTasteFingerprint(
  likedPerfumeIds: number[]
): Promise<TasteFingerprint | null> {
  const dbResult = await getUserFingerprint(likedPerfumeIds);
  if (!dbResult) {
    return null;
  }

  const fingerprint: TasteFingerprint = {
    summary: "",
    families: dbResult.families || [],
    accords: dbResult.accords || [],
    notes: dbResult.notes || [],
    missing: dbResult.missing || [],
  };

  // Generate summary
  fingerprint.summary = generateTasteSummary(fingerprint);

  return fingerprint;
}

export async function findPerfumeClones(
  targetPerfumeId: number,
  limit: number = 3
): Promise<CloneFinderResult[]> {
  // Validate perfume exists
  const checkResult = await pool.query("SELECT id, name FROM perfumes WHERE id = $1", [
    targetPerfumeId,
  ]);

  if (checkResult.rows.length === 0) {
    throw new NotFoundError(`Perfume with ID ${targetPerfumeId} not found`);
  }

  // Find clones
  const clones = await findClones(targetPerfumeId, limit);

  // Add image URLs
  return clones.map((clone) => ({
    ...clone,
    image: `https://fimgs.net/mdimg/perfume-thumbs/375x500.${clone.id}.2x.avif`,
  }));
}
