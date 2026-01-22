-- Get DNA card for a single perfume
-- Returns top 3 families, all accords, and all notes with weights/percentages
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

  -- All accords with percentages
  COALESCE((
    WITH all_accords AS (
      SELECT
        (elem->>'t') AS token,
        (elem->>'w')::float AS weight
      FROM jsonb_array_elements(d.dna->'accords') elem
    ),
    total_weight AS (
      SELECT SUM(weight) AS total FROM all_accords
    )
    SELECT jsonb_agg(
      jsonb_build_object(
        'name', aa.token,
        'weight', aa.weight,
        'percentage', ROUND((aa.weight / NULLIF(tw.total, 0) * 100)::numeric, 1)
      )
      ORDER BY aa.weight DESC
    )
    FROM all_accords aa
    CROSS JOIN total_weight tw
  ), '[]'::jsonb) AS accords,

  -- All notes with percentages
  COALESCE((
    WITH all_notes AS (
      SELECT
        (elem->>'t') AS token,
        (elem->>'w')::float AS weight
      FROM jsonb_array_elements(d.dna->'notes') elem
    ),
    total_weight AS (
      SELECT SUM(weight) AS total FROM all_notes
    )
    SELECT jsonb_agg(
      jsonb_build_object(
        'name', an.token,
        'weight', an.weight,
        'percentage', ROUND((an.weight / NULLIF(tw.total, 0) * 100)::numeric, 1)
      )
      ORDER BY an.weight DESC
    )
    FROM all_notes an
    CROSS JOIN total_weight tw
  ), '[]'::jsonb) AS notes

FROM perfume_dna d
WHERE d.perfume_id = $1::bigint
LIMIT 1;
