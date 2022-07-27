import { Router as createRouter } from "express";
import { body, validationResult } from "express-validator";

export const sentencesRouter = createRouter();

sentencesRouter
  .route("/")
  .get(async (req, res) => {
    const { authenticationError, wrapActionResult } = await import("./shared");
    const { getPendingSentences } = await import("../../actions/sentences");

    if (!req.user) {
      authenticationError(res);
      return;
    }

    const result = await getPendingSentences(req.user.uid);
    wrapActionResult(res, result, (sentences) => ({ sentences }));
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
      const { authenticationError, validationError, wrapActionResult } =
        await import("./shared");
      const { addSentence } = await import("../../actions/sentences");

      if (!req.user) {
        authenticationError(res);
        return;
      }

      const errors = validationResult(req);

      if (!errors.isEmpty()) {
        validationError(res, errors.array());
        return;
      }

      const result = await addSentence(
        req.user.uid,
        req.body.dictionaryForm.trim(),
        req.body.reading.trim(),
        req.body.sentence.trim(),
        req.body.tags
      );
      wrapActionResult(res, result, (sentenceId) => ({ sentenceId }));
    }
  );

sentencesRouter
  .route("/:sentenceId")
  .delete(async (req, res) => {
    const { authenticationError, wrapActionResult } = await import("./shared");
    const { deleteSentence } = await import("../../actions/sentences");

    if (!req.user) {
      authenticationError(res);
      return;
    }

    const result = await deleteSentence(req.user.uid, req.params.sentenceId);
    wrapActionResult(res, result, () => void 0);
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
      const { authenticationError, wrapActionResult } = await import(
        "./shared"
      );
      const { editSentence } = await import("../../actions/sentences");

      if (!req.user) {
        authenticationError(res);
        return;
      }

      const result = await editSentence(
        req.user.uid,
        req.params.sentenceId,
        req.body.sentence.trim(),
        req.body.tags
      );
      wrapActionResult(res, result, () => void 0);
    }
  );
