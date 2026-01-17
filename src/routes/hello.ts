import { Router, Request, Response } from "express";

const router = Router();

const startTime = Date.now();

/**
 * @swagger
 * /api/v1/health:
 *   get:
 *     summary: Health check endpoint
 *     description: Returns server health status, current time, response time, and server uptime
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Server is healthy
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/HealthResponse'
 *             example:
 *               data:
 *                 status: "healthy"
 *                 currentTime: "2024-01-15T10:30:00.000Z"
 *                 responseTimeMs: 5
 *                 uptimeMs: 3600000
 *               meta:
 *                 requestId: "ebf4baa4-728d-422c-9cf4-7c763cef9349"
 */
router.get("/health", (req: Request, res: Response) => {
  const requestStartTime = req.startTime || Date.now();
  const responseTime = Date.now() - requestStartTime;
  const currentTime = new Date().toISOString();

  res.json({
    data: {
      status: "healthy",
      currentTime,
      responseTimeMs: responseTime,
      uptimeMs: Date.now() - startTime,
    },
    meta: {
      requestId: req.requestId,
    },
  });
});

export default router;
