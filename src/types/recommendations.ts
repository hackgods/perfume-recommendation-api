export interface SimilarPerfumesRequest {
  liked_perfume_ids: number[];
  limit?: number;
  diversify_brand?: boolean;
  min_votes?: number;
  prefer_longlasting?: boolean;
  prefer_soft_projection?: boolean;
  gender?: "male" | "female" | "unisex";
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
  dna_card?: DnaCard;
}

export interface DnaCard {
  families: Array<{ name: string; weight: number }>; // top 3
  accords: Array<{ name: string; weight: number; percentage: number }>; // top 5
  notes: Array<{ name: string; weight: number; percentage: number }>; // top 5
}

export interface MissingSuggestionPerfume {
  id: number;
  name: string;
  brand: string;
  image: string;
}

export interface MissingSuggestion {
  category: "family" | "accord" | "note";
  name: string;
  suggestion: string;
  perfumes: MissingSuggestionPerfume[]; // 3 recommended perfumes for this category
}

export interface TasteFingerprint {
  summary: string; // dynamic template-based summary
  families: Array<{ name: string; percentage: number }>;
  accords: Array<{ name: string; percentage: number }>;
  notes: Array<{ name: string; percentage: number }>;
  missing: MissingSuggestion[]; // 2-3 suggestions
}

export interface SimilarPerfumesResponse {
  liked_count: number;
  results: RecommendationResult[];
  fingerprint?: TasteFingerprint;
}
