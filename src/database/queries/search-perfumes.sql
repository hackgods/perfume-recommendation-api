-- Perfume search
-- Supports: full-text search, filtering, pagination, sorting
-- Note: Uses unaccent extension for accent-insensitive search (e.g., "Althair" matches "Althaïr")
--
-- Inputs:
--   $1 :: text        -- search query (optional, searches name, brand, description)
--   $2 :: text[]      -- brands filter (optional)
--   $3 :: text[]      -- gender filter (optional: 'male', 'female', 'unisex')
--   $4 :: int         -- min_year (optional)
--   $5 :: int         -- max_year (optional)
--   $6 :: float       -- min_rating (optional, 0-5)
--   $7 :: int         -- limit (default 15, max 50)
--   $8 :: int         -- offset (default 0, for pagination)
--   $9 :: text        -- sort_by (default 'relevance', options: 'relevance', 'rating', 'year', 'name')
--
-- Returns:
--   id, name, brand, image
--   total_count (for pagination)
--   relevance_score (when searching)

WITH
-- Base filter: apply all filters except search
filtered AS (
  SELECT
    p.id,
    p.name,
    p.brand,
    p.year,
    p.rating,
    p.total_votes,
    p.description,
    -- Build image URL
    'https://fimgs.net/mdimg/perfume-thumbs/375x500.' || p.id || '.2x.avif' AS image
  FROM perfumes p
  WHERE
    -- Brand filter
    ($2::text[] IS NULL OR p.brand = ANY($2::text[]))
    -- Gender filter
    AND ($3::text[] IS NULL OR p.gender = ANY($3::text[]))
    -- Year range filter
    AND ($4::int IS NULL OR p.year IS NULL OR p.year >= $4::int)
    AND ($5::int IS NULL OR p.year IS NULL OR p.year <= $5::int)
    -- Rating filter
    AND ($6::float IS NULL OR p.rating IS NULL OR p.rating >= $6::float)
),
-- Normalize search query (accent-insensitive)
normalized_query AS (
  SELECT 
    CASE 
      WHEN $1::text IS NULL OR length(trim($1::text)) = 0 THEN NULL
      ELSE LOWER(unaccent(trim($1::text)))
    END AS query_normalized
),
-- Apply search query with relevance scoring (accent-insensitive)
searched AS (
  SELECT
    f.*,
    CASE
      -- If no search query, all results have same relevance
      WHEN nq.query_normalized IS NULL THEN 1.0
      -- Exact name match (highest priority) - accent-insensitive
      WHEN LOWER(unaccent(f.name)) = nq.query_normalized THEN 100.0
      -- Name starts with query - accent-insensitive
      WHEN LOWER(unaccent(f.name)) LIKE nq.query_normalized || '%' THEN 50.0
      -- Name contains query (as phrase) - accent-insensitive
      WHEN LOWER(unaccent(f.name)) LIKE '%' || nq.query_normalized || '%' THEN 30.0
      -- Brand exact match - accent-insensitive
      WHEN LOWER(unaccent(f.brand)) = nq.query_normalized THEN 25.0
      -- Brand contains query - accent-insensitive
      WHEN LOWER(unaccent(f.brand)) LIKE '%' || nq.query_normalized || '%' THEN 15.0
      -- Description contains query (lower weight) - accent-insensitive
      WHEN f.description IS NOT NULL AND LOWER(unaccent(f.description)) LIKE '%' || nq.query_normalized || '%' THEN 5.0
      -- No match
      ELSE 0.0
    END AS relevance_score,
    -- Enhanced word-based matching for multi-word queries (accent-insensitive)
    COALESCE((
      WITH word_stats AS (
        SELECT
          COUNT(*) FILTER (WHERE LOWER(unaccent(f.name)) LIKE '%' || w.word || '%') AS name_matches,
          COUNT(*) FILTER (WHERE LOWER(unaccent(f.brand)) LIKE '%' || w.word || '%') AS brand_matches,
          COUNT(*) AS total_words,
          (array_agg(w.word ORDER BY w.ordinality))[1] AS first_word,
          (array_agg(w.word ORDER BY w.ordinality))[2] AS second_word
        FROM normalized_query nq2
        CROSS JOIN unnest(string_to_array(nq2.query_normalized, ' ')) WITH ORDINALITY AS w(word, ordinality)
        WHERE nq2.query_normalized IS NOT NULL
      )
      SELECT
        -- Bonus for matching ALL words (perfect match across name + brand)
        CASE
          WHEN ws.name_matches + ws.brand_matches = ws.total_words THEN 60.0
          WHEN ws.name_matches = ws.total_words THEN 50.0
          ELSE 0.0
        END
        +
        -- Points for each word matched in name (higher weight)
        ws.name_matches * 20.0
        +
        -- Points for each word matched in brand
        ws.brand_matches * 10.0
        +
        -- Bonus if name contains the first word (usually most important, e.g., "elixir")
        CASE
          WHEN ws.first_word IS NOT NULL AND LOWER(unaccent(f.name)) LIKE '%' || ws.first_word || '%' THEN 15.0
          ELSE 0.0
        END
        +
        -- Extra bonus if name contains first word AND brand contains second word (e.g., "elixir" in name, "dior" in brand)
        CASE
          WHEN ws.total_words >= 2 
            AND ws.first_word IS NOT NULL 
            AND LOWER(unaccent(f.name)) LIKE '%' || ws.first_word || '%'
            AND ws.second_word IS NOT NULL
            AND LOWER(unaccent(f.brand)) LIKE '%' || ws.second_word || '%'
          THEN 25.0
          ELSE 0.0
        END
      FROM word_stats ws
    ), 0.0) AS word_match_bonus
  FROM filtered f
  CROSS JOIN normalized_query nq
),
-- Combine relevance scores
ranked AS (
  SELECT
    s.*,
    (s.relevance_score + s.word_match_bonus) AS total_relevance
  FROM searched s
  WHERE
    -- Only include results with some relevance if search query provided
    (s.relevance_score > 0 OR s.word_match_bonus > 0 OR s.relevance_score = 1.0)
),
-- Apply sorting based on sort_by parameter
sorted AS (
  SELECT
    r.*,
    ROW_NUMBER() OVER (
      ORDER BY
        -- Primary sort key (only one will be non-null based on sort_by)
        CASE
          WHEN $9::text = 'rating' THEN COALESCE(r.rating, 0)
          ELSE NULL
        END DESC NULLS LAST,
        CASE
          WHEN $9::text = 'year' THEN COALESCE(r.year, 0)
          ELSE NULL
        END DESC NULLS LAST,
        CASE
          WHEN $9::text = 'name' THEN LOWER(r.name)
          ELSE NULL
        END ASC NULLS LAST,
        CASE
          WHEN $9::text NOT IN ('rating', 'year', 'name') THEN r.total_relevance
          ELSE NULL
        END DESC NULLS LAST,
        -- Secondary sort: rating (for non-rating sorts)
        CASE
          WHEN $9::text != 'rating' THEN COALESCE(r.rating, 0)
          ELSE NULL
        END DESC NULLS LAST,
        -- Final tie-breaker: name (always)
        LOWER(r.name) ASC
    ) AS row_num
  FROM ranked r
),
-- Get total count for pagination
total_count AS (
  SELECT COUNT(*)::int AS total FROM sorted
)
SELECT
  s.id,
  s.name,
  s.brand,
  s.image,
  tc.total AS total_count,
  s.total_relevance AS relevance_score
FROM sorted s
CROSS JOIN total_count tc
WHERE s.row_num > $8::int
  AND s.row_num <= ($8::int + $7::int)
ORDER BY s.row_num;
