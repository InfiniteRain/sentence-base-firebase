import { Router as createRouter } from "express";
import {
  authenticationError,
  errorResponse,
  successResponse,
  validationError,
} from "../../helpers";
import { body, validationResult } from "express-validator";
import * as admin from "firebase-admin";
import { config } from "../../config";

export const sentencesRouter = createRouter();

sentencesRouter
  .route("/")
  .get(async (req, res) => {
    if (!req.user) {
      authenticationError(res);
      return;
    }

    const firestore = admin.firestore();
    const sentencesCollection = firestore.collection("sentences");
    const wordsCollection = firestore.collection("words");
    const sentenceSnapshot = await sentencesCollection
      .where("userUid", "==", req.user.uid)
      .where("isPending", "==", true)
      .orderBy("createdAt", "desc")
      .get();

    if (sentenceSnapshot.docs.length === 0) {
      successResponse(res, { sentences: [] });
      return;
    }

    const wordsToFetch = sentenceSnapshot.docs.map((sentenceDoc) =>
      wordsCollection.doc(sentenceDoc.data().wordId)
    );
    const wordDocs = await firestore.getAll(...wordsToFetch);
    const wordMap = new Map(
      wordDocs.map((wordDoc) => [wordDoc.id, wordDoc.data()])
    );
    const sentences = sentenceSnapshot.docs.map((sentenceDoc) => {
      const sentenceData = sentenceDoc.data();
      const wordData = wordMap.get(sentenceData.wordId);

      return {
        sentenceId: sentenceDoc.id,
        wordId: sentenceData.wordId,
        dictionaryForm: wordData?.dictionaryForm ?? "unknown",
        reading: wordData?.reading ?? "unknown",
        sentence: sentenceData.sentence,
        frequency: wordData?.frequency ?? 0,
        tags: sentenceData.tags,
      };
    });

    successResponse(res, { sentences });
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
      if (!req.user) {
        authenticationError(res);
        return;
      }

      const errors = validationResult(req);

      if (!errors.isEmpty()) {
        validationError(res, errors.array());
        return;
      }

      const { dictionaryForm, reading, sentence, tags } = req.body;
      const firestore = admin.firestore();
      const wordsCollection = firestore.collection("words");
      const sentencesCollection = firestore.collection("sentences");
      const usersCollection = firestore.collection("users");

      const userSnap = await usersCollection.doc(req.user.uid).get();

      if (userSnap.data()?.pendingSentences >= config.maximumPendingSentences) {
        errorResponse(res, 429, ["Pending sentences limit reached."]);
        return;
      }

      const serverTimestamp = admin.firestore.FieldValue.serverTimestamp();
      const existingWordRef = await wordsCollection
        .where("userUid", "==", req.user.uid)
        .where("dictionaryForm", "==", dictionaryForm)
        .where("reading", "==", reading)
        .get();
      const wordExists = existingWordRef.docs.length !== 0;

      const wordRef = wordExists
        ? existingWordRef.docs[0]
        : await wordsCollection.add({
            userUid: req.user.uid,
            dictionaryForm,
            reading,
            frequency: 1,
            isMined: false,
            createdAt: serverTimestamp,
            updatedAt: serverTimestamp,
          });

      if (wordExists) {
        const snap = existingWordRef.docs[0];
        snap.ref.update({
          frequency: admin.firestore.FieldValue.increment(1),
          isMined: false,
          updatedAt: serverTimestamp,
        });
      }

      const sentenceRef = await sentencesCollection.add({
        userUid: req.user.uid,
        wordId: wordRef.id,
        sentence,
        isPending: true,
        isMined: false,
        tags: [...new Set(tags)],
        createdAt: serverTimestamp,
        updatedAt: serverTimestamp,
      });

      await userSnap.ref.update({
        pendingSentences: admin.firestore.FieldValue.increment(1),
      });

      successResponse(res, { sentenceId: sentenceRef.id });
    }
  );

sentencesRouter
  .route("/:sentenceId")
  .delete(async (req, res) => {
    if (!req.user) {
      authenticationError(res);
      return;
    }

    const firestore = admin.firestore();
    const sentencesCollection = firestore.collection("sentences");
    const usersCollection = firestore.collection("users");
    const wordsCollection = firestore.collection("words");
    const serverTimestamp = admin.firestore.FieldValue.serverTimestamp();

    const sentenceSnapshot = await sentencesCollection
      .where(
        admin.firestore.FieldPath.documentId(),
        "==",
        req.params.sentenceId
      )
      .where("userUid", "==", req.user.uid)
      .where("isPending", "==", true)
      .limit(1)
      .get();

    if (sentenceSnapshot.empty) {
      errorResponse(res, 400, ["Invalid sentence ID provided."]);
      return;
    }

    const sentenceSnap = sentenceSnapshot.docs[0];
    const wordId = sentenceSnap.data().wordId;

    await sentenceSnap.ref.delete();
    await usersCollection.doc(req.user.uid).update({
      pendingSentences: admin.firestore.FieldValue.increment(-1),
    });
    await wordsCollection.doc(wordId).update({
      frequency: admin.firestore.FieldValue.increment(-1),
      updatedAt: serverTimestamp,
    });

    successResponse(res);
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
      if (!req.user) {
        authenticationError(res);
        return;
      }

      const firestore = admin.firestore();
      const sentencesCollection = firestore.collection("sentences");
      const serverTimestamp = admin.firestore.FieldValue.serverTimestamp();

      const sentenceSnapshot = await sentencesCollection
        .where(
          admin.firestore.FieldPath.documentId(),
          "==",
          req.params.sentenceId
        )
        .where("userUid", "==", req.user.uid)
        .where("isPending", "==", true)
        .limit(1)
        .get();

      const { sentence, tags } = req.body;
      if (sentenceSnapshot.empty) {
        errorResponse(res, 400, ["Invalid sentence ID provided."]);
        return;
      }

      await sentenceSnapshot.docs[0].ref.update({
        sentence,
        tags,
        updatedAt: serverTimestamp,
      });

      successResponse(res);
    }
  );
