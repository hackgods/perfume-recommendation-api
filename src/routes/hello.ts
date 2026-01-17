import { Router, Request, Response } from "express";

const router = Router();

const startTime = Date.now();

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
