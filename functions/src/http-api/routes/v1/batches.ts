import { Router as createRouter } from "express";
import { body, validationResult } from "express-validator";
import { createBatchFromBacklog } from "../../../actions/batches";
import { config } from "../../../config";

export const batchesRouter = createRouter();

const stringArray = (fieldName: string, min: number, max: number) =>
  body(
    fieldName,
    `Field \`${fieldName}\` must be an array of strings with a length between ${min} and ${max}`
  )
    .isArray({ min, max })
    .custom((array) =>
      (array ?? []).every((element: unknown) => typeof element === "string")
    );

batchesRouter
  .post(
    "/",
    stringArray("sentences", 1, config.maximumPendingSentences),
    async (req, res) => {
      const {
        authenticationError,
        validationError,
        wrapActionResultInResponse,
      } = await import("./helpers");
      const { createBatch } = await import("../../../actions/batches");

      if (!req.user) {
        authenticationError(res);
        return;
      }

      const errors = validationResult(req);

      if (!errors.isEmpty()) {
        validationError(res, errors.array());
        return;
      }

      const action = createBatch(req.user.uid, new Set(req.body.sentences));
      wrapActionResultInResponse(res, action, (batchId) => ({ batchId }));
    }
  )
  .post(
    "/backlog",
    stringArray("sentences", 1, config.maximumPendingSentences),
    stringArray("markAsMined", 0, config.maximumPendingSentences),
    stringArray("pushToTheEnd", 0, config.maximumPendingSentences),
    async (req, res) => {
      const {
        authenticationError,
        validationError,
        wrapActionResultInResponse,
      } = await import("./helpers");

      if (!req.user) {
        authenticationError(res);
        return;
      }

      const errors = validationResult(req);

      if (!errors.isEmpty()) {
        validationError(res, errors.array());
        return;
      }

      const action = createBatchFromBacklog(
        req.user.uid,
        new Set(req.body.sentences),
        new Set(req.body.markAsMined),
        new Set(req.body.pushToTheEnd)
      );
      wrapActionResultInResponse(res, action, (batchId) => ({ batchId }));
    }
  );
