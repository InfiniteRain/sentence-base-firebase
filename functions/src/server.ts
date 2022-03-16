import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import * as admin from "firebase-admin";

const server = express();

server.use(cors({ origin: true }));
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
  } finally {
    next();
  }
});

server.get("/test", (req, res) => {
  throw new Error("test");
});

server.use((_error: any, _req: Request, res: Response, _next: NextFunction) => {
  res.status(500).send({ success: false, error: "Internal server error." });
});

server.use((req, res) => {
  res
    .status(404)
    .send({ success: false, error: `Endpoint ${req.url} is not found.` });
});

export { server };
