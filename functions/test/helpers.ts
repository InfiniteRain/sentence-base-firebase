import firebaseJson from "../../firebase.json";
import fetch, { Headers } from "node-fetch";
import { nanoid } from "nanoid/non-secure";
import * as admin from "firebase-admin";

export const apiUrl = `http://localhost:${firebaseJson.emulators.functions.port}/sentence-base-dev/us-central1/api/v1`;
export const authUrl = `http://localhost:${firebaseJson.emulators.auth.port}/www.googleapis.com/identitytoolkit/v3/relyingparty/verifyCustomToken?key=${process.env.API_KEY}`;
export const projectId = "sentence-base-dev";
export const testUserId = "testUser";
export const timestampMatcher = {
  _nanoseconds: expect.any(Number),
  _seconds: expect.any(Number),
};
const metaCountersDocumentId = "counters";

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

export const getMetaCounter = async (collection: string): Promise<number> => {
  const firestore = admin.firestore();

  const document = await firestore
    .collection("meta")
    .doc(metaCountersDocumentId)
    .get();

  return document.data()?.[collection] ?? 0;
};

export const getUserMetaCounter = async (
  userUid: string,
  collection: string
): Promise<number> => {
  const firestore = admin.firestore();

  const document = await firestore.collection("users").doc(userUid).get();

  return document.data()?.counters?.[collection] ?? 0;
};

export const waitForEventIdAddition = async (
  original: number
): Promise<void> => {
  const firestore = admin.firestore();

  await new Promise<void>((resolve) => {
    const unsubscribe = firestore.collection("eventIds").onSnapshot((snap) => {
      const currentCount = snap.size;
      if (currentCount !== undefined && currentCount !== original) {
        unsubscribe();
        resolve();
      }
    });
  });
};

export const waitForCounterUpdate = async (
  original: number,
  collection: string,
  userUid?: string
): Promise<void> => {
  const firestore = admin.firestore();

  await Promise.all([
    new Promise<void>((resolve) => {
      const unsubscribe = firestore
        .collection("meta")
        .doc(metaCountersDocumentId)
        .onSnapshot((snap) => {
          const currentCounter = snap.data()?.[collection];
          if (currentCounter !== undefined && currentCounter !== original) {
            unsubscribe();
            resolve();
          }
        });
    }),
    ...(userUid
      ? [
          new Promise<void>((resolve) => {
            const unsubscribe = firestore
              .collection("users")
              .doc(userUid)
              .onSnapshot((snap) => {
                const currentCounter = snap.data()?.counters?.[collection];
                if (
                  currentCounter !== undefined &&
                  currentCounter !== original
                ) {
                  unsubscribe();
                  resolve();
                }
              });
          }),
        ]
      : []),
  ]);
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

export const createBatch = async (sentences: string[], token?: string) => {
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

export const editSentence = async (
  sentenceId: string,
  sentence: string,
  tags: string[],
  token?: string
) => {
  const response = await fetch(`${apiUrl}/sentences/${sentenceId}`, {
    method: "post",
    body: JSON.stringify({
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

export const getPendingSentences = async (token?: string) => {
  const response = await fetch(`${apiUrl}/sentences`, {
    headers: new Headers({
      Authorization: token ? `Bearer ${token}` : "",
    }),
  });
  return await response.json();
};

export const createBatchFromBacklog = async (
  sentences: string[],
  markAsMined: string[],
  pushToTheEnd: string[],
  token?: string
) => {
  const response = await fetch(`${apiUrl}/batches/backlog`, {
    method: "post",
    body: JSON.stringify({
      sentences,
      markAsMined,
      pushToTheEnd,
    }),
    headers: new Headers({
      "Content-Type": "application/json",
      Authorization: token ? `Bearer ${token}` : "",
    }),
  });
  return await response.json();
};
