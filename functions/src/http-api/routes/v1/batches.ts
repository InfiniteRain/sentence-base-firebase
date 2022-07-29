import { Router as createRouter } from "express";
import { body, validationResult } from "express-validator";
import { config } from "../../../config";

export const batchesRouter = createRouter();

batchesRouter.post(
  "/",
  body(
    "sentences",
    `Field \`sentences\` must be an array of strings with a length between 1 and ${config.maximumPendingSentences}`
  )
    .isArray({ min: 1, max: config.maximumPendingSentences })
    .custom((array) =>
      (array ?? []).every((element: unknown) => typeof element === "string")
    ),
  async (req, res) => {
    const { authenticationError, validationError, wrapActionResultInResponse } =
      await import("./helpers");
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

    const action = createBatch(req.user.uid, req.body.sentences);
    wrapActionResultInResponse(res, action, (batchId) => ({ batchId }));
  }
);
