import * as admin from "firebase-admin";

export const firestore = admin.firestore();
export const auth = admin.auth();
export const sentencesCollection = firestore.collection("sentences");
export const wordsCollection = firestore.collection("words");
export const batchesCollection = firestore.collection("batches");
export const usersCollection = firestore.collection("users");
export const metaCollection = firestore.collection("meta");
export const fieldValueServerTimestamp =
  admin.firestore.FieldValue.serverTimestamp;
export const fieldValueIncrement = admin.firestore.FieldValue.increment;
export const fieldPathDocumentId = admin.firestore.FieldPath.documentId;
