-- Get DNA card for a single perfume
-- Returns top 3 families, top 5 accords, and top 5 notes with weights/percentages
--
-- Input:
--   $1 :: bigint   -- perfume_id
--
-- Tables:
--   perfume_dna(perfume_id, dna jsonb)  -- dna->'families', dna->'accords', dna->'notes' arrays of {t,w}

SELECT
  -- Top 3 families (no percentages, just names)
  COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object('name', f.name, 'weight', f.weight)
      ORDER BY f.weight DESC
    )
    FROM (
      SELECT
        (elem->>'t') AS name,
        (elem->>'w')::float AS weight
      FROM jsonb_array_elements(d.dna->'families') elem
      ORDER BY (elem->>'w')::float DESC
      LIMIT 3
    ) f
  ), '[]'::jsonb) AS families,

  -- Top 5 accords with percentages
  COALESCE((
    WITH all_accords AS (
      SELECT
        (elem->>'t') AS token,
        (elem->>'w')::float AS weight
      FROM jsonb_array_elements(d.dna->'accords') elem
    ),
    total_weight AS (
      SELECT SUM(weight) AS total FROM all_accords
    ),
    top_accords AS (
      SELECT token, weight
      FROM all_accords
      ORDER BY weight DESC
      LIMIT 5
    )
    SELECT jsonb_agg(
      jsonb_build_object(
        'name', ta.token,
        'weight', ta.weight,
        'percentage', ROUND((ta.weight / NULLIF(tw.total, 0) * 100)::numeric, 1)
      )
      ORDER BY ta.weight DESC
    )
    FROM top_accords ta
    CROSS JOIN total_weight tw
  ), '[]'::jsonb) AS accords,

  -- Top 5 notes with percentages
  COALESCE((
    WITH all_notes AS (
      SELECT
        (elem->>'t') AS token,
        (elem->>'w')::float AS weight
      FROM jsonb_array_elements(d.dna->'notes') elem
    ),
    total_weight AS (
      SELECT SUM(weight) AS total FROM all_notes
    ),
    top_notes AS (
      SELECT token, weight
      FROM all_notes
      ORDER BY weight DESC
      LIMIT 5
    )
    SELECT jsonb_agg(
      jsonb_build_object(
        'name', tn.token,
        'weight', tn.weight,
        'percentage', ROUND((tn.weight / NULLIF(tw.total, 0) * 100)::numeric, 1)
      )
      ORDER BY tn.weight DESC
    )
    FROM top_notes tn
    CROSS JOIN total_weight tw
  ), '[]'::jsonb) AS notes

FROM perfume_dna d
WHERE d.perfume_id = $1::bigint
LIMIT 1;
