import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import {
  getPerfumeDnaCard,
  findPerfumeClones,
} from "../services/recommendationService";
import { searchPerfumes } from "../database/queries";
import { ValidationError, NotFoundError } from "../lib/errorHandler";
import { logger } from "../lib/logger";

const router = Router();

/**
 * @swagger
 * /api/v1/perfumes/{id}/dna:
 *   get:
 *     summary: Get DNA card for a single perfume
 *     description: Returns top 3 families, all accords, and all notes with weights/percentages
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
router.get(
  "/:id/dna",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const perfumeId = parseInt(req.params.id, 10);

      if (!Number.isInteger(perfumeId) || perfumeId <= 0) {
        throw new ValidationError(
          "Invalid perfume ID. Must be a positive integer.",
          req.requestId
        );
      }

      // Check if perfume exists
      const { pool } = await import("../database/pool");
      const checkResult = await pool.query(
        "SELECT id FROM perfumes WHERE id = $1",
        [perfumeId]
      );

      if (checkResult.rows.length === 0) {
        throw new NotFoundError(
          `Perfume with ID ${perfumeId} not found`,
          req.requestId
        );
      }

      const dnaCard = await getPerfumeDnaCard(perfumeId);

      res.json({
        data: dnaCard,
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
        perfumeId: req.params.id,
      };

      if (error instanceof Error && "code" in error) {
        errorDetails.dbCode = (error as { code?: string }).code;
      }
      if (error instanceof Error && "detail" in error) {
        errorDetails.dbDetail = (error as { detail?: string }).detail;
      }

      logger.error(errorDetails, "Error fetching perfume DNA card");
      next(error);
    }
  }
);

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
 *                 target_perfume_id:
 *                   type: integer
 *                   description: ID of the target perfume clones were found for
 *                   example: 84109
 *                 results:
 *                   type: array
 *                   description: Array of clone recommendations matching RecommendationResult format
 *                   items:
 *                     $ref: '#/components/schemas/RecommendationResult'
 *                 meta:
 *                   type: object
 *                   properties:
 *                     requestId:
 *                       type: string
 *                       description: Unique request identifier
 *             example:
 *               target_perfume_id: 84109
 *               results:
 *                 - id: 94713
 *                   name: "Liquid Brun"
 *                   brand: "French Avenue"
 *                   year: 2024
 *                   description: "A sophisticated clone..."
 *                   perfumer: null
 *                   gender: "male"
 *                   accords: ["sweet", "warm spicy", "vanilla"]
 *                   notes: ["cinnamon", "orange blossom", "cardamom", "vanilla"]
 *                   image: "https://fimgs.net/mdimg/perfume-thumbs/375x500.94713.2x.avif"
 *                   score: 0.923
 *                   signals:
 *                     sim: 0.912
 *                     dna: 0.917
 *                     ward: 0.644
 *                     qual: 0.78
 *                     perf: 0.65
 *                   why:
 *                     because_similar_to: 84109
 *                     shared_notes: ["cinnamon", "orange blossom", "cardamom", "vanilla"]
 *                     shared_accords: ["sweet", "warm spicy", "vanilla"]
 *                     wardrobe:
 *                       - liked_id: 84109
 *                         co_count: 24
 *                     performance:
 *                       longevity: 8.5
 *                       longevity_votes: 120
 *                       sillage: 7.8
 *                       sillage_votes: 115
 *                   dna_card:
 *                     families:
 *                       - name: "Amber"
 *                         weight: 1.0
 *                       - name: "Gourmand"
 *                         weight: 0.8
 *                     accords:
 *                       - name: "sweet"
 *                         weight: 0.25
 *                         percentage: 25.0
 *                       - name: "warm spicy"
 *                         weight: 0.18
 *                         percentage: 18.0
 *                     notes:
 *                       - name: "vanilla"
 *                         weight: 0.22
 *                         percentage: 22.0
 *                       - name: "cinnamon"
 *                         weight: 0.15
 *                         percentage: 15.0
 *               meta:
 *                 requestId: "abc123"
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.post(
  "/clonefinder",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { perfume_id, limit = 3 } = req.body;

      if (!perfume_id) {
        throw new ValidationError("perfume_id is required", req.requestId);
      }

      const perfumeId = parseInt(String(perfume_id), 10);
      if (!Number.isInteger(perfumeId) || perfumeId <= 0) {
        throw new ValidationError(
          "Invalid perfume_id. Must be a positive integer.",
          req.requestId
        );
      }

      const validLimit = Math.min(
        Math.max(1, parseInt(String(limit), 10) || 3),
        10
      );

      const clones = await findPerfumeClones(perfumeId, validLimit);

      res.json({
        target_perfume_id: perfumeId,
        results: clones,
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

      logger.error(errorDetails, "Error finding perfume clones");
      next(error);
    }
  }
);

/**
 * @swagger
 * /api/v1/perfumes/search:
 *   get:
 *     summary: Search perfumes
 *     description: |
 *       Search with full-text matching, filtering, and pagination.
 *       Searches across perfume name, brand, and description.
 *       Supports filtering by brand, gender, year range, and minimum rating.
 *       Returns 15 results per page by default.
 *     tags: [Perfumes]
 *     parameters:
 *       - in: query
 *         name: q
 *         schema:
 *           type: string
 *         description: Search query (searches name, brand, description)
 *         example: "sauvage"
 *       - in: query
 *         name: brands
 *         schema:
 *           type: array
 *           items:
 *             type: string
 *         style: form
 *         explode: true
 *         description: Filter by brands (comma-separated or multiple)
 *         example: ["Dior", "Creed"]
 *       - in: query
 *         name: gender
 *         schema:
 *           type: array
 *           items:
 *             type: string
 *             enum: [male, female, unisex]
 *         style: form
 *         explode: true
 *         description: Filter by gender
 *         example: ["male"]
 *       - in: query
 *         name: min_year
 *         schema:
 *           type: integer
 *         description: Minimum release year
 *         example: 2020
 *       - in: query
 *         name: max_year
 *         schema:
 *           type: integer
 *         description: Maximum release year
 *         example: 2024
 *       - in: query
 *         name: min_rating
 *         schema:
 *           type: number
 *           minimum: 0
 *           maximum: 5
 *         description: Minimum rating (0-5)
 *         example: 4.0
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 50
 *           default: 15
 *         description: Number of results per page
 *         example: 15
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           minimum: 0
 *           default: 0
 *         description: Pagination offset
 *         example: 0
 *       - in: query
 *         name: sort_by
 *         schema:
 *           type: string
 *           enum: [relevance, rating, year, name]
 *           default: relevance
 *         description: Sort order
 *         example: relevance
 *     responses:
 *       200:
 *         description: Search results
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     results:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: integer
 *                           name:
 *                             type: string
 *                           brand:
 *                             type: string
 *                           image:
 *                             type: string
 *                             format: uri
 *                           relevance_score:
 *                             type: number
 *                             description: Relevance score (higher = more relevant)
 *                     pagination:
 *                       type: object
 *                       properties:
 *                         total:
 *                           type: integer
 *                           description: Total number of results
 *                         limit:
 *                           type: integer
 *                         offset:
 *                           type: integer
 *                         has_more:
 *                           type: boolean
 *                 meta:
 *                   type: object
 *                   properties:
 *                     requestId:
 *                       type: string
 *             example:
 *               data:
 *                 results:
 *                   - id: 56324
 *                     name: "Sauvage Parfum"
 *                     brand: "Dior"
 *                     image: "https://fimgs.net/mdimg/perfume-thumbs/375x500.56324.2x.avif"
 *                     relevance_score: 100.0
 *                   - id: 75805
 *                     name: "Sauvage"
 *                     brand: "Dior"
 *                     image: "https://fimgs.net/mdimg/perfume-thumbs/375x500.75805.2x.avif"
 *                     relevance_score: 50.0
 *                 pagination:
 *                   total: 42
 *                   limit: 15
 *                   offset: 0
 *                   has_more: true
 *               meta:
 *                 requestId: "abc123"
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
const searchSchema = z.object({
  q: z.string().optional(),
  brands: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((val) => {
      if (!val) return undefined;
      if (typeof val === "string") {
        return val
          .split(",")
          .map((b) => b.trim())
          .filter(Boolean);
      }
      return val;
    }),
  gender: z
    .union([
      z.enum(["male", "female", "unisex"]),
      z.array(z.enum(["male", "female", "unisex"])),
    ])
    .optional()
    .transform((val) => {
      if (!val) return undefined;
      return Array.isArray(val) ? val : [val];
    }),
  min_year: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : undefined)),
  max_year: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : undefined)),
  min_rating: z
    .string()
    .optional()
    .transform((val) => (val ? parseFloat(val) : undefined)),
  limit: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 15)),
  offset: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 0)),
  sort_by: z
    .enum(["relevance", "rating", "year", "name"])
    .optional()
    .default("relevance"),
});

router.get(
  "/search",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const validationResult = searchSchema.safeParse(req.query);

      if (!validationResult.success) {
        throw new ValidationError(
          `Invalid search parameters: ${validationResult.error.issues
            .map((issue) => issue.message)
            .join(", ")}`,
          req.requestId
        );
      }

      const params = validationResult.data;
      const results = await searchPerfumes({
        query: params.q,
        brands: params.brands,
        gender: params.gender,
        min_year: params.min_year,
        max_year: params.max_year,
        min_rating: params.min_rating,
        limit: params.limit,
        offset: params.offset,
        sort_by: params.sort_by,
      });

      // Extract pagination info from first result (all have same total_count)
      const total = results.length > 0 ? results[0].total_count : 0;
      const limit = params.limit || 15;
      const offset = params.offset || 0;
      const hasMore = offset + results.length < total;

      // Remove total_count and relevance_score from response (keep only id, name, image)
      const formattedResults = results.map((r) => ({
        id: r.id,
        name: r.name,
        brand: r.brand,
        image: r.image,
      }));

      res.json({
        data: {
          results: formattedResults,
          pagination: {
            total,
            limit,
            offset,
            has_more: hasMore,
          },
        },
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
        query: req.query,
        url: req.url,
      };

      // Add database-specific error details
      if (error instanceof Error && "code" in error) {
        errorDetails.dbCode = (error as { code?: string }).code;
      }
      if (error instanceof Error && "detail" in error) {
        errorDetails.dbDetail = (error as { detail?: string }).detail;
      }
      if (error instanceof Error && "hint" in error) {
        errorDetails.dbHint = (error as { hint?: string }).hint;
      }

      logger.error(errorDetails, "Error searching perfumes");
      next(error);
    }
  }
);

export default router;
