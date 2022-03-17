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
