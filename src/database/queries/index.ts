import { readFileSync } from "fs";
import { join } from "path";
import { pool } from "../pool";

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

export async function getSimilarPerfumes(
  likedPerfumeIds: number[],
  limit: number,
  gender?: "male" | "female" | "unisex" | null
): Promise<SimilarPerfumesResult[]> {
  const sql = loadSqlFile("similar-perfumes.sql");

  const client = await pool.connect();
  try {
    await client.query("SET ivfflat.probes = 10");
    const result = await client.query<SimilarPerfumesResult>(sql, [
      likedPerfumeIds,
      limit,
      gender || null,
    ]);
    return result.rows;
  } finally {
    client.release();
  }
}
