import { readFileSync } from "fs";
import { join } from "path";
import { pool } from "../pool";
import {
  getRecommendationWeights,
  getAdaptiveWeights,
} from "../../config/recommendationWeights";

export function loadSqlFile(filename: string): string {
  const filePath = join(__dirname, filename);
  return readFileSync(filePath, "utf-8");
}

export interface SimilarPerfumesResult {
  id: number;
  name: string;
  brand: string;
  year: number | null;
  description: string | null;
  perfumer: string | null;
  gender: string | null;
  accords: string[];
  notes_all: string[];
  final_score: number;
  signals: {
    sim: number;
    dna: number;
    ward: number;
    qual: number;
    perf: number;
  };
  why: {
    because_similar_to: number | null;
    shared_notes: string[];
    shared_accords: string[];
    wardrobe: Array<{ liked_id: number; co_count: number }>;
    performance: {
      longevity: number | null;
      longevity_votes: number | null;
      sillage: number | null;
      sillage_votes: number | null;
    } | null;
  };
}

export interface DnaCardResult {
  families: Array<{ name: string; weight: number }>;
  accords: Array<{ name: string; weight: number; percentage: number }>;
  notes: Array<{ name: string; weight: number; percentage: number }>;
}

export interface TasteFingerprintResult {
  summary: string;
  families: Array<{ name: string; percentage: number }>;
  accords: Array<{ name: string; percentage: number }>;
  notes: Array<{ name: string; percentage: number }>;
  missing: Array<{
    category: "family" | "accord" | "note";
    name: string;
    suggestion: string;
    perfumes: Array<{
      id: number;
      name: string;
      brand: string;
      image: string;
    }>;
  }>;
}

export async function getSimilarPerfumes(
  likedPerfumeIds: number[],
  limit: number,
  gender?: "male" | "female" | "unisex" | null
): Promise<SimilarPerfumesResult[]> {
  const sql = loadSqlFile("similar-perfumes.sql");

  // Check if manual weights are set (override adaptive behavior)
  const manualWeights = getRecommendationWeights();
  const useManualWeights =
    process.env.REC_WEIGHT_SIMILARITY ||
    process.env.REC_WEIGHT_DNA ||
    process.env.REC_WEIGHT_WARDROBE ||
    process.env.REC_WEIGHT_QUALITY ||
    process.env.REC_WEIGHT_PERFORMANCE;

  const client = await pool.connect();
  try {
    await client.query("SET ivfflat.probes = 10");

    let weights = manualWeights;

    // If not using manual weights, determine adaptive weights
    if (!useManualWeights) {
      // Check data availability
      const dataCheckQuery = `
        WITH
        liked AS (SELECT unnest($1::bigint[]) AS perfume_id),
        user_notes_total AS (
          SELECT COALESCE(SUM((elem->>'w')::float), 0) AS total
          FROM perfume_dna d
          JOIN liked l ON l.perfume_id = d.perfume_id
          CROSS JOIN LATERAL jsonb_array_elements(d.dna->'notes') elem
        ),
        user_accords_total AS (
          SELECT COALESCE(SUM((elem->>'w')::float), 0) AS total
          FROM perfume_dna d
          JOIN liked l ON l.perfume_id = d.perfume_id
          CROSS JOIN LATERAL jsonb_array_elements(d.dna->'accords') elem
        ),
        wardrobe_check AS (
          SELECT COUNT(DISTINCT w.perfume_id) AS liked_with_edges
          FROM perfume_wardrobe_edges w
          WHERE w.perfume_id = ANY($1::bigint[])
        )
        SELECT 
          COALESCE((SELECT total FROM user_notes_total), 0) + COALESCE((SELECT total FROM user_accords_total), 0) > 0 AS has_user_dna,
          COALESCE((SELECT liked_with_edges FROM wardrobe_check), 0) >= 2 AS has_wardrobe_data;
      `;

      const dataCheckResult = await client.query(dataCheckQuery, [likedPerfumeIds]);
      const { has_user_dna, has_wardrobe_data } = dataCheckResult.rows[0];

      // Get wardrobe coverage from a sample of candidates
      // We'll approximate this by checking if wardrobe edges exist for the top candidates
      const wardrobeCoverageQuery = `
        WITH
        liked AS (SELECT unnest($1::bigint[]) AS perfume_id),
        taste_vec AS (
          SELECT AVG(e.vector) AS v
          FROM perfume_embeddings e
          JOIN liked l ON l.perfume_id = e.perfume_id
        ),
        top_candidates AS (
          SELECT p.id
          FROM taste_vec tv
          JOIN perfume_embeddings e ON true
          JOIN perfumes p ON p.id = e.perfume_id
          WHERE p.id <> ALL($1::bigint[])
            AND ($2::text IS NULL OR p.gender = $2::text)
          ORDER BY e.vector <=> tv.v
          LIMIT 100
        ),
        candidates_with_wardrobe AS (
          SELECT COUNT(DISTINCT c.id) AS count_with_wardrobe
          FROM top_candidates c
          JOIN perfume_wardrobe_edges w ON w.related_perfume_id = c.id
            AND w.perfume_id = ANY($1::bigint[])
        )
        SELECT 
          COALESCE((SELECT count_with_wardrobe FROM candidates_with_wardrobe), 0)::float / 
          GREATEST((SELECT COUNT(*) FROM top_candidates), 1)::float AS wardrobe_coverage;
      `;

      const coverageResult = await client.query(wardrobeCoverageQuery, [
        likedPerfumeIds,
        gender || null,
      ]);
      const wardrobeCoverage = parseFloat(coverageResult.rows[0]?.wardrobe_coverage || "0");

      // Get adaptive weights based on data availability
      weights = getAdaptiveWeights(
        has_wardrobe_data,
        has_user_dna,
        wardrobeCoverage
      );
    }

    const result = await client.query<SimilarPerfumesResult>(sql, [
      likedPerfumeIds,
      limit,
      gender || null,
      weights.similarity,
      weights.dna,
      weights.wardrobe,
      weights.quality,
      weights.performance,
    ]);
    return result.rows;
  } finally {
    client.release();
  }
}

export async function getPerfumeDna(
  perfumeId: number
): Promise<DnaCardResult | null> {
  const sql = loadSqlFile("get-perfume-dna.sql");
  const result = await pool.query<DnaCardResult>(sql, [perfumeId]);

  if (result.rows.length === 0) {
    return null;
  }

  return result.rows[0];
}

export async function getUserFingerprint(
  likedPerfumeIds: number[]
): Promise<TasteFingerprintResult | null> {
  const sql = loadSqlFile("get-user-fingerprint.sql");
  const result = await pool.query<TasteFingerprintResult>(sql, [likedPerfumeIds]);

  if (result.rows.length === 0) {
    return null;
  }

  return result.rows[0];
}
