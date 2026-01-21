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
      -- Name contains query
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
    -- Word-based matching for multi-word queries
    CASE
      WHEN $1::text IS NULL OR length(trim($1::text)) = 0 THEN 0.0
      ELSE (
        -- Count how many words from query appear in name
        (
          SELECT COUNT(*)
          FROM unnest(string_to_array(LOWER(trim($1::text)), ' ')) AS query_word
          WHERE LOWER(f.name) LIKE '%' || query_word || '%'
        ) * 10.0
        +
        -- Count how many words from query appear in brand
        (
          SELECT COUNT(*)
          FROM unnest(string_to_array(LOWER(trim($1::text)), ' ')) AS query_word
          WHERE LOWER(f.brand) LIKE '%' || query_word || '%'
        ) * 5.0
      )
    END AS word_match_bonus
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
-- Apply sorting
sorted AS (
  SELECT
    r.*,
    ROW_NUMBER() OVER (
      ORDER BY
        CASE
          WHEN $9::text = 'rating' THEN COALESCE(r.rating, 0) DESC
          WHEN $9::text = 'year' THEN COALESCE(r.year, 0) DESC
          WHEN $9::text = 'name' THEN LOWER(r.name) ASC
          ELSE r.total_relevance DESC, COALESCE(r.rating, 0) DESC, LOWER(r.name) ASC
        END
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
