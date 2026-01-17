import { pool } from "../database/pool";
import { getSimilarPerfumes } from "../database/queries";
import {
  SimilarPerfumesRequest,
  SimilarPerfumesResponse,
  RecommendationResult,
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

  return {
    liked_count: perfumeIds.length,
    results,
  };
}
