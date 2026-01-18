/**
 * Recommendation Score Weights Configuration
 *
 * These weights control how the final recommendation score is calculated.
 * Weights are adaptive based on data availability to avoid penalizing missing signals.
 *
 * Important constraints:
 * - quality <= 0.10 (never let rating overpower taste)
 * - performance <= 0.05 (never let performance overpower taste)
 */

export interface RecommendationWeights {
  similarity: number; // Vector embedding similarity weight
  dna: number; // DNA overlap (notes/accords) weight
  wardrobe: number; // Wardrobe co-occurrence weight
  quality: number; // Rating quality weight (max 0.10)
  performance: number; // Performance metrics weight (max 0.05)
}

/**
 * Case A: Wardrobe is strong
 * Use when: At least 2 liked perfumes have wardrobe edges and candidates have ward01 > 0
 */
export const WEIGHTS_WARDROBE_STRONG: RecommendationWeights = {
  similarity: 0.4, // 40%
  dna: 0.15, // 15%
  wardrobe: 0.3, // 30%
  quality: 0.07, // 7%
  performance: 0.03, // 3%
};

/**
 * Case B: Wardrobe is weak or missing
 * Use when: ward01 = 0 for most candidates
 */
export const WEIGHTS_WARDROBE_WEAK: RecommendationWeights = {
  similarity: 0.6, // 60%
  dna: 0.25, // 25%
  wardrobe: 0.0, // 0%
  quality: 0.1, // 10% (max allowed)
  performance: 0.05, // 5% (max allowed)
};

/**
 * Case C: DNA missing or weak
 * Use when: User DNA total is 0 OR most candidates have no DNA
 */
export const WEIGHTS_DNA_WEAK: RecommendationWeights = {
  similarity: 0.65, // 65%
  dna: 0.0, // 0%
  wardrobe: 0.25, // 25%
  quality: 0.07, // 7%
  performance: 0.03, // 3%
};

/**
 * Default weights (Case A - Wardrobe Strong)
 * This is used as fallback and matches the strong wardrobe case
 */
export const DEFAULT_WEIGHTS: RecommendationWeights = WEIGHTS_WARDROBE_STRONG;

/**
 * Get recommendation weights from environment or use defaults
 *
 * Environment variables (optional) - overrides adaptive behavior:
 * - REC_WEIGHT_SIMILARITY
 * - REC_WEIGHT_DNA
 * - REC_WEIGHT_WARDROBE
 * - REC_WEIGHT_QUALITY (max 0.10)
 * - REC_WEIGHT_PERFORMANCE (max 0.05)
 */
export function getRecommendationWeights(): RecommendationWeights {
  // Check if weights are explicitly set via environment (manual override)
  if (
    process.env.REC_WEIGHT_SIMILARITY ||
    process.env.REC_WEIGHT_DNA ||
    process.env.REC_WEIGHT_WARDROBE ||
    process.env.REC_WEIGHT_QUALITY ||
    process.env.REC_WEIGHT_PERFORMANCE
  ) {
    const weights: RecommendationWeights = {
      similarity: parseFloat(
        process.env.REC_WEIGHT_SIMILARITY || String(DEFAULT_WEIGHTS.similarity)
      ),
      dna: parseFloat(
        process.env.REC_WEIGHT_DNA || String(DEFAULT_WEIGHTS.dna)
      ),
      wardrobe: parseFloat(
        process.env.REC_WEIGHT_WARDROBE || String(DEFAULT_WEIGHTS.wardrobe)
      ),
      quality: parseFloat(
        process.env.REC_WEIGHT_QUALITY || String(DEFAULT_WEIGHTS.quality)
      ),
      performance: parseFloat(
        process.env.REC_WEIGHT_PERFORMANCE ||
          String(DEFAULT_WEIGHTS.performance)
      ),
    };

    // Validate and enforce constraints
    for (const [key, value] of Object.entries(weights)) {
      if (isNaN(value) || value < 0) {
        console.warn(`Invalid weight for ${key}: ${value}, using default`);
        weights[key as keyof RecommendationWeights] =
          DEFAULT_WEIGHTS[key as keyof RecommendationWeights];
      }
    }

    // Enforce constraints: never let rating/performance overpower taste
    weights.quality = Math.min(weights.quality, 0.1);
    weights.performance = Math.min(weights.performance, 0.05);

    return weights;
  }

  // Return default (adaptive weights will be determined in the query)
  return DEFAULT_WEIGHTS;
}

/**
 * Determine which weight profile to use based on data availability
 *
 * @param hasWardrobeData - True if at least 2 liked perfumes have wardrobe edges
 * @param hasUserDna - True if user DNA totals > 0
 * @param wardrobeCoverage - Percentage of candidates with wardrobe data (0-1)
 *
 * @returns Appropriate weight profile
 */
export function getAdaptiveWeights(
  hasWardrobeData: boolean,
  hasUserDna: boolean,
  wardrobeCoverage: number
): RecommendationWeights {
  // Case C: DNA missing or weak
  if (!hasUserDna) {
    return WEIGHTS_DNA_WEAK;
  }

  // Case B: Wardrobe is weak or missing
  // If less than 50% of candidates have wardrobe data, consider it weak
  if (!hasWardrobeData || wardrobeCoverage < 0.5) {
    return WEIGHTS_WARDROBE_WEAK;
  }

  // Case A: Wardrobe is strong (default)
  return WEIGHTS_WARDROBE_STRONG;
}
