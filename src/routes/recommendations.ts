import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { getSimilarPerfumesRecommendations } from "../services/recommendationService";
import { ValidationError } from "../lib/errorHandler";
import { logger } from "../lib/logger";

const router = Router();

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
