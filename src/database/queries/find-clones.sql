-- Find top 3 clones of a given perfume
-- Uses: embeddings + DNA overlap + wardrobe co-occurrence + performance similarity
-- Strict thresholds to ensure actual clones, not just similar perfumes
--
-- Inputs:
--   $1 :: bigint   -- target_perfume_id
--   $2 :: int      -- limit (default 3)
--
-- Tables:
--   perfumes(id, name, brand, year, rating, total_votes, description, perfumer, gender, accords, notes_all)
--   perfume_embeddings(perfume_id, vector)
--   perfume_dna(perfume_id, dna jsonb)
--   perfume_performance(perfume_id, longevity_rating, sillage_rating, ...)
--   perfume_wardrobe_edges(perfume_id, related_perfume_id, user_count)

WITH
target AS (
  SELECT
    p.id,
    p.name,
    p.brand,
    e.vector AS target_vector
  FROM perfumes p
  JOIN perfume_embeddings e ON e.perfume_id = p.id
  WHERE p.id = $1::bigint
),
target_brand AS (
  SELECT brand FROM target
),
target_dna AS (
  SELECT
    d.perfume_id,
    d.dna
  FROM perfume_dna d
  WHERE d.perfume_id = $1::bigint
),
-- Aggregate target DNA for overlap calculation
target_notes AS (
  SELECT
    jsonb_object_agg((elem->>'t'), (elem->>'w')::float) AS m,
    SUM((elem->>'w')::float) AS total_w
  FROM target_dna td
  CROSS JOIN LATERAL jsonb_array_elements(td.dna->'notes') elem
),
target_accords AS (
  SELECT
    jsonb_object_agg((elem->>'t'), (elem->>'w')::float) AS m,
    SUM((elem->>'w')::float) AS total_w
  FROM target_dna td
  CROSS JOIN LATERAL jsonb_array_elements(td.dna->'accords') elem
),
target_families AS (
  SELECT
    jsonb_agg((elem->>'t') ORDER BY (elem->>'w')::float DESC) AS family_list
  FROM target_dna td
  CROSS JOIN LATERAL jsonb_array_elements(td.dna->'families') elem
),
-- Candidate retrieval: high similarity by embedding (strict threshold)
candidates AS (
  SELECT
    p.id,
    p.name,
    p.brand,
    p.year,
    p.description,
    p.perfumer,
    p.gender,
    p.accords,
    p.notes_all,
    p.rating,
    p.total_votes,
    e.vector,
    (t.target_vector <=> e.vector) AS cosine_distance,
    GREATEST(0.0, LEAST(1.0, 1.0 - ((t.target_vector <=> e.vector) / 2.0))) AS sim01
  FROM target t
  CROSS JOIN target_brand tb
  CROSS JOIN perfume_embeddings e
  JOIN perfumes p ON p.id = e.perfume_id
  WHERE p.id <> $1::bigint
    -- Clone must be from a different brand (not a flanker/variant)
    AND p.brand <> tb.brand
    -- Strict similarity threshold: must be very similar (>0.85)
    AND (t.target_vector <=> e.vector) < 0.30  -- cosine distance < 0.30 = similarity > 0.85
  ORDER BY t.target_vector <=> e.vector
  LIMIT 200  -- Top 200 by embedding similarity
),
-- DNA overlap calculation (simplified for performance)
dna_overlap AS (
  SELECT
    c.id AS perfume_id,
    -- Shared notes overlap
    COALESCE((
      SELECT SUM(LEAST((note_elem->>'w')::float, COALESCE((tn.m->>(note_elem->>'t'))::float, 0)))
      FROM target_notes tn
      CROSS JOIN LATERAL jsonb_array_elements(d.dna->'notes') note_elem
      WHERE tn.m->>(note_elem->>'t') IS NOT NULL
    ), 0) AS shared_notes_w,
    -- Shared accords overlap
    COALESCE((
      SELECT SUM(LEAST((accord_elem->>'w')::float, COALESCE((ta.m->>(accord_elem->>'t'))::float, 0)))
      FROM target_accords ta
      CROSS JOIN LATERAL jsonb_array_elements(d.dna->'accords') accord_elem
      WHERE ta.m->>(accord_elem->>'t') IS NOT NULL
    ), 0) AS shared_accords_w,
    -- Top shared notes (for explanation)
    COALESCE((
      SELECT jsonb_agg((note_elem->>'t') ORDER BY 
        LEAST((note_elem->>'w')::float, COALESCE((tn.m->>(note_elem->>'t'))::float, 0)) DESC
      )
      FROM target_notes tn
      CROSS JOIN LATERAL jsonb_array_elements(d.dna->'notes') note_elem
      WHERE tn.m->>(note_elem->>'t') IS NOT NULL
        AND LEAST((note_elem->>'w')::float, COALESCE((tn.m->>(note_elem->>'t'))::float, 0)) > 0
      LIMIT 5
    ), '[]'::jsonb) AS shared_notes_top5,
    -- Top shared accords (for explanation)
    COALESCE((
      SELECT jsonb_agg((accord_elem->>'t') ORDER BY 
        LEAST((accord_elem->>'w')::float, COALESCE((ta.m->>(accord_elem->>'t'))::float, 0)) DESC
      )
      FROM target_accords ta
      CROSS JOIN LATERAL jsonb_array_elements(d.dna->'accords') accord_elem
      WHERE ta.m->>(accord_elem->>'t') IS NOT NULL
        AND LEAST((accord_elem->>'w')::float, COALESCE((ta.m->>(accord_elem->>'t'))::float, 0)) > 0
      LIMIT 5
    ), '[]'::jsonb) AS shared_accords_top5,
    -- Family overlap (check if they share primary families)
    (
      SELECT COUNT(*)
      FROM jsonb_array_elements(d.dna->'families') elem
      WHERE EXISTS (
        SELECT 1
        FROM target_families tf
        CROSS JOIN LATERAL jsonb_array_elements(tf.family_list) AS family_elem
        WHERE (family_elem#>>'{}') = (elem->>'t')
      )
    ) AS shared_families_count
  FROM candidates c
  JOIN perfume_dna d ON d.perfume_id = c.id
  CROSS JOIN target_notes tn
  CROSS JOIN target_accords ta
  CROSS JOIN target_families tf
),
-- Wardrobe co-occurrence (how often users own both)
wardrobe AS (
  SELECT
    c.id AS perfume_id,
    COALESCE(SUM(w.user_count), 0) AS total_co_occur,
    COALESCE(AVG(w.user_count), 0) AS avg_co_occur,
    MAX(w.user_count) AS max_co_occur
  FROM candidates c
  LEFT JOIN perfume_wardrobe_edges w ON w.related_perfume_id = c.id AND w.perfume_id = $1::bigint
  GROUP BY c.id
),
-- Performance similarity
performance AS (
  SELECT
    c.id AS perfume_id,
    pp.longevity_rating,
    pp.longevity_votes,
    pp.sillage_rating,
    pp.sillage_votes,
    -- Similarity score: how close performance is to target
    CASE
      WHEN tp.longevity_rating IS NOT NULL AND pp.longevity_rating IS NOT NULL THEN
        1.0 - ABS((tp.longevity_rating - pp.longevity_rating) / 10.0)
      ELSE 0.0
    END AS longevity_sim,
    CASE
      WHEN tp.sillage_rating IS NOT NULL AND pp.sillage_rating IS NOT NULL THEN
        1.0 - ABS((tp.sillage_rating - pp.sillage_rating) / 10.0)
      ELSE 0.0
    END AS sillage_sim
  FROM candidates c
  LEFT JOIN perfume_performance pp ON pp.perfume_id = c.id
  LEFT JOIN perfume_performance tp ON tp.perfume_id = $1::bigint
),
-- Scoring: combine all signals
scored AS (
  SELECT
    c.id,
    c.name,
    c.brand,
    c.year,
    c.description,
    c.perfumer,
    c.gender,
    c.accords,
    c.notes_all,
    c.rating,
    c.total_votes,
    -- Individual signals
    c.sim01 AS embedding_sim,
    -- DNA overlap normalized
    GREATEST(0.0, LEAST(1.0, (
      0.6 * (COALESCE(dna.shared_notes_w, 0) / NULLIF(tn.total_w, 0))
      + 0.4 * (COALESCE(dna.shared_accords_w, 0) / NULLIF(ta.total_w, 0))
    ))) AS dna_overlap,
    -- Wardrobe co-occurrence (log-normalized)
    LEAST(1.0, LN(1 + COALESCE(w.total_co_occur, 0)) / 5.0) AS wardrobe_score,
    -- Performance similarity
    COALESCE((p.longevity_sim + p.sillage_sim) / 2.0, 0.0) AS performance_sim,
    -- Family overlap bonus
    CASE
      WHEN dna.shared_families_count >= 2 THEN 0.1
      WHEN dna.shared_families_count = 1 THEN 0.05
      ELSE 0.0
    END AS family_bonus,
    -- Explanation data
    dna.shared_notes_top5,
    dna.shared_accords_top5,
    w.total_co_occur AS wardrobe_co_occur,
    p.longevity_rating,
    p.sillage_rating,
    p.longevity_votes,
    p.sillage_votes
  FROM candidates c
  CROSS JOIN target_notes tn
  CROSS JOIN target_accords ta
  LEFT JOIN dna_overlap dna ON dna.perfume_id = c.id
  LEFT JOIN wardrobe w ON w.perfume_id = c.id
  LEFT JOIN performance p ON p.perfume_id = c.id
),
-- Final clone score: weighted combination
ranked AS (
  SELECT
    s.*,
    -- Clone score: embedding (35%) + DNA (40%) + wardrobe (15%) + performance (10%)
    -- Increased DNA weight since it's the strongest indicator of clones
    (
      0.35 * s.embedding_sim
      + 0.40 * s.dna_overlap
      + 0.15 * s.wardrobe_score
      + 0.10 * s.performance_sim
      + s.family_bonus
    ) AS clone_score,
    -- Clone confidence: how confident we are this is a clone
    -- Adjusted thresholds based on real-world clone characteristics
    CASE
      -- Very high confidence: very high DNA overlap (>0.70) OR (high embedding + high DNA + wardrobe)
      WHEN s.dna_overlap > 0.70 THEN 'very_high'
      WHEN s.embedding_sim > 0.88 AND s.dna_overlap > 0.65 AND s.wardrobe_score > 0.3 THEN 'very_high'
      -- High confidence: high embedding + high DNA, or high DNA with good embedding
      WHEN s.embedding_sim > 0.88 AND s.dna_overlap > 0.65 THEN 'high'
      WHEN s.dna_overlap > 0.65 AND s.embedding_sim > 0.85 THEN 'high'
      -- Medium confidence: high embedding OR moderate-high DNA
      WHEN s.embedding_sim > 0.88 OR s.dna_overlap > 0.55 THEN 'medium'
      -- Low confidence: still similar but less certain
      ELSE 'low'
    END AS confidence
  FROM scored s
  -- Strict filtering: must have high embedding similarity OR high DNA overlap
  WHERE s.embedding_sim > 0.85 OR s.dna_overlap > 0.70
)
SELECT
  id,
  name,
  brand,
  year,
  description,
  perfumer,
  gender,
  accords,
  notes_all,
  rating,
  total_votes,
  clone_score,
  confidence,
  jsonb_build_object(
    'embedding_sim', embedding_sim,
    'dna_overlap', dna_overlap,
    'wardrobe_score', wardrobe_score,
    'performance_sim', performance_sim,
    'family_bonus', family_bonus
  ) AS signals,
  jsonb_build_object(
    'shared_notes', shared_notes_top5,
    'shared_accords', shared_accords_top5,
    'wardrobe_co_occur', wardrobe_co_occur,
    'performance', CASE
      WHEN longevity_rating IS NOT NULL OR sillage_rating IS NOT NULL THEN
        jsonb_build_object(
          'longevity', longevity_rating,
          'sillage', sillage_rating,
          'longevity_votes', longevity_votes,
          'sillage_votes', sillage_votes
        )
      ELSE NULL
    END
  ) AS why
FROM ranked
ORDER BY clone_score DESC, confidence DESC
LIMIT COALESCE($2::int, 3);
