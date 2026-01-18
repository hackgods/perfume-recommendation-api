import { Router, Request, Response, NextFunction } from "express";
import { getPerfumeDnaCard } from "../services/recommendationService";
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

export default router;
