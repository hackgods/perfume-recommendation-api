-- Hybrid "Similar Perfumes from Likes" (end-to-end)
-- Uses: embeddings + DNA overlap + wardrobe co-occur + rating/votes + performance
-- Enforces: max 1 perfume per brand (brand diversification)
--
-- Inputs:
--   $1 :: bigint[]   -- liked_perfume_ids (size 1..10)
--   $2 :: int        -- limit (e.g. 10)
--
-- Tables:
--   perfumes(id, name, brand, year, rating, total_votes, ...)
--   perfume_embeddings(perfume_id, vector)
--   perfume_dna(perfume_id, dna jsonb)    -- dna->'notes' / 'accords' arrays of {t,w}
--   perfume_performance(perfume_id, longevity_rating, longevity_votes, sillage_rating, sillage_votes, ...)
--   perfume_wardrobe_edges(perfume_id, related_perfume_id, user_count)

WITH
liked AS (
  SELECT unnest($1::bigint[]) AS perfume_id
),

liked_count AS (
  SELECT COUNT(*)::int AS n FROM liked
),

taste_vec AS (
  SELECT AVG(e.vector) AS v
  FROM perfume_embeddings e
  JOIN liked l ON l.perfume_id = e.perfume_id
),

-- Aggregate user DNA into maps: token -> summed weight
user_notes AS (
  SELECT
	jsonb_object_agg(token, wsum) AS m,
	SUM(wsum) AS total_w
  FROM (
	SELECT (elem->>'t') AS token, SUM((elem->>'w')::float) AS wsum
	FROM perfume_dna d
	JOIN liked l ON l.perfume_id = d.perfume_id
	CROSS JOIN LATERAL jsonb_array_elements(d.dna->'notes') elem
	GROUP BY 1
  ) x
),
user_accords AS (
  SELECT
	jsonb_object_agg(token, wsum) AS m,
	SUM(wsum) AS total_w
  FROM (
	SELECT (elem->>'t') AS token, SUM((elem->>'w')::float) AS wsum
	FROM perfume_dna d
	JOIN liked l ON l.perfume_id = d.perfume_id
	CROSS JOIN LATERAL jsonb_array_elements(d.dna->'accords') elem
	GROUP BY 1
  ) x
),

-- Candidate retrieval by embedding (high-recall pool)
candidates AS (
  SELECT
	p.id,
	p.name,
	p.brand,
	p.year,
	p.rating,
	p.total_votes,
	p.description,
	p.perfumer,
	p.gender,
	p.accords,
	p.notes_all,
	e.vector,
	(e.vector <=> tv.v) AS cosine_distance
  FROM taste_vec tv
  JOIN perfume_embeddings e ON true
  JOIN perfumes p ON p.id = e.perfume_id
  WHERE p.id <> ALL ($1::bigint[])
  ORDER BY e.vector <=> tv.v
  LIMIT 400
),

-- Wardrobe co-occurrence score (sum over liked perfumes)
wardrobe AS (
  SELECT
	c.id AS perfume_id,
	SUM(LN(1 + w.user_count::float)) AS ward_sum_log,
	jsonb_agg(
	  jsonb_build_object('liked_id', w.perfume_id, 'co_count', w.user_count)
	  ORDER BY w.user_count DESC
	) AS ward_pairs
  FROM candidates c
  JOIN perfume_wardrobe_edges w
	ON w.related_perfume_id = c.id
   AND w.perfume_id = ANY ($1::bigint[])
  GROUP BY c.id
),

-- Performance score (optional, sparse)
perf AS (
  SELECT
	c.id AS perfume_id,
	pp.longevity_rating,
	pp.longevity_votes,
	pp.sillage_rating,
	pp.sillage_votes,
	(
	  (
		COALESCE(pp.longevity_rating, 0) / 10.0
		+ COALESCE(pp.sillage_rating, 0) / 10.0
	  ) / 2.0
	)
	*
	(
	  (
		(1 - EXP(-COALESCE(pp.longevity_votes, 0)::float / 500.0))
		+ (1 - EXP(-COALESCE(pp.sillage_votes, 0)::float / 500.0))
	  ) / 2.0
	) AS perf_score01
  FROM candidates c
  LEFT JOIN perfume_performance pp ON pp.perfume_id = c.id
),

-- DNA overlap + top shared tokens for explanations
dna_overlap AS (
  SELECT
	c.id AS perfume_id,

	-- Shared weighted overlap for notes
	CASE
	  WHEN d.dna IS NULL THEN 0
	  ELSE COALESCE((
		SELECT SUM(LEAST((elem->>'w')::float, COALESCE((un.m->>(elem->>'t'))::float, 0)))
		FROM user_notes un
		CROSS JOIN LATERAL jsonb_array_elements(d.dna->'notes') elem
		WHERE COALESCE((un.m->>(elem->>'t'))::float, 0) > 0
	  ), 0)
	END AS shared_notes_w,

	-- Shared weighted overlap for accords
	CASE
	  WHEN d.dna IS NULL THEN 0
	  ELSE COALESCE((
		SELECT SUM(LEAST((elem->>'w')::float, COALESCE((ua.m->>(elem->>'t'))::float, 0)))
		FROM user_accords ua
		CROSS JOIN LATERAL jsonb_array_elements(d.dna->'accords') elem
		WHERE COALESCE((ua.m->>(elem->>'t'))::float, 0) > 0
	  ), 0)
	END AS shared_accords_w,

	-- Top shared notes (for UI)
	CASE
	  WHEN d.dna IS NULL THEN '[]'::jsonb
	  ELSE COALESCE((
		SELECT jsonb_agg(s.token ORDER BY s.shared DESC)
		FROM (
		  SELECT
			(elem->>'t') AS token,
			LEAST((elem->>'w')::float, COALESCE((un.m->>(elem->>'t'))::float, 0)) AS shared
		  FROM user_notes un
		  CROSS JOIN LATERAL jsonb_array_elements(d.dna->'notes') elem
		  WHERE COALESCE((un.m->>(elem->>'t'))::float, 0) > 0
			AND LEAST((elem->>'w')::float, COALESCE((un.m->>(elem->>'t'))::float, 0)) > 0
		  ORDER BY LEAST((elem->>'w')::float, COALESCE((un.m->>(elem->>'t'))::float, 0)) DESC
		  LIMIT 3
		) s
	  ), '[]'::jsonb)
	END AS shared_notes_top3,

	-- Top shared accords (for UI)
	CASE
	  WHEN d.dna IS NULL THEN '[]'::jsonb
	  ELSE COALESCE((
		SELECT jsonb_agg(s.token ORDER BY s.shared DESC)
		FROM (
		  SELECT
			(elem->>'t') AS token,
			LEAST((elem->>'w')::float, COALESCE((ua.m->>(elem->>'t'))::float, 0)) AS shared
		  FROM user_accords ua
		  CROSS JOIN LATERAL jsonb_array_elements(d.dna->'accords') elem
		  WHERE COALESCE((ua.m->>(elem->>'t'))::float, 0) > 0
			AND LEAST((elem->>'w')::float, COALESCE((ua.m->>(elem->>'t'))::float, 0)) > 0
		  ORDER BY LEAST((elem->>'w')::float, COALESCE((ua.m->>(elem->>'t'))::float, 0)) DESC
		  LIMIT 3
		) s
	  ), '[]'::jsonb)
	END AS shared_accords_top3

  FROM candidates c
  LEFT JOIN perfume_dna d ON d.perfume_id = c.id
),

-- Determine which liked perfume this candidate is most similar to (for "because similar to X")
because AS (
  SELECT
	c.id AS perfume_id,
	b.liked_id,
	b.dist
  FROM candidates c
  JOIN LATERAL (
	SELECT
	  l.perfume_id AS liked_id,
	  (c.vector <=> le.vector) AS dist
	FROM liked l
	JOIN perfume_embeddings le ON le.perfume_id = l.perfume_id
	ORDER BY c.vector <=> le.vector
	LIMIT 1
  ) b ON true
),

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

	-- 0..1 similarity (clamped), assuming reasonably normalized vectors
	GREATEST(0.0, LEAST(1.0, 1.0 - (c.cosine_distance / 2.0))) AS sim01,

	-- DNA overlap 0..1 (normalize by user totals; if missing or zero totals, return 0)
	COALESCE(
	  0.6 * (COALESCE(dna.shared_notes_w, 0) / NULLIF(un.total_w, 0))
	  + 0.4 * (COALESCE(dna.shared_accords_w, 0) / NULLIF(ua.total_w, 0)),
	  0
	) AS dna01,

	-- Wardrobe affinity 0..1 (simple saturation)
	LEAST(1.0, COALESCE(w.ward_sum_log, 0) / 5.0) AS ward01,

	-- Rating quality 0..1
	(
	  COALESCE(c.rating, 0) / 5.0
	  * (1.0 - EXP(-COALESCE(c.total_votes, 0)::float / 500.0))
	) AS qual01,

	-- Performance score 0..1 (already includes confidence)
	COALESCE(pf.perf_score01, 0) AS perf01,

	-- Explanation payload pieces
	bc.liked_id AS because_similar_to,
	COALESCE(dna.shared_notes_top3, '[]'::jsonb) AS why_shared_notes,
	COALESCE(dna.shared_accords_top3, '[]'::jsonb) AS why_shared_accords,
	COALESCE((SELECT jsonb_agg(x) FROM jsonb_array_elements(COALESCE(w.ward_pairs,'[]'::jsonb)) x LIMIT 2), '[]'::jsonb)
	  AS why_wardrobe_top2,
	CASE
	  WHEN pf.longevity_rating IS NOT NULL OR pf.sillage_rating IS NOT NULL THEN
		jsonb_build_object(
		  'longevity', pf.longevity_rating,
		  'longevity_votes', pf.longevity_votes,
		  'sillage', pf.sillage_rating,
		  'sillage_votes', pf.sillage_votes
		)
	  ELSE NULL
	END AS why_performance

  FROM candidates c
  CROSS JOIN user_notes un
  CROSS JOIN user_accords ua
  LEFT JOIN wardrobe w ON w.perfume_id = c.id
  LEFT JOIN perf pf ON pf.perfume_id = c.id
  LEFT JOIN dna_overlap dna ON dna.perfume_id = c.id
  LEFT JOIN because bc ON bc.perfume_id = c.id
),

ranked AS (
  SELECT
	s.id,
	s.name,
	s.brand,
	s.year,
	s.description,
	s.perfumer,
	s.gender,
	s.accords,
	s.notes_all,
	s.sim01,
	s.dna01,
	s.ward01,
	s.qual01,
	s.perf01,
	s.because_similar_to,
	s.why_shared_notes,
	s.why_shared_accords,
	s.why_wardrobe_top2,
	s.why_performance,

	-- Final weighted score (0..1-ish)
	(
	  0.45 * s.sim01
	  + 0.20 * s.dna01
	  + 0.25 * s.ward01
	  + 0.07 * s.qual01
	  + 0.03 * s.perf01
	) AS final_score,

	ROW_NUMBER() OVER (PARTITION BY s.brand ORDER BY
	  (
		0.45 * s.sim01
		+ 0.20 * s.dna01
		+ 0.25 * s.ward01
		+ 0.07 * s.qual01
		+ 0.03 * s.perf01
	  ) DESC
	) AS brand_rank
  FROM scored s
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
  final_score,
  jsonb_build_object(
	'sim', sim01,
	'dna', dna01,
	'ward', ward01,
	'qual', qual01,
	'perf', perf01
  ) AS signals,
  jsonb_build_object(
	'because_similar_to', because_similar_to,
	'shared_notes', why_shared_notes,
	'shared_accords', why_shared_accords,
	'wardrobe', why_wardrobe_top2,
	'performance', why_performance
  ) AS why
FROM ranked
WHERE brand_rank = 1
ORDER BY final_score DESC
LIMIT $2::int;
