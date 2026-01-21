import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import {
  getSimilarPerfumesRecommendations,
  getUserTasteFingerprint,
} from "../services/recommendationService";
import { ValidationError, NotFoundError } from "../lib/errorHandler";
import { logger } from "../lib/logger";

const router = Router();

/**
 * @swagger
 * /api/v1/perfumes/recommend:
 *   post:
 *     summary: Get similar perfume recommendations
 *     description: |
 *       Hybrid recommendation system that combines multiple signals:
 *       - Semantic similarity using vector embeddings (45% weight)
 *       - DNA overlap (shared notes/accords) (20% weight)
 *       - Wardrobe co-occurrence (25% weight)
 *       - Rating quality (7% weight)
 *       - Performance metrics (3% weight)
 *
 *       Features:
 *       - Brand diversification (max 1 perfume per brand by default)
 *       - Explainable recommendations with "why" payload
 *       - Gender filtering support
 *       - Handles missing DNA/performance data gracefully
 *     tags: [Perfumes]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/SimilarPerfumesRequest'
 *           example:
 *             liked_perfume_ids: [42260, 75805, 52802]
 *             limit: 10
 *             diversify_brand: true
 *             gender: "male"
 *     responses:
 *       200:
 *         description: Successful recommendation
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SimilarPerfumesResponseWrapper'
 *             example:
 *               data:
 *                 liked_count: 3
 *                 results:
 *                   - id: 56324
 *                     name: "Sauvage Parfum"
 *                     brand: "Dior"
 *                     year: 2019
 *                     description: "A modern fougère fragrance..."
 *                     perfumer: "François Demachy"
 *                     gender: "male"
 *                     accords: ["amber", "warm spicy", "woody"]
 *                     notes: ["vanilla", "lavender", "sandalwood"]
 *                     image: "https://fimgs.net/mdimg/perfume-thumbs/375x500.56324.2x.avif"
 *                     score: 0.823
 *                     signals:
 *                       sim: 0.9
 *                       dna: 0.74
 *                       ward: 0.62
 *                       qual: 0.58
 *                       perf: 0.41
 *                     why:
 *                       because_similar_to: 75805
 *                       shared_notes: ["vanilla", "lavender", "sandalwood"]
 *                       shared_accords: ["amber", "warm spicy", "woody"]
 *                       wardrobe:
 *                         - liked_id: 75805
 *                           co_count: 9
 *                       performance:
 *                         longevity: 8.4
 *                         longevity_votes: 150
 *                         sillage: 7.9
 *                         sillage_votes: 142
 *                     dna_card:
 *                       families:
 *                         - name: "Amber"
 *                           weight: 1.0
 *                         - name: "Woody"
 *                           weight: 1.0
 *                       accords:
 *                         - name: "amber"
 *                           weight: 0.18
 *                           percentage: 18.0
 *                         - name: "warm spicy"
 *                           weight: 0.14
 *                           percentage: 14.0
 *                       notes:
 *                         - name: "vanilla"
 *                           weight: 0.20
 *                           percentage: 20.0
 *                         - name: "lavender"
 *                           weight: 0.15
 *                           percentage: 15.0
 *                 fingerprint:
 *                   summary: "You like amber and woody scents with vanilla and lavender, warm and resinous."
 *                   families:
 *                     - name: "Amber"
 *                       percentage: 32.0
 *                     - name: "Woody"
 *                       percentage: 21.0
 *                   accords:
 *                     - name: "amber"
 *                       percentage: 22.0
 *                     - name: "warm spicy"
 *                       percentage: 16.0
 *                   notes:
 *                     - name: "vanilla"
 *                       percentage: 25.0
 *                     - name: "lavender"
 *                       percentage: 15.0
 *                   missing:
 *                     - category: "family"
 *                       name: "fresh"
 *                       suggestion: "You have almost no fresh citrus. Try one clean summer signature."
 *               meta:
 *                 requestId: "ebf4baa4-728d-422c-9cf4-7c763cef9349"
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
const similarPerfumesSchema = z.object({
  liked_perfume_ids: z
    .array(z.number().int().positive())
    .min(1)
    .max(10),
  limit: z.number().int().positive().max(20).default(10).optional(),
  diversify_brand: z.boolean().default(true).optional(),
  min_votes: z.number().int().nonnegative().default(0).optional(),
  prefer_longlasting: z.boolean().default(false).optional(),
  prefer_soft_projection: z.boolean().default(false).optional(),
  gender: z.enum(["male", "female", "unisex"]).optional(),
});

router.post("/recommend", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validationResult = similarPerfumesSchema.safeParse(req.body);

    if (!validationResult.success) {
      throw new ValidationError(
        `Invalid request: ${validationResult.error.issues.map((issue) => issue.message).join(", ")}`,
        req.requestId
      );
    }

    const request = validationResult.data;
    const result = await getSimilarPerfumesRecommendations(
      request,
      req.requestId
    );

    res.json({
      data: result,
      meta: {
        requestId: req.requestId,
      },
    });
  } catch (error) {
    const errorDetails: Record<string, unknown> = {
      requestId: req.requestId,
      error: error instanceof Error ? error.message : String(error),
      errorName: error instanceof Error ? error.name : "UnknownError",
      stack: error instanceof Error ? error.stack : undefined,
      body: req.body,
    };

    if (error instanceof Error && "code" in error) {
      errorDetails.dbCode = (error as { code?: string }).code;
    }
    if (error instanceof Error && "detail" in error) {
      errorDetails.dbDetail = (error as { detail?: string }).detail;
    }
    if (error instanceof Error && "hint" in error) {
      errorDetails.dbHint = (error as { hint?: string }).hint;
    }

    logger.error(errorDetails, "Error in similar perfumes recommendation");
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/perfumes/fingerprint:
 *   post:
 *     summary: Get user taste fingerprint
 *     description: |
 *       Aggregates DNA from liked perfumes to create a taste profile including:
 *       - Dynamic taste summary
 *       - Top families, accords, and notes with percentages
 *       - Missing suggestions (categories with < 5% representation)
 *     tags: [Perfumes]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [liked_perfume_ids]
 *             properties:
 *               liked_perfume_ids:
 *                 type: array
 *                 items:
 *                   type: number
 *                 minItems: 1
 *                 maxItems: 10
 *                 description: Array of 1-10 perfume IDs that the user likes
 *                 example: [42260, 75805, 52802]
 *           example:
 *             liked_perfume_ids: [42260, 75805, 52802]
 *     responses:
 *       200:
 *         description: Fingerprint retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   $ref: '#/components/schemas/TasteFingerprint'
 *                 meta:
 *                   type: object
 *                   properties:
 *                     requestId:
 *                       type: string
 *             example:
 *               data:
 *                 summary: "You like gourmand and amber scents with vanilla and tonka, warm and cozy."
 *                 families:
 *                   - name: "Amber"
 *                     percentage: 32.0
 *                   - name: "Gourmand"
 *                     percentage: 21.0
 *                 accords:
 *                   - name: "vanilla"
 *                     percentage: 22.0
 *                   - name: "amber"
 *                     percentage: 16.0
 *                 notes:
 *                   - name: "vanilla"
 *                     percentage: 25.0
 *                   - name: "tonka bean"
 *                     percentage: 15.0
 *                 missing:
 *                   - category: "family"
 *                     name: "fresh"
 *                     suggestion: "You have almost no fresh citrus. Try one clean summer signature."
 *               meta:
 *                 requestId: "ebf4baa4-728d-422c-9cf4-7c763cef9349"
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
const fingerprintSchema = z.object({
  liked_perfume_ids: z
    .array(z.number().int().positive())
    .min(1)
    .max(10),
});

router.post("/fingerprint", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validationResult = fingerprintSchema.safeParse(req.body);

    if (!validationResult.success) {
      throw new ValidationError(
        `Invalid request: ${validationResult.error.issues.map((issue) => issue.message).join(", ")}`,
        req.requestId
      );
    }

    const { liked_perfume_ids } = validationResult.data;

    // Validate perfume IDs exist
    const { pool } = await import("../database/pool");
    const uniqueIds = [...new Set(liked_perfume_ids)];
    const perfumeIds = uniqueIds.map((id) => Number(id));

    if (perfumeIds.some((id) => !Number.isInteger(id) || id <= 0)) {
      throw new ValidationError("All perfume IDs must be positive integers", req.requestId);
    }

    const checkQuery = `SELECT id FROM perfumes WHERE id = ANY($1::bigint[])`;
    const checkResult = await pool.query(checkQuery, [perfumeIds]);

    if (checkResult.rows.length !== perfumeIds.length) {
      const foundIds = new Set(checkResult.rows.map((r: { id: number }) => r.id));
      const missingIds = perfumeIds.filter((id) => !foundIds.has(id));
      throw new NotFoundError(
        `Perfume IDs not found: ${missingIds.join(", ")}`,
        req.requestId
      );
    }

    const fingerprint = await getUserTasteFingerprint(perfumeIds);

    if (!fingerprint) {
      throw new NotFoundError(
        "Could not generate fingerprint. Ensure all perfumes have DNA data.",
        req.requestId
      );
    }

    res.json({
      data: fingerprint,
      meta: {
        requestId: req.requestId,
      },
    });
  } catch (error) {
    const errorDetails: Record<string, unknown> = {
      requestId: req.requestId,
      error: error instanceof Error ? error.message : String(error),
      errorName: error instanceof Error ? error.name : "UnknownError",
      stack: error instanceof Error ? error.stack : undefined,
      body: req.body,
    };

    if (error instanceof Error && "code" in error) {
      errorDetails.dbCode = (error as { code?: string }).code;
    }
    if (error instanceof Error && "detail" in error) {
      errorDetails.dbDetail = (error as { detail?: string }).detail;
    }
    if (error instanceof Error && "hint" in error) {
      errorDetails.dbHint = (error as { hint?: string }).hint;
    }

    logger.error(errorDetails, "Error generating user taste fingerprint");
    next(error);
  }
});

export default router;
