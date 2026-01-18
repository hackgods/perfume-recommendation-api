import { Router, Request, Response, NextFunction } from "express";
import { getPerfumeDnaCard, findPerfumeClones } from "../services/recommendationService";
import { ValidationError, NotFoundError } from "../lib/errorHandler";
import { logger } from "../lib/logger";

const router = Router();

/**
 * @swagger
 * /api/v1/perfumes/{id}/dna:
 *   get:
 *     summary: Get DNA card for a single perfume
 *     description: Returns top 3 families, top 5 accords, and top 5 notes with weights/percentages
 *     tags: [Perfumes]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Perfume ID
 *         example: 56324
 *     responses:
 *       200:
 *         description: DNA card retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   $ref: '#/components/schemas/DnaCard'
 *                 meta:
 *                   type: object
 *                   properties:
 *                     requestId:
 *                       type: string
 *             example:
 *               data:
 *                 families:
 *                   - name: "Amber"
 *                     weight: 1.0
 *                   - name: "Gourmand"
 *                     weight: 1.0
 *                   - name: "Woody"
 *                     weight: 1.0
 *                 accords:
 *                   - name: "vanilla"
 *                     weight: 0.18
 *                     percentage: 18.0
 *                   - name: "amber"
 *                     weight: 0.14
 *                     percentage: 14.0
 *                 notes:
 *                   - name: "vanilla"
 *                     weight: 0.20
 *                     percentage: 20.0
 *                   - name: "benzoin"
 *                     weight: 0.12
 *                     percentage: 12.0
 *               meta:
 *                 requestId: "ebf4baa4-728d-422c-9cf4-7c763cef9349"
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.get("/:id/dna", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const perfumeId = parseInt(req.params.id, 10);

    if (!Number.isInteger(perfumeId) || perfumeId <= 0) {
      throw new ValidationError("Invalid perfume ID. Must be a positive integer.", req.requestId);
    }

    // Check if perfume exists
    const { pool } = await import("../database/pool");
    const checkResult = await pool.query("SELECT id FROM perfumes WHERE id = $1", [perfumeId]);

    if (checkResult.rows.length === 0) {
      throw new NotFoundError(`Perfume with ID ${perfumeId} not found`, req.requestId);
    }

    const dnaCard = await getPerfumeDnaCard(perfumeId);

    res.json({
      data: dnaCard,
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
      "Error fetching perfume DNA card"
    );
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/perfumes/clonefinder:
 *   post:
 *     summary: Find top 3 clones of a given perfume
 *     description: |
 *       Uses advanced multi-signal analysis to find the best clones:
 *       - Embedding similarity (vector embeddings)
 *       - DNA overlap (notes and accords)
 *       - Wardrobe co-occurrence (users who own both)
 *       - Performance similarity (longevity and sillage)
 *       - Family overlap bonus
 *       
 *       Returns clones with confidence levels (very_high, high, medium, low)
 *     tags: [Perfumes]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - perfume_id
 *             properties:
 *               perfume_id:
 *                 type: integer
 *                 description: ID of the target perfume to find clones for
 *                 example: 84109
 *               limit:
 *                 type: integer
 *                 description: Number of clones to return (default 3, max 10)
 *                 minimum: 1
 *                 maximum: 10
 *                 default: 3
 *                 example: 3
 *           examples:
 *             findClones:
 *               summary: Find clones for PDM Althair
 *               value:
 *                 perfume_id: 84109
 *                 limit: 3
 *     responses:
 *       200:
 *         description: Clones found successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: integer
 *                       name:
 *                         type: string
 *                       brand:
 *                         type: string
 *                       year:
 *                         type: integer
 *                       description:
 *                         type: string
 *                       perfumer:
 *                         type: string
 *                       gender:
 *                         type: string
 *                       accords:
 *                         type: array
 *                         items:
 *                           type: string
 *                       notes_all:
 *                         type: array
 *                         items:
 *                           type: string
 *                       rating:
 *                         type: number
 *                       total_votes:
 *                         type: integer
 *                       clone_score:
 *                         type: number
 *                         description: Overall clone similarity score (0-1)
 *                       confidence:
 *                         type: string
 *                         enum: [very_high, high, medium, low]
 *                         description: Confidence level that this is a clone
 *                       image:
 *                         type: string
 *                         format: uri
 *                       signals:
 *                         type: object
 *                         properties:
 *                           embedding_sim:
 *                             type: number
 *                             description: Vector embedding similarity (0-1)
 *                           dna_overlap:
 *                             type: number
 *                             description: DNA overlap score (0-1)
 *                           wardrobe_score:
 *                             type: number
 *                             description: Wardrobe co-occurrence score (0-1)
 *                           performance_sim:
 *                             type: number
 *                             description: Performance similarity (0-1)
 *                           family_bonus:
 *                             type: number
 *                             description: Bonus for shared families
 *                       why:
 *                         type: object
 *                         properties:
 *                           shared_notes:
 *                             type: array
 *                             items:
 *                               type: string
 *                           shared_accords:
 *                             type: array
 *                             items:
 *                               type: string
 *                           wardrobe_co_occur:
 *                             type: integer
 *                             description: Number of users who own both perfumes
 *                           performance:
 *                             type: object
 *                             nullable: true
 *                             properties:
 *                               longevity:
 *                                 type: number
 *                               sillage:
 *                                 type: number
 *                               longevity_votes:
 *                                 type: integer
 *                               sillage_votes:
 *                                 type: integer
 *                 meta:
 *                   type: object
 *                   properties:
 *                     requestId:
 *                       type: string
 *                     target_perfume_id:
 *                       type: integer
 *             example:
 *               data:
 *                 - id: 94713
 *                   name: "Liquid Brun"
 *                   brand: "French Avenue"
 *                   year: 2024
 *                   clone_score: 0.923
 *                   confidence: "very_high"
 *                   signals:
 *                     embedding_sim: 0.912
 *                     dna_overlap: 0.917
 *                     wardrobe_score: 0.644
 *                     performance_sim: 0.78
 *                     family_bonus: 0.1
 *                   why:
 *                     shared_notes: ["cinnamon", "orange blossom", "cardamom", "vanilla"]
 *                     shared_accords: ["sweet", "warm spicy", "vanilla"]
 *                     wardrobe_co_occur: 24
 *               meta:
 *                 requestId: "abc123"
 *                 target_perfume_id: 84109
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.post("/clonefinder", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { perfume_id, limit = 3 } = req.body;

    if (!perfume_id) {
      throw new ValidationError("perfume_id is required", req.requestId);
    }

    const perfumeId = parseInt(String(perfume_id), 10);
    if (!Number.isInteger(perfumeId) || perfumeId <= 0) {
      throw new ValidationError("Invalid perfume_id. Must be a positive integer.", req.requestId);
    }

    const validLimit = Math.min(Math.max(1, parseInt(String(limit), 10) || 3), 10);

    const clones = await findPerfumeClones(perfumeId, validLimit);

    res.json({
      data: clones,
      meta: {
        requestId: req.requestId,
        target_perfume_id: perfumeId,
      },
    });
  } catch (error) {
    logger.error(
      {
        requestId: req.requestId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
      "Error finding perfume clones"
    );
    next(error);
  }
});

export default router;
