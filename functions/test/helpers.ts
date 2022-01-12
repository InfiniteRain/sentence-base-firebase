import * as FirebaseFirestore from "@google-cloud/firestore";
import { FeaturesList } from "firebase-functions-test/lib/features";
import { createUserDocument } from "../src";

export type AuthContext = {
  auth: {
    uid: string;
  };
};

export const projectId = "sentence-base";
export const testUserId = "testUser";
export const timestampMatcher = {
  _nanoseconds: expect.any(Number),
  _seconds: expect.any(Number),
};

export const cleanFirestore = async (
  firestore: FirebaseFirestore.Firestore
) => {
  for (const collection of ["words", "sentences", "users", "batches"]) {
    const snap = await firestore.collection(collection).get();
    const deleteBatch = firestore.batch();

    for (const doc of snap.docs) {
      const docRef = firestore.collection(collection).doc(doc.id);
      deleteBatch.delete(docRef);
    }

    await deleteBatch.commit();
  }
};

let idIncrement = 0;

export const initAuth = async (
  functionsTest: FeaturesList
): Promise<AuthContext> => {
  const uid = `testUser-${idIncrement++}`;
  const wrappedCreateUserDocument = functionsTest.wrap(createUserDocument);
  const user = functionsTest.auth.makeUserRecord({ uid });

  await wrappedCreateUserDocument(user);

  return { auth: { uid } };
};
