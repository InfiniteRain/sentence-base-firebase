import * as admin from "firebase-admin";

export type ActionFailure = {
  type: "failure";
  code: number;
  errors: unknown[];
};

export type ActionSuccess<T> = {
  type: "success";
  data: T;
};

export type ActionResult<T> = ActionFailure | ActionSuccess<T>;

export const failureAction = (
  code: number,
  errors: unknown[]
): ActionFailure => ({
  type: "failure",
  code,
  errors,
});

export const successAction = <T>(data: T): ActionSuccess<T> => ({
  type: "success",
  data,
});

export const firestore = admin.firestore();
export const sentencesCollection = firestore.collection("sentences");
export const wordsCollection = firestore.collection("words");
export const batchesCollection = firestore.collection("batches");
export const usersCollection = firestore.collection("users");
export const serverTimestamp = admin.firestore.FieldValue.serverTimestamp;
export const documentId = admin.firestore.FieldPath.documentId;
