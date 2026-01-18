-- Get user taste fingerprint from liked perfumes
-- Aggregates DNA from all liked perfumes and identifies missing items
--
-- Input:
--   $1 :: bigint[]   -- liked_perfume_ids
--
-- Returns:
--   - Aggregated families, accords, notes with percentages
--   - Missing items (families/accords/notes with < 5% in user profile but common in database)

WITH
liked AS (
  SELECT unnest($1::bigint[]) AS perfume_id
),

-- Derive typical notes for each family from database
-- For each family, find the top 50 most common notes (by frequency across all perfumes with that family)
family_typical_notes AS (
  SELECT
    REPLACE((fam_elem->>'t'), 'family:', '') AS family_name,
    (note_elem->>'t') AS note_token,
    COUNT(*) AS note_frequency
  FROM perfume_dna d
  CROSS JOIN LATERAL jsonb_array_elements(d.dna->'families') fam_elem
  CROSS JOIN LATERAL jsonb_array_elements(d.dna->'notes') note_elem
  WHERE (fam_elem->>'t') LIKE 'family:%'
  GROUP BY REPLACE((fam_elem->>'t'), 'family:', ''), (note_elem->>'t')
  HAVING COUNT(*) >= 5  -- Only include notes that appear in at least 5 perfumes with this family
),
family_top_notes AS (
  SELECT
    family_name,
    jsonb_agg(note_token ORDER BY note_frequency DESC) AS typical_notes
  FROM (
    SELECT
      family_name,
      note_token,
      note_frequency,
      ROW_NUMBER() OVER (PARTITION BY family_name ORDER BY note_frequency DESC) AS rn
    FROM family_typical_notes
  ) ranked
  WHERE rn <= 50  -- Top 50 notes per family
  GROUP BY family_name
),

-- Aggregate families from all liked perfumes
-- Uses primary key index on perfume_dna.perfume_id for efficient lookup
user_families AS (
  SELECT
    (elem->>'t') AS family,
    SUM((elem->>'w')::float) AS total_weight
  FROM liked l
  JOIN perfume_dna d ON d.perfume_id = l.perfume_id
  CROSS JOIN LATERAL jsonb_array_elements(d.dna->'families') elem
  GROUP BY (elem->>'t')
),
family_totals AS (
  SELECT SUM(total_weight) AS grand_total FROM user_families
),
families_with_percent AS (
  SELECT
    uf.family AS name,
    ROUND((uf.total_weight / NULLIF(ft.grand_total, 0) * 100)::numeric, 1) AS percentage
  FROM user_families uf
  CROSS JOIN family_totals ft
  ORDER BY uf.total_weight DESC
),

-- Aggregate accords from all liked perfumes
-- Uses primary key index on perfume_dna.perfume_id for efficient lookup
user_accords AS (
  SELECT
    (elem->>'t') AS accord,
    SUM((elem->>'w')::float) AS total_weight
  FROM liked l
  JOIN perfume_dna d ON d.perfume_id = l.perfume_id
  CROSS JOIN LATERAL jsonb_array_elements(d.dna->'accords') elem
  GROUP BY (elem->>'t')
),
accord_totals AS (
  SELECT SUM(total_weight) AS grand_total FROM user_accords
),
accords_with_percent AS (
  SELECT
    ua.accord AS name,
    ROUND((ua.total_weight / NULLIF(at.grand_total, 0) * 100)::numeric, 1) AS percentage
  FROM user_accords ua
  CROSS JOIN accord_totals at
  ORDER BY ua.total_weight DESC
),

-- Aggregate notes from all liked perfumes
-- Uses primary key index on perfume_dna.perfume_id for efficient lookup
user_notes AS (
  SELECT
    (elem->>'t') AS note,
    SUM((elem->>'w')::float) AS total_weight
  FROM liked l
  JOIN perfume_dna d ON d.perfume_id = l.perfume_id
  CROSS JOIN LATERAL jsonb_array_elements(d.dna->'notes') elem
  GROUP BY (elem->>'t')
),
note_totals AS (
  SELECT SUM(total_weight) AS grand_total FROM user_notes
),
notes_with_percent AS (
  SELECT
    un.note AS name,
    ROUND((un.total_weight / NULLIF(nt.grand_total, 0) * 100)::numeric, 1) AS percentage
  FROM user_notes un
  CROSS JOIN note_totals nt
  ORDER BY un.total_weight DESC
),

-- Find missing items: common in database but < 5% in user profile
-- For families: check common families not well represented in user profile
-- For accords/notes: check dna_vocab for common items with < 5% in user profile
missing_families AS (
  SELECT DISTINCT
    'family' AS category,
    family_name AS name,
    -- Select template (1-10) based on hash of family name for consistency
    -- Using hashtext for better distribution across templates
    CASE
      WHEN ABS(hashtext(family_name) % 10) = 0 THEN 'You haven''t explored much in the ' || family_name || ' space yet. These are 3 easy, beginner-friendly picks to try.'
      WHEN ABS(hashtext(family_name) % 10) = 1 THEN 'Looks like ' || family_name || ' scents are still uncharted territory for you. Want to try 3 safe ones?'
      WHEN ABS(hashtext(family_name) % 10) = 2 THEN 'You don''t usually go for ' || family_name || ' fragrances. These 3 are smooth, approachable ways to dip your toes in.'
      WHEN ABS(hashtext(family_name) % 10) = 3 THEN 'Ready to explore something new? ' || INITCAP(family_name) || ' isn''t a big part of your collection yet, so we picked 3 easy entries.'
      WHEN ABS(hashtext(family_name) % 10) = 4 THEN 'You''ve mostly stayed away from ' || family_name || ' so far. These 3 are safe, crowd-pleasing introductions.'
      WHEN ABS(hashtext(family_name) % 10) = 5 THEN INITCAP(family_name) || ' hasn''t shown up much in your collection yet. These 3 are great, low-risk starting points.'
      WHEN ABS(hashtext(family_name) % 10) = 6 THEN 'You haven''t really tried ' || family_name || ' scents yet, so we found 3 that match your taste and feel easy to love.'
      WHEN ABS(hashtext(family_name) % 10) = 7 THEN INITCAP(family_name) || ' isn''t really your thing so far. No worries, here are 3 super approachable ones to test.'
      WHEN ABS(hashtext(family_name) % 10) = 8 THEN 'Based on your taste, ' || family_name || ' hasn''t been in your comfort zone. These 3 are the safest way in.'
      ELSE 'You haven''t explored the ' || family_name || ' category much yet. These 3 selections are carefully chosen, safe introductions.'
    END AS suggestion,
    -- Find 3 safe, beginner-friendly perfumes for this family
    -- Uses hybrid scoring: rating quality + performance + wardrobe co-occurrence
    -- Ensures perfumes have notes typical of the missing family
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', scored.id,
          'name', scored.name,
          'brand', scored.brand,
          'image', 'https://fimgs.net/mdimg/perfume-thumbs/375x500.' || scored.id || '.2x.avif'
        )
        ORDER BY scored.final_score DESC
      )
      FROM (
        SELECT 
          p.id,
          p.name,
          p.brand,
          -- Rating quality score (0-1)
          (COALESCE(p.rating, 0) / 5.0) * (1.0 - EXP(-COALESCE(p.total_votes, 0)::float / 500.0)) AS qual01,
          -- Performance score (0-1) - average of longevity and sillage with confidence
          COALESCE((
            (
              (COALESCE(pp.longevity_rating, 0) / 10.0) * (1.0 - EXP(-COALESCE(pp.longevity_votes, 0)::float / 500.0))
              + (COALESCE(pp.sillage_rating, 0) / 10.0) * (1.0 - EXP(-COALESCE(pp.sillage_votes, 0)::float / 500.0))
            ) / 2.0
          ), 0) AS perf01,
          -- Wardrobe co-occurrence score (0-1) - how often this perfume appears with user's liked perfumes
          LEAST(1.0, COALESCE((
            SELECT SUM(LN(1 + w.user_count::float))
            FROM perfume_wardrobe_edges w
            WHERE w.related_perfume_id = p.id
              AND w.perfume_id = ANY($1::bigint[])
          ), 0) / 5.0) AS ward01,
          -- Final hybrid score: quality (50%) + performance (30%) + wardrobe (20%)
          (
            (COALESCE(p.rating, 0) / 5.0) * (1.0 - EXP(-COALESCE(p.total_votes, 0)::float / 500.0)) * 0.5
            + COALESCE((
              (
                (COALESCE(pp.longevity_rating, 0) / 10.0) * (1.0 - EXP(-COALESCE(pp.longevity_votes, 0)::float / 500.0))
                + (COALESCE(pp.sillage_rating, 0) / 10.0) * (1.0 - EXP(-COALESCE(pp.sillage_votes, 0)::float / 500.0))
              ) / 2.0
            ), 0) * 0.3
            + LEAST(1.0, COALESCE((
              SELECT SUM(LN(1 + w.user_count::float))
              FROM perfume_wardrobe_edges w
              WHERE w.related_perfume_id = p.id
                AND w.perfume_id = ANY($1::bigint[])
            ), 0) / 5.0) * 0.2
          ) AS final_score
        FROM perfumes p
        JOIN perfume_dna d ON d.perfume_id = p.id
        LEFT JOIN perfume_performance pp ON pp.perfume_id = p.id
        WHERE p.id <> ALL($1::bigint[])
          -- Must have the missing family as the PRIMARY (highest weight) family
          -- Check that the missing family has the highest weight among all families for this perfume
          AND EXISTS (
            SELECT 1
            FROM jsonb_array_elements(d.dna->'families') elem
            WHERE (elem->>'t') = 'family:' || common_families.family_name
              AND (elem->>'w')::float = (
                -- Get the maximum weight among all families for this perfume
                SELECT MAX((e->>'w')::float)
                FROM jsonb_array_elements(d.dna->'families') e
              )
              -- Ensure it's strictly the highest (no ties with other families at the same weight)
              AND (elem->>'w')::float > 0
          )
          -- Must have notes typical of this family (at least 4 notes from the family's typical notes)
          -- Uses dynamically derived typical notes from the database
          AND (
            -- If we have typical notes for this family, require at least 4 matches
            (EXISTS (
              SELECT 1 FROM family_top_notes ftn
              WHERE ftn.family_name = common_families.family_name
            ) AND (
              SELECT COUNT(DISTINCT (note_elem->>'t'))
              FROM jsonb_array_elements(d.dna->'notes') note_elem
              WHERE EXISTS (
                SELECT 1
                FROM family_top_notes ftn
                WHERE ftn.family_name = common_families.family_name
                  AND ftn.typical_notes @> jsonb_build_array(note_elem->>'t')
              )
            ) >= 4)
            -- If no typical notes found for this family, just require the family is primary
            OR NOT EXISTS (
              SELECT 1 FROM family_top_notes ftn
              WHERE ftn.family_name = common_families.family_name
            )
          )
        ORDER BY 
          (
            (COALESCE(p.rating, 0) / 5.0) * (1.0 - EXP(-COALESCE(p.total_votes, 0)::float / 500.0)) * 0.5
            + COALESCE((
              (
                (COALESCE(pp.longevity_rating, 0) / 10.0) * (1.0 - EXP(-COALESCE(pp.longevity_votes, 0)::float / 500.0))
                + (COALESCE(pp.sillage_rating, 0) / 10.0) * (1.0 - EXP(-COALESCE(pp.sillage_votes, 0)::float / 500.0))
              ) / 2.0
            ), 0) * 0.3
            + LEAST(1.0, COALESCE((
              SELECT SUM(LN(1 + w.user_count::float))
              FROM perfume_wardrobe_edges w
              WHERE w.related_perfume_id = p.id
                AND w.perfume_id = ANY($1::bigint[])
            ), 0) / 5.0) * 0.2
          ) DESC,
          p.total_votes DESC NULLS LAST
        LIMIT 3
      ) scored
    ), '[]'::jsonb) AS perfumes
  FROM (
    SELECT DISTINCT 'gourmand' AS family_name
    UNION ALL SELECT 'fresh'
    UNION ALL SELECT 'woody'
    UNION ALL SELECT 'amber'
    UNION ALL SELECT 'floral'
    UNION ALL SELECT 'spicy'
    UNION ALL SELECT 'fruity'
    UNION ALL SELECT 'musky'
  ) common_families
  LEFT JOIN families_with_percent fwp ON 
    (fwp.name = 'family:' || common_families.family_name OR REPLACE(fwp.name, 'family:', '') = common_families.family_name)
  WHERE fwp.name IS NULL OR fwp.percentage < 5.0
  LIMIT 3
),

missing_accords AS (
  SELECT
    'accord' AS category,
    v.token AS name,
    -- Select template (1-10) based on hash of token for consistency
    -- Using hashtext for better distribution across templates
    CASE
      WHEN ABS(hashtext(v.token) % 10) = 0 THEN 'You haven''t explored much in the ' || v.token || ' space yet. These are 3 easy, beginner-friendly picks to try.'
      WHEN ABS(hashtext(v.token) % 10) = 1 THEN 'Looks like ' || v.token || ' scents are still uncharted territory for you. Want to try 3 safe ones?'
      WHEN ABS(hashtext(v.token) % 10) = 2 THEN 'You don''t usually go for ' || v.token || ' fragrances. These 3 are smooth, approachable ways to dip your toes in.'
      WHEN ABS(hashtext(v.token) % 10) = 3 THEN 'Ready to explore something new? ' || INITCAP(v.token) || ' isn''t a big part of your collection yet, so we picked 3 easy entries.'
      WHEN ABS(hashtext(v.token) % 10) = 4 THEN 'You''ve mostly stayed away from ' || v.token || ' so far. These 3 are safe, crowd-pleasing introductions.'
      WHEN ABS(hashtext(v.token) % 10) = 5 THEN INITCAP(v.token) || ' hasn''t shown up much in your collection yet. These 3 are great, low-risk starting points.'
      WHEN ABS(hashtext(v.token) % 10) = 6 THEN 'You haven''t really tried ' || v.token || ' scents yet, so we found 3 that match your taste and feel easy to love.'
      WHEN ABS(hashtext(v.token) % 10) = 7 THEN INITCAP(v.token) || ' isn''t really your thing so far. No worries, here are 3 super approachable ones to test.'
      WHEN ABS(hashtext(v.token) % 10) = 8 THEN 'Based on your taste, ' || v.token || ' hasn''t been in your comfort zone. These 3 are the safest way in.'
      ELSE 'You haven''t explored the ' || v.token || ' category much yet. These 3 selections are carefully chosen, safe introductions.'
    END AS suggestion,
    -- Find 3 safe, beginner-friendly perfumes for this accord
    -- Uses hybrid scoring: rating quality + performance + wardrobe co-occurrence
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', scored.id,
          'name', scored.name,
          'brand', scored.brand,
          'image', 'https://fimgs.net/mdimg/perfume-thumbs/375x500.' || scored.id || '.2x.avif'
        )
        ORDER BY scored.final_score DESC
      )
      FROM (
        SELECT 
          p.id,
          p.name,
          p.brand,
          -- Final hybrid score: quality (50%) + performance (30%) + wardrobe (20%)
          (
            (COALESCE(p.rating, 0) / 5.0) * (1.0 - EXP(-COALESCE(p.total_votes, 0)::float / 500.0)) * 0.5
            + COALESCE((
              (
                (COALESCE(pp.longevity_rating, 0) / 10.0) * (1.0 - EXP(-COALESCE(pp.longevity_votes, 0)::float / 500.0))
                + (COALESCE(pp.sillage_rating, 0) / 10.0) * (1.0 - EXP(-COALESCE(pp.sillage_votes, 0)::float / 500.0))
              ) / 2.0
            ), 0) * 0.3
            + LEAST(1.0, COALESCE((
              SELECT SUM(LN(1 + w.user_count::float))
              FROM perfume_wardrobe_edges w
              WHERE w.related_perfume_id = p.id
                AND w.perfume_id = ANY($1::bigint[])
            ), 0) / 5.0) * 0.2
          ) AS final_score
        FROM perfumes p
        JOIN perfume_dna d ON d.perfume_id = p.id
        LEFT JOIN perfume_performance pp ON pp.perfume_id = p.id
        WHERE p.id <> ALL($1::bigint[])
          AND EXISTS (
            SELECT 1
            FROM jsonb_array_elements(d.dna->'accords') elem
            WHERE (elem->>'t') = v.token
          )
        ORDER BY 
          (
            (COALESCE(p.rating, 0) / 5.0) * (1.0 - EXP(-COALESCE(p.total_votes, 0)::float / 500.0)) * 0.5
            + COALESCE((
              (
                (COALESCE(pp.longevity_rating, 0) / 10.0) * (1.0 - EXP(-COALESCE(pp.longevity_votes, 0)::float / 500.0))
                + (COALESCE(pp.sillage_rating, 0) / 10.0) * (1.0 - EXP(-COALESCE(pp.sillage_votes, 0)::float / 500.0))
              ) / 2.0
            ), 0) * 0.3
            + LEAST(1.0, COALESCE((
              SELECT SUM(LN(1 + w.user_count::float))
              FROM perfume_wardrobe_edges w
              WHERE w.related_perfume_id = p.id
                AND w.perfume_id = ANY($1::bigint[])
            ), 0) / 5.0) * 0.2
          ) DESC,
          p.total_votes DESC NULLS LAST
        LIMIT 3
      ) scored
    ), '[]'::jsonb) AS perfumes
  FROM dna_vocab v
  LEFT JOIN accords_with_percent awp ON awp.name = v.token
  WHERE v.kind = 'accord'
    AND v.freq > 50
    AND (awp.name IS NULL OR awp.percentage < 5.0)
  ORDER BY v.freq DESC
  LIMIT 2
),

missing_notes AS (
  SELECT
    'note' AS category,
    v.token AS name,
    -- Select template (1-10) based on hash of token for consistency
    -- Using hashtext for better distribution across templates
    CASE
      WHEN ABS(hashtext(v.token) % 10) = 0 THEN 'You haven''t explored much in the ' || v.token || ' space yet. These are 3 easy, beginner-friendly picks to try.'
      WHEN ABS(hashtext(v.token) % 10) = 1 THEN 'Looks like ' || v.token || ' scents are still uncharted territory for you. Want to try 3 safe ones?'
      WHEN ABS(hashtext(v.token) % 10) = 2 THEN 'You don''t usually go for ' || v.token || ' fragrances. These 3 are smooth, approachable ways to dip your toes in.'
      WHEN ABS(hashtext(v.token) % 10) = 3 THEN 'Ready to explore something new? ' || INITCAP(v.token) || ' isn''t a big part of your collection yet, so we picked 3 easy entries.'
      WHEN ABS(hashtext(v.token) % 10) = 4 THEN 'You''ve mostly stayed away from ' || v.token || ' so far. These 3 are safe, crowd-pleasing introductions.'
      WHEN ABS(hashtext(v.token) % 10) = 5 THEN INITCAP(v.token) || ' hasn''t shown up much in your collection yet. These 3 are great, low-risk starting points.'
      WHEN ABS(hashtext(v.token) % 10) = 6 THEN 'You haven''t really tried ' || v.token || ' scents yet, so we found 3 that match your taste and feel easy to love.'
      WHEN ABS(hashtext(v.token) % 10) = 7 THEN INITCAP(v.token) || ' isn''t really your thing so far. No worries, here are 3 super approachable ones to test.'
      WHEN ABS(hashtext(v.token) % 10) = 8 THEN 'Based on your taste, ' || v.token || ' hasn''t been in your comfort zone. These 3 are the safest way in.'
      ELSE 'You haven''t explored the ' || v.token || ' category much yet. These 3 selections are carefully chosen, safe introductions.'
    END AS suggestion,
    -- Find 3 safe, beginner-friendly perfumes for this note
    -- Uses hybrid scoring: rating quality + performance + wardrobe co-occurrence
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', scored.id,
          'name', scored.name,
          'brand', scored.brand,
          'image', 'https://fimgs.net/mdimg/perfume-thumbs/375x500.' || scored.id || '.2x.avif'
        )
        ORDER BY scored.final_score DESC
      )
      FROM (
        SELECT 
          p.id,
          p.name,
          p.brand,
          -- Final hybrid score: quality (50%) + performance (30%) + wardrobe (20%)
          (
            (COALESCE(p.rating, 0) / 5.0) * (1.0 - EXP(-COALESCE(p.total_votes, 0)::float / 500.0)) * 0.5
            + COALESCE((
              (
                (COALESCE(pp.longevity_rating, 0) / 10.0) * (1.0 - EXP(-COALESCE(pp.longevity_votes, 0)::float / 500.0))
                + (COALESCE(pp.sillage_rating, 0) / 10.0) * (1.0 - EXP(-COALESCE(pp.sillage_votes, 0)::float / 500.0))
              ) / 2.0
            ), 0) * 0.3
            + LEAST(1.0, COALESCE((
              SELECT SUM(LN(1 + w.user_count::float))
              FROM perfume_wardrobe_edges w
              WHERE w.related_perfume_id = p.id
                AND w.perfume_id = ANY($1::bigint[])
            ), 0) / 5.0) * 0.2
          ) AS final_score
        FROM perfumes p
        JOIN perfume_dna d ON d.perfume_id = p.id
        LEFT JOIN perfume_performance pp ON pp.perfume_id = p.id
        WHERE p.id <> ALL($1::bigint[])
          AND EXISTS (
            SELECT 1
            FROM jsonb_array_elements(d.dna->'notes') elem
            WHERE (elem->>'t') = v.token
          )
        ORDER BY 
          (
            (COALESCE(p.rating, 0) / 5.0) * (1.0 - EXP(-COALESCE(p.total_votes, 0)::float / 500.0)) * 0.5
            + COALESCE((
              (
                (COALESCE(pp.longevity_rating, 0) / 10.0) * (1.0 - EXP(-COALESCE(pp.longevity_votes, 0)::float / 500.0))
                + (COALESCE(pp.sillage_rating, 0) / 10.0) * (1.0 - EXP(-COALESCE(pp.sillage_votes, 0)::float / 500.0))
              ) / 2.0
            ), 0) * 0.3
            + LEAST(1.0, COALESCE((
              SELECT SUM(LN(1 + w.user_count::float))
              FROM perfume_wardrobe_edges w
              WHERE w.related_perfume_id = p.id
                AND w.perfume_id = ANY($1::bigint[])
            ), 0) / 5.0) * 0.2
          ) DESC,
          p.total_votes DESC NULLS LAST
        LIMIT 3
      ) scored
    ), '[]'::jsonb) AS perfumes
  FROM dna_vocab v
  LEFT JOIN notes_with_percent nwp ON nwp.name = v.token
  WHERE v.kind = 'note'
    AND v.freq > 50
    AND (nwp.name IS NULL OR nwp.percentage < 5.0)
  ORDER BY v.freq DESC
  LIMIT 2
),

all_missing AS (
  SELECT * FROM (
    SELECT * FROM missing_families
    UNION ALL
    SELECT * FROM missing_accords
    UNION ALL
    SELECT * FROM missing_notes
  ) combined
  LIMIT 3
)

SELECT
  -- Summary will be generated in TypeScript service
  '' AS summary,
  
  -- Families with percentages
  COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object('name', REPLACE(name, 'family:', ''), 'percentage', percentage)
      ORDER BY percentage DESC
    )
    FROM families_with_percent
  ), '[]'::jsonb) AS families,

  -- Accords with percentages (top 15)
  COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object('name', name, 'percentage', percentage)
      ORDER BY percentage DESC
    )
    FROM accords_with_percent
    LIMIT 15
  ), '[]'::jsonb) AS accords,

  -- Notes with percentages (top 15)
  COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object('name', name, 'percentage', percentage)
      ORDER BY percentage DESC
    )
    FROM notes_with_percent
    LIMIT 15
  ), '[]'::jsonb) AS notes,

  -- Missing suggestions with perfume recommendations
  COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'category', category,
        'name', name,
        'suggestion', suggestion,
        'perfumes', perfumes
      )
    )
    FROM all_missing
  ), '[]'::jsonb) AS missing;
