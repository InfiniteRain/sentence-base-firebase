import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import * as admin from "firebase-admin";
import { sentencesRouter } from "./routes/v1/sentences";
import { batchesRouter } from "./routes/v1/batches";

export const server = express();

/**
 * Allow cross-origin requests.
 */
server.use(cors({ origin: true }));

/**
 * Handle authentication.
 */
server.use(async (req, _res, next) => {
  const authorizationHeader = req.headers["authorization"];

  if (!authorizationHeader) {
    next();
    return;
  }

  const authorizationSegments = authorizationHeader.split(/\s+/);

  if (
    authorizationSegments.length !== 2 ||
    authorizationSegments[0].toLocaleLowerCase() !== "bearer"
  ) {
    next();
    return;
  }

  const token = authorizationSegments[1];

  try {
    req.user = await admin.auth().verifyIdToken(token);
  } catch {
    //
  }

  next();
});

/**
 * Load v1 sentences routes.
 */
server.use("/v1/sentences", sentencesRouter);

/**
 * Load v1 batches routes.
 */
server.use("/v1/batches", batchesRouter);

/**
 * Handle internal server errors.
 */
server.use(
  (_error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).send({ success: false, error: "Internal server error." });
  }
);

/**
 * Handle 404 errors.
 */
server.use((req, res) => {
  res
    .status(404)
    .send({ success: false, error: `Endpoint ${req.url} is not found.` });
});
