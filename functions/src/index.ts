import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { object, string, array } from "joi";
import { config } from "./config";

admin.initializeApp();

// // Start writing Firebase Functions
// // https://firebase.google.com/docs/functions/typescript
//
// export const helloWorld = functions.https.onRequest((request, response) => {
//   functions.logger.info("Hello logs!", {structuredData: true});
//   response.send("Hello from Firebase!");
// });

// export const createWord = functions.firestore
//   .document("/words/{docId}")
//   .onCreate((snap) => {
//     const serverTimestamp = admin.firestore.FieldValue.serverTimestamp();

//     snap.ref.set(
//       {
//         frequency: 1,
//         isMined: false,
//         createdAt: serverTimestamp,
//         ,
//       },
//       { merge: true }
//     );
//   });
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
    dictionaryForm: string().min(1).required(),
    reading: string().min(1).required(),
    sentence: string().min(1).required(),
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
    sentenceIds: array().items(string()).min(1).required(),
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
    sentences,
    createdAt: serverTimestamp,
    updatedAt: serverTimestamp,
  });

  await updateBatch.commit();

  return sentenceRef.id;
});
