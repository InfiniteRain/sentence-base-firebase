import firebaseJson from "../../firebase.json";
import fetch, { Headers } from "node-fetch";
import { nanoid } from "nanoid/non-secure";
import * as admin from "firebase-admin";

export const apiUrl = `http://localhost:${firebaseJson.emulators.functions.port}/sentence-base/us-central1/api/v1`;
export const authUrl = `http://localhost:${firebaseJson.emulators.auth.port}/www.googleapis.com/identitytoolkit/v3/relyingparty/verifyCustomToken?key=${process.env.FIREBASE_API_KEY}`;
export const projectId = "sentence-base";
export const testUserId = "testUser";
export const timestampMatcher = {
  _nanoseconds: expect.any(Number),
  _seconds: expect.any(Number),
};

export const expectErrors = async (
  responsePromise: Promise<unknown>,
  messages?: string[]
) =>
  await expect(responsePromise).resolves.toEqual({
    success: false,
    errors: messages ?? expect.any(Array),
  });

export const expectSuccess = async (
  responsePromise: Promise<unknown>,
  data?: unknown
) =>
  await expect(responsePromise).resolves.toEqual({
    success: true,
    data,
  });

export const clean = async () => {
  const firestore = admin.firestore();
  const auth = admin.auth();

  for (const collection of ["words", "sentences", "users", "batches"]) {
    const snap = await firestore.collection(collection).get();
    const deleteBatch = firestore.batch();

    for (const doc of snap.docs) {
      const docRef = firestore.collection(collection).doc(doc.id);
      deleteBatch.delete(docRef);
    }

    await deleteBatch.commit();
  }

  let uids: string[] = [];
  let result!: admin.auth.ListUsersResult;
  let pageToken: string | undefined;

  do {
    result = await auth.listUsers(100, pageToken);
    uids = [...uids, ...result.users.map((user) => user.uid)];
    pageToken = result.pageToken;
  } while (pageToken);

  await auth.deleteUsers(uids);
};

export const getIdToken = async (uid: string) => {
  const customToken = await admin.auth().createCustomToken(uid);
  const response = await fetch(authUrl, {
    method: "post",
    body: JSON.stringify({
      token: customToken,
      returnSecureToken: true,
    }),
    headers: new Headers({
      "Content-Type": "application/json;charset=UTF-8",
    }),
  });
  const json = await response.json();

  return json.idToken;
};

export const initAuth = async (): Promise<[admin.auth.UserRecord, string]> => {
  const firestore = admin.firestore();
  const id = nanoid();
  const user = await admin.auth().createUser({
    email: `${id}@example.com`,
    password: "assword",
    displayName: `user-${id}`,
  });

  await new Promise<void>((resolve) => {
    const unsubscribe = firestore
      .collection("users")
      .doc(user.uid)
      .onSnapshot((snap) => {
        if (typeof snap.data()?.pendingSentences === "number") {
          unsubscribe();
          resolve();
        }
      });
  });

  return [user, await getIdToken(user.uid)];
};

export const addSentence = async (
  dictionaryForm: string,
  reading: string,
  sentence: string,
  tags: string[],
  token?: string
) => {
  const response = await fetch(`${apiUrl}/sentences`, {
    method: "post",
    body: JSON.stringify({
      dictionaryForm,
      reading,
      sentence,
      tags,
    }),
    headers: new Headers({
      "Content-Type": "application/json",
      Authorization: token ? `Bearer ${token}` : "",
    }),
  });
  return await response.json();
};

export const newBatch = async (sentences: string[], token?: string) => {
  const response = await fetch(`${apiUrl}/batches`, {
    method: "post",
    body: JSON.stringify({
      sentences,
    }),
    headers: new Headers({
      "Content-Type": "application/json",
      Authorization: token ? `Bearer ${token}` : "",
    }),
  });
  return await response.json();
};

export const deleteSentence = async (sentenceId: string, token?: string) => {
  const response = await fetch(`${apiUrl}/sentences/${sentenceId}`, {
    method: "delete",
    headers: new Headers({
      Authorization: token ? `Bearer ${token}` : "",
    }),
  });
  return await response.json();
};

export const getPendingSentences = async (token?: string) => {
  const response = await fetch(`${apiUrl}/sentences`, {
    headers: new Headers({
      Authorization: token ? `Bearer ${token}` : "",
    }),
  });
  return await response.json();
};
