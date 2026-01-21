import express, { Express } from "express";
import dotenv from "dotenv";
import pinoHttp from "pino-http";
import swaggerUi from "swagger-ui-express";
import { logger, requestIdMiddleware } from "./lib/logger";
import { errorHandler } from "./lib/errorHandler";
import { swaggerSpec } from "./config/swagger";
import healthRouter from "./routes/health";
import recommendationsRouter from "./routes/recommendations";
import perfumesRouter from "./routes/perfumes";

dotenv.config();

const app: Express = express();
const PORT: number = Number(process.env.PORT) || 4000;

app.use(requestIdMiddleware);
app.use((req, _res, next) => {
  req.startTime = Date.now();
  next();
});
app.use(pinoHttp({ logger }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  const origin = req.headers.origin;
  
  // Default allowed origins (production + localhost for dev)
  const defaultOrigins = [
    "https://perfumes.saurabhsuresh.com",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
  ];
  
  // Allow additional origins from environment variable
  const envOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
    : [];
  
  const allowedOrigins = [...defaultOrigins, ...envOrigins];

  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }

  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, DELETE, OPTIONS"
  );
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }

  next();
});

app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.get("/api-docs.json", (_req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.send(swaggerSpec);
});

app.use("/api/v1", healthRouter);
app.use("/api/v1/perfumes", recommendationsRouter);
app.use("/api/v1/perfumes", perfumesRouter);

app.use(errorHandler);

process.on(
  "unhandledRejection",
  (reason: unknown, _promise: Promise<unknown>) => {
    logger.error(
      {
        reason: reason instanceof Error ? reason.message : String(reason),
        stack: reason instanceof Error ? reason.stack : undefined,
      },
      "Unhandled promise rejection"
    );
  }
);

process.on("uncaughtException", (error: Error) => {
  logger.error(
    {
      error: error.message,
      stack: error.stack,
    },
    "Uncaught exception"
  );
  process.exit(1);
});

app.listen(PORT, "0.0.0.0", () => {
  logger.info({ port: PORT, host: "0.0.0.0" }, "Server started");
});
