-- 00_init.sql
-- Creates core tables, constraints, and indexes for:
--  - perfumes (normalized metadata + notes/accords)
--  - perfume_embeddings (pgvector)
--  - perfume_dna (JSONB explainability)
--  - dna_vocab (stable picker vocabulary)

BEGIN;

-- Extensions
CREATE EXTENSION IF NOT EXISTS vector;

-- 1) Core: perfumes

CREATE TABLE IF NOT EXISTS perfumes (
  id           BIGINT PRIMARY KEY,
  name         TEXT NOT NULL,
  brand        TEXT NOT NULL,
  year         INT NULL,
  perfumer     TEXT NULL,

  -- rating out of 5
  rating       DOUBLE PRECISION NULL,
  total_votes  INT NULL,

  -- normalized gender
  gender       TEXT NULL,

  -- normalized arrays (lowercased, trimmed, deduped in ingestion)
  accords      TEXT[] NOT NULL DEFAULT '{}'::text[],
  notes_all    TEXT[] NOT NULL DEFAULT '{}'::text[],

  -- pyramid or linear notes stored as JSONB:
  -- { "top":[], "middle":[], "base":[], "all":[] }
  notes_json   JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- official description
  description  TEXT NULL,

  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Data quality constraints
ALTER TABLE perfumes
  ADD CONSTRAINT IF NOT EXISTS perfumes_name_nonempty
  CHECK (length(btrim(name)) > 0);

ALTER TABLE perfumes
  ADD CONSTRAINT IF NOT EXISTS perfumes_year_check
  CHECK (year IS NULL OR (year >= 1800 AND year <= 2100));

ALTER TABLE perfumes
  ADD CONSTRAINT IF NOT EXISTS perfumes_gender_check
  CHECK (gender IS NULL OR gender IN ('male', 'female', 'unisex'));

ALTER TABLE perfumes
  ADD CONSTRAINT IF NOT EXISTS perfumes_rating_check
  CHECK (rating IS NULL OR (rating >= 0 AND rating <= 5));

ALTER TABLE perfumes
  ADD CONSTRAINT IF NOT EXISTS perfumes_votes_check
  CHECK (total_votes IS NULL OR total_votes >= 0);

CREATE TABLE IF NOT EXISTS perfume_performance (
  perfume_id BIGINT PRIMARY KEY REFERENCES perfumes(id) ON DELETE CASCADE,

  scent_rating        DOUBLE PRECISION NULL, -- 0–10
  scent_votes         INT NULL,

  sillage_rating      DOUBLE PRECISION NULL, -- 0–10
  sillage_votes       INT NULL,

  longevity_rating    DOUBLE PRECISION NULL, -- 0–10
  longevity_votes     INT NULL,

  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for fast filtering/search
CREATE INDEX IF NOT EXISTS perfumes_brand_idx ON perfumes (brand);
CREATE INDEX IF NOT EXISTS perfumes_year_idx ON perfumes (year);

CREATE INDEX IF NOT EXISTS perfumes_notes_all_gin
  ON perfumes USING GIN (notes_all);

CREATE INDEX IF NOT EXISTS perfumes_accords_gin
  ON perfumes USING GIN (accords);

-- Keep notes_json queryable
CREATE INDEX IF NOT EXISTS perfumes_notes_json_gin
  ON perfumes USING GIN (notes_json);

-- 2) Embeddings: pgvector
-- Fused vector = concat(structured_projection, text_embedding)
-- Example dims used in scripts: 128 + 384 = 512
CREATE TABLE IF NOT EXISTS perfume_embeddings (
  perfume_id  BIGINT PRIMARY KEY REFERENCES perfumes(id) ON DELETE CASCADE,
  vector      vector(512) NOT NULL,
  model       TEXT NOT NULL DEFAULT 'Xenova/all-MiniLM-L6-v2 + structured128',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ivfflat index
CREATE INDEX IF NOT EXISTS perfume_embeddings_vector_idx
  ON perfume_embeddings
  USING ivfflat (vector vector_cosine_ops)
  WITH (lists = 100);

-- Sanity check helper:
-- SELECT COUNT(*) FROM perfume_embeddings WHERE vector_dims(vector) <> 512;

-- 3) Perfume DNA: explainability

CREATE TABLE IF NOT EXISTS perfume_dna (
  perfume_id  BIGINT PRIMARY KEY REFERENCES perfumes(id) ON DELETE CASCADE,
  dna         JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS perfume_dna_gin
  ON perfume_dna USING GIN (dna);

-- 4) DNA Vocabulary
CREATE TABLE IF NOT EXISTS dna_vocab (
  kind TEXT NOT NULL,   -- 'note' | 'accord'
  token TEXT NOT NULL,  -- normalized lowercase token
  freq INT NOT NULL,
  rank INT NOT NULL,
  PRIMARY KEY (kind, token)
);

CREATE INDEX IF NOT EXISTS dna_vocab_kind_rank_idx
  ON dna_vocab (kind, rank);

-- 5) Performance table constraints + indexes

ALTER TABLE perfume_performance
  ADD CONSTRAINT IF NOT EXISTS perfume_perf_scent_rating_check
  CHECK (scent_rating IS NULL OR (scent_rating >= 0 AND scent_rating <= 10));

ALTER TABLE perfume_performance
  ADD CONSTRAINT IF NOT EXISTS perfume_perf_sillage_rating_check
  CHECK (sillage_rating IS NULL OR (sillage_rating >= 0 AND sillage_rating <= 10));

ALTER TABLE perfume_performance
  ADD CONSTRAINT IF NOT EXISTS perfume_perf_longevity_rating_check
  CHECK (longevity_rating IS NULL OR (longevity_rating >= 0 AND longevity_rating <= 10));

ALTER TABLE perfume_performance
  ADD CONSTRAINT IF NOT EXISTS perfume_perf_votes_nonneg_check
  CHECK (
    (scent_votes IS NULL OR scent_votes >= 0) AND
    (sillage_votes IS NULL OR sillage_votes >= 0) AND
    (longevity_votes IS NULL OR longevity_votes >= 0)
  );

CREATE INDEX IF NOT EXISTS perfume_performance_perfume_id_idx
  ON perfume_performance (perfume_id);

-- 6) Array sanity constraints (avoid empty strings)

ALTER TABLE perfumes
  ADD CONSTRAINT IF NOT EXISTS perfumes_notes_all_no_empty
  CHECK (NOT EXISTS (
    SELECT 1 FROM unnest(notes_all) x WHERE length(btrim(x)) = 0
  ));

ALTER TABLE perfumes
  ADD CONSTRAINT IF NOT EXISTS perfumes_accords_no_empty
  CHECK (NOT EXISTS (
    SELECT 1 FROM unnest(accords) x WHERE length(btrim(x)) = 0
  ));


-- 7) updated_at triggers

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_perfumes_updated_at ON perfumes;
CREATE TRIGGER set_perfumes_updated_at
BEFORE UPDATE ON perfumes
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS set_perfume_embeddings_updated_at ON perfume_embeddings;
CREATE TRIGGER set_perfume_embeddings_updated_at
BEFORE UPDATE ON perfume_embeddings
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS set_perfume_dna_updated_at ON perfume_dna;
CREATE TRIGGER set_perfume_dna_updated_at
BEFORE UPDATE ON perfume_dna
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE FUNCTION set_perf_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_perfume_performance_updated_at ON perfume_performance;
CREATE TRIGGER set_perfume_performance_updated_at
BEFORE UPDATE ON perfume_performance
FOR EACH ROW EXECUTE FUNCTION set_perf_updated_at();

COMMIT;
