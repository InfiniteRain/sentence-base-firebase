import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { object, string, array } from "joi";
import { config } from "./config";

admin.initializeApp();

export const createUserDocument = functions.auth
  .user()
  .onCreate(async (user) => {
    const firestore = admin.firestore();
    const usersCollection = firestore.collection("users");

    await usersCollection.doc(user.uid).set({
      pendingSentences: 0,
    });
  });

export const addSentence = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "not logged in");
  }

  const schema = object({
    dictionaryForm: string().min(1).max(32).required(),
    reading: string().min(1).max(64).required(),
    sentence: string().min(1).max(512).required(),
  });

  const { error } = schema.validate(data);

  if (error) {
    throw new functions.https.HttpsError("invalid-argument", error.message);
  }

  const { dictionaryForm, reading, sentence } = data;
  const firestore = admin.firestore();
  const wordsCollection = firestore.collection("words");
  const sentencesCollection = firestore.collection("sentences");
  const usersCollection = firestore.collection("users");

  const userSnap = await usersCollection.doc(context.auth.uid).get();

  if (userSnap.data()?.pendingSentences >= config.maximumPendingSentences) {
    throw new functions.https.HttpsError(
      "resource-exhausted",
      "pending sentences limit reached"
    );
  }

  const serverTimestamp = admin.firestore.FieldValue.serverTimestamp();
  const existingWordRef = await wordsCollection
    .where("userUid", "==", context.auth.uid)
    .where("dictionaryForm", "==", dictionaryForm)
    .where("reading", "==", reading)
    .get();
  const wordExists = existingWordRef.docs.length !== 0;

  const wordRef = wordExists
    ? existingWordRef.docs[0]
    : await wordsCollection.add({
        userUid: context.auth.uid,
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
    userUid: context.auth.uid,
    wordId: wordRef.id,
    sentence,
    isPending: true,
    isMined: false,
    createdAt: serverTimestamp,
    updatedAt: serverTimestamp,
  });

  await userSnap.ref.update({
    pendingSentences: admin.firestore.FieldValue.increment(1),
  });

  return sentenceRef.id;
});

export const newBatch = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "not logged in");
  }

  const schema = object({
    sentenceIds: array()
      .items(string())
      .min(1)
      .max(config.maximumPendingSentences)
      .required(),
  });

  const { error } = schema.validate(data);

  if (error) {
    throw new functions.https.HttpsError("invalid-argument", error.message);
  }

  const sentenceIds = new Set<string>(data.sentenceIds);
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
    .where("userUid", "==", context.auth.uid)
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
      .where("userUid", "==", context.auth.uid)
      .limit(1)
      .get();

    if (wordSnapshot.empty) {
      throw new functions.https.HttpsError(
        "unknown",
        "referenced word doesn't exist"
      );
    }

    const wordDocumentSnap = wordSnapshot.docs[0];
    const wordData = wordDocumentSnap.data();

    sentences.push({
      sentenceId: sentenceDocumentSnap.id,
      sentence: sentenceDocumentSnap.data().sentence,
      wordDictionaryForm: wordData.dictionaryForm,
      wordReading: wordData.reading,
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
    throw new functions.https.HttpsError(
      "invalid-argument",
      "invalid sentence ids provided"
    );
  }

  const sentenceRef = await batchesCollection.add({
    userUid: context.auth.uid,
    sentences,
    createdAt: serverTimestamp,
    updatedAt: serverTimestamp,
  });

  updateBatch.update(usersCollection.doc(context.auth.uid), {
    pendingSentences: 0,
  });

  await updateBatch.commit();

  return sentenceRef.id;
});

export const deleteSentence = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "not logged in");
  }

  const schema = object({
    sentenceId: string().required(),
  });

  const { error } = schema.validate(data);

  if (error) {
    throw new functions.https.HttpsError("invalid-argument", error.message);
  }

  const firestore = admin.firestore();
  const sentencesCollection = firestore.collection("sentences");
  const usersCollection = firestore.collection("users");
  const wordsCollection = firestore.collection("words");
  const serverTimestamp = admin.firestore.FieldValue.serverTimestamp();

  const sentenceSnapshot = await sentencesCollection
    .where(admin.firestore.FieldPath.documentId(), "==", data.sentenceId)
    .where("userUid", "==", context.auth.uid)
    .where("isPending", "==", true)
    .limit(1)
    .get();

  if (sentenceSnapshot.empty) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "invalid sentence id provided"
    );
  }

  const sentenceSnap = sentenceSnapshot.docs[0];
  const wordId = sentenceSnap.data().wordId;

  await sentenceSnap.ref.delete();
  await usersCollection.doc(context.auth.uid).update({
    pendingSentences: admin.firestore.FieldValue.increment(-1),
  });
  await wordsCollection.doc(wordId).update({
    frequency: admin.firestore.FieldValue.increment(-1),
    updatedAt: serverTimestamp,
  });
});

export const getPendingSentences = functions.https.onCall(
  async (_, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError("unauthenticated", "not logged in");
    }

    const firestore = admin.firestore();
    const sentencesCollection = firestore.collection("sentences");
    const wordsCollection = firestore.collection("words");
    const sentenceSnapshot = await sentencesCollection
      .where("userUid", "==", context.auth.uid)
      .where("isPending", "==", true)
      .orderBy("createdAt", "desc")
      .get();

    if (sentenceSnapshot.docs.length === 0) {
      return [];
    }

    const wordsToFetch = sentenceSnapshot.docs.map((sentenceDoc) =>
      wordsCollection.doc(sentenceDoc.data().wordId)
    );
    const wordDocs = await firestore.getAll(...wordsToFetch);
    const wordMap = new Map(
      wordDocs.map((wordDoc) => [wordDoc.id, wordDoc.data()])
    );

    return sentenceSnapshot.docs.map((sentenceDoc) => {
      const sentenceData = sentenceDoc.data();
      const wordData = wordMap.get(sentenceData.wordId);

      return {
        sentenceId: sentenceDoc.id,
        wordId: sentenceData.wordId,
        dictionaryForm: wordData?.dictionaryForm ?? "unknown",
        reading: wordData?.reading ?? "unknown",
        sentence: sentenceData.sentence,
        frequency: wordData?.frequency ?? 0,
      };
    });
  }
);
