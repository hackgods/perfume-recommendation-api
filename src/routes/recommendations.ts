import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { getSimilarPerfumesRecommendations } from "../services/recommendationService";
import { ValidationError } from "../lib/errorHandler";
import { logger } from "../lib/logger";

const router = Router();

/**
 * @swagger
 * /api/v1/recommendations/similar:
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
 *     tags: [Recommendations]
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

router.post("/similar", async (req: Request, res: Response, next: NextFunction) => {
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
    logger.error(
      {
        requestId: req.requestId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
      "Error in similar perfumes recommendation"
    );
    next(error);
  }
});

export default router;
