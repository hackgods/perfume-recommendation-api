export interface SimilarPerfumesRequest {
  liked_perfume_ids: number[];
  limit?: number;
  diversify_brand?: boolean;
  min_votes?: number;
  prefer_longlasting?: boolean;
  prefer_soft_projection?: boolean;
}

export interface RecommendationSignals {
  sim: number;
  dna: number;
  ward: number;
  qual: number;
  perf: number;
}

export interface RecommendationWhy {
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
}

export interface RecommendationResult {
  id: number;
  name: string;
  brand: string;
  year: number | null;
  description: string | null;
  perfumer: string | null;
  gender: string | null;
  accords: string[];
  notes: string[];
  image: string;
  score: number;
  signals: RecommendationSignals;
  why: RecommendationWhy;
}

export interface SimilarPerfumesResponse {
  liked_count: number;
  results: RecommendationResult[];
}
