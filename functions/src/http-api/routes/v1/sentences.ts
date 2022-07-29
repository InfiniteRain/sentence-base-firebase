import { Router as createRouter } from "express";
import { body, validationResult } from "express-validator";

export const sentencesRouter = createRouter();

sentencesRouter
  .route("/")
  .get(async (req, res) => {
    const { authenticationError, wrapActionResultInResponse } = await import(
      "./helpers"
    );
    const { getPendingSentences } = await import("../../../actions/sentences");

    if (!req.user) {
      authenticationError(res);
      return;
    }

    const action = getPendingSentences(req.user.uid);
    wrapActionResultInResponse(res, action, (sentences) => ({ sentences }));
  })
  .post(
    body(
      "dictionaryForm",
      "Field `dictionaryForm` must be a string with a length between 1 and 32."
    )
      .isString()
      .isLength({ min: 1, max: 32 }),
    body(
      "reading",
      "Field `reading` must be a string with a length between 1 and 64."
    )
      .isString()
      .isLength({ min: 1, max: 64 }),
    body(
      "sentence",
      "Field `sentence` must be a string with a length between 1 and 512."
    )
      .isString()
      .isLength({ min: 1, max: 512 }),
    body("tags", "Field `tags` must be an array of strings.")
      .isArray()
      .custom((array) =>
        (array ?? []).every((element: unknown) => typeof element === "string")
      ),
    async (req, res) => {
      const {
        authenticationError,
        validationError,
        wrapActionResultInResponse: wrapActionResult,
      } = await import("./helpers");
      const { addSentence } = await import("../../../actions/sentences");

      if (!req.user) {
        authenticationError(res);
        return;
      }

      const errors = validationResult(req);

      if (!errors.isEmpty()) {
        validationError(res, errors.array());
        return;
      }

      const action = addSentence(
        req.user.uid,
        req.body.dictionaryForm.trim(),
        req.body.reading.trim(),
        req.body.sentence.trim(),
        req.body.tags
      );
      wrapActionResult(res, action, (sentenceId) => ({ sentenceId }));
    }
  );

sentencesRouter
  .route("/:sentenceId")
  .delete(async (req, res) => {
    const { authenticationError, wrapActionResultInResponse } = await import(
      "./helpers"
    );
    const { deleteSentence } = await import("../../../actions/sentences");

    if (!req.user) {
      authenticationError(res);
      return;
    }

    const action = deleteSentence(req.user.uid, req.params.sentenceId);
    wrapActionResultInResponse(res, action, () => void 0);
  })
  .post(
    body(
      "sentence",
      "Field `sentence` must be a string with a length between 1 and 512."
    )
      .isString()
      .isLength({ min: 1, max: 512 }),
    body("tags", "Field `tags` must be an array of strings.")
      .isArray()
      .custom((array) =>
        (array ?? []).every((element: unknown) => typeof element === "string")
      ),
    async (req, res) => {
      const { authenticationError, wrapActionResultInResponse } = await import(
        "./helpers"
      );
      const { editSentence } = await import("../../../actions/sentences");

      if (!req.user) {
        authenticationError(res);
        return;
      }

      const action = editSentence(
        req.user.uid,
        req.params.sentenceId,
        req.body.sentence.trim(),
        req.body.tags
      );
      wrapActionResultInResponse(res, action, () => void 0);
    }
  );
