import express, { NextFunction, Request, Response } from "express";
import { body, validationResult } from "express-validator";
import cors from "cors";
import * as admin from "firebase-admin";
import {
  authenticationError,
  errorResponse,
  successResponse,
  validationError,
} from "./helpers";
import { config } from "./config";

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
  } catch {}

  next();
});

server.post(
  "/sentences",
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
      tags,
      createdAt: serverTimestamp,
      updatedAt: serverTimestamp,
    });

    await userSnap.ref.update({
      pendingSentences: admin.firestore.FieldValue.increment(1),
    });

    successResponse(res, { sentenceId: sentenceRef.id });
  }
);

server.post(
  "/batches",
  body(
    "sentences",
    `Field \`sentences\` must be an array of strings with a length between 1 and ${config.maximumPendingSentences}`
  )
    .isArray({ min: 1, max: config.maximumPendingSentences })
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

    const sentenceIds = new Set<string>(req.body.sentences);
    const mutatedSentenceIds = new Set<string>();
    const firestore = admin.firestore();
    const sentencesCollection = firestore.collection("sentences");
    const wordsCollection = firestore.collection("words");
    const batchesCollection = firestore.collection("batches");
    const usersCollection = firestore.collection("users");
    const sentences = [];
    const serverTimestamp = admin.firestore.FieldValue.serverTimestamp();
    const updateBatch = firestore.batch();
    const pendingSentenceSnapshot = await sentencesCollection
      .where("userUid", "==", req.user.uid)
      .where("isPending", "==", true)
      .get();

    for (const sentenceDocumentSnap of pendingSentenceSnapshot.docs) {
      if (!sentenceIds.has(sentenceDocumentSnap.id)) {
        updateBatch.update(sentenceDocumentSnap.ref, {
          isPending: false,
          updatedAt: serverTimestamp,
        });

        continue;
      }

      mutatedSentenceIds.add(sentenceDocumentSnap.id);

      const wordSnapshot = await wordsCollection
        .where(
          admin.firestore.FieldPath.documentId(),
          "==",
          sentenceDocumentSnap.data().wordId
        )
        .where("userUid", "==", req.user.uid)
        .limit(1)
        .get();

      if (wordSnapshot.empty) {
        errorResponse(res, 400, ["Referenced word doesn't exist."]);
        return;
      }

      const wordDocumentSnap = wordSnapshot.docs[0];
      const wordData = wordDocumentSnap.data();
      const sentenceData = sentenceDocumentSnap.data();

      sentences.push({
        sentenceId: sentenceDocumentSnap.id,
        sentence: sentenceData.sentence,
        wordDictionaryForm: wordData.dictionaryForm,
        wordReading: wordData.reading,
        tags: sentenceData.tags,
      });

      updateBatch.update(sentenceDocumentSnap.ref, {
        isPending: false,
        isMined: true,
        updatedAt: serverTimestamp,
      });
      updateBatch.update(wordDocumentSnap.ref, {
        isMined: true,
        updatedAt: serverTimestamp,
      });
    }

    const setsEquivalent =
      sentenceIds.size === mutatedSentenceIds.size &&
      [...sentenceIds].every((value) => mutatedSentenceIds.has(value));

    if (!setsEquivalent) {
      errorResponse(res, 400, ["Invalid sentence IDs provided."]);
      return;
    }

    const batchRef = await batchesCollection.add({
      userUid: req.user.uid,
      sentences,
      createdAt: serverTimestamp,
      updatedAt: serverTimestamp,
    });

    updateBatch.update(usersCollection.doc(req.user.uid), {
      pendingSentences: 0,
    });

    await updateBatch.commit();

    successResponse(res, { batchId: batchRef.id });
  }
);

server.use((_error: any, _req: Request, res: Response, _next: NextFunction) => {
  res.status(500).send({ success: false, error: "Internal server error." });
});

server.use((req, res) => {
  res
    .status(404)
    .send({ success: false, error: `Endpoint ${req.url} is not found.` });
});

export { server };
