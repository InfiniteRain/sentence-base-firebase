import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { object, string } from "joi";

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
  const serverTimestamp = admin.firestore.FieldValue.serverTimestamp();

  const existingWordRef = await wordsCollection
    .where("userUid", "==", context.auth.uid)
    .where("dictionaryForm", "==", dictionaryForm)
    .where("reading", "==", reading)
    .get();
  const wordExists = existingWordRef.docs.length !== 0;

  const wordRef = wordExists
    ? existingWordRef.docs[0]
    : await firestore.collection("words").add({
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
    snap.ref.set(
      {
        frequency: snap.data().frequency + 1,
        updatedAt: serverTimestamp,
      },
      {
        merge: true,
      }
    );
  }

  const sentenceRef = await firestore.collection("sentences").add({
    userUid: context.auth.uid,
    wordId: wordRef.id,
    sentence,
    isPending: true,
    isMined: false,
    createdAt: serverTimestamp,
    updatedAt: serverTimestamp,
  });

  return sentenceRef.id;
});
