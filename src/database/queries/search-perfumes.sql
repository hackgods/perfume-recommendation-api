-- Perfume search
-- Supports: full-text search, filtering, pagination, sorting
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
-- Apply search query with relevance scoring
searched AS (
  SELECT
    f.*,
    CASE
      -- If no search query, all results have same relevance
      WHEN $1::text IS NULL OR length(trim($1::text)) = 0 THEN 1.0
      -- Exact name match (highest priority)
      WHEN LOWER(f.name) = LOWER(trim($1::text)) THEN 100.0
      -- Name starts with query
      WHEN LOWER(f.name) LIKE LOWER(trim($1::text)) || '%' THEN 50.0
      -- Name contains query (as phrase)
      WHEN LOWER(f.name) LIKE '%' || LOWER(trim($1::text)) || '%' THEN 30.0
      -- Brand exact match
      WHEN LOWER(f.brand) = LOWER(trim($1::text)) THEN 25.0
      -- Brand contains query
      WHEN LOWER(f.brand) LIKE '%' || LOWER(trim($1::text)) || '%' THEN 15.0
      -- Description contains query (lower weight)
      WHEN f.description IS NOT NULL AND LOWER(f.description) LIKE '%' || LOWER(trim($1::text)) || '%' THEN 5.0
      -- No match
      ELSE 0.0
    END AS relevance_score,
    -- Enhanced word-based matching for multi-word queries
    COALESCE((
      WITH word_stats AS (
        SELECT
          COUNT(*) FILTER (WHERE LOWER(f.name) LIKE '%' || w.word || '%') AS name_matches,
          COUNT(*) FILTER (WHERE LOWER(f.brand) LIKE '%' || w.word || '%') AS brand_matches,
          COUNT(*) AS total_words,
          (array_agg(w.word ORDER BY w.ordinality))[1] AS first_word,
          (array_agg(w.word ORDER BY w.ordinality))[2] AS second_word
        FROM unnest(string_to_array(LOWER(trim($1::text)), ' ')) WITH ORDINALITY AS w(word, ordinality)
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
          WHEN ws.first_word IS NOT NULL AND LOWER(f.name) LIKE '%' || ws.first_word || '%' THEN 15.0
          ELSE 0.0
        END
        +
        -- Extra bonus if name contains first word AND brand contains second word (e.g., "elixir" in name, "dior" in brand)
        CASE
          WHEN ws.total_words >= 2 
            AND ws.first_word IS NOT NULL 
            AND LOWER(f.name) LIKE '%' || ws.first_word || '%'
            AND ws.second_word IS NOT NULL
            AND LOWER(f.brand) LIKE '%' || ws.second_word || '%'
          THEN 25.0
          ELSE 0.0
        END
      FROM word_stats ws
    ), 0.0) AS word_match_bonus
  FROM filtered f
),
-- Combine relevance scores
ranked AS (
  SELECT
    s.*,
    (s.relevance_score + s.word_match_bonus) AS total_relevance
  FROM searched s
  WHERE
    -- Only include results with some relevance if search query provided
    ($1::text IS NULL OR length(trim($1::text)) = 0 OR s.relevance_score > 0 OR s.word_match_bonus > 0)
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
