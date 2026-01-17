import express, { Express } from "express";
import dotenv from "dotenv";
import pinoHttp from "pino-http";
import { logger, requestIdMiddleware } from "./lib/logger";
import { errorHandler } from "./lib/errorHandler";
import healthRouter from "./routes/hello";

dotenv.config();

const app: Express = express();
const PORT = process.env.PORT || 3000;

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
  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(",")
    : [];

  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }

  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }

  next();
});

app.use("/api/v1", healthRouter);

app.use(errorHandler);

app.listen(PORT, () => {
  logger.info({ port: PORT }, "Server started");
});
