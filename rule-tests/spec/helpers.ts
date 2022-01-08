import { initializeTestApp, loadFirestoreRules, apps } from "@firebase/testing";
import firebase from "firebase";
import { readFileSync } from "fs";

type Auth = {
  uid: string;
  email: string;
};

export const setup = async (
  auth?: Auth,
  data?: Record<string, firebase.firestore.DocumentData>
) => {
  const projectId = "sentence-base";
  const app = await initializeTestApp({
    projectId,
    auth,
  });

  const db = app.firestore();

  if (data) {
    for (const key in data) {
      if (!Object.prototype.hasOwnProperty.call(data, key)) {
        continue;
      }

      const ref = db.doc(key);
      await ref.set(data[key]);
    }
  }

  await loadFirestoreRules({
    projectId,
    rules: readFileSync(`${__dirname}/../../firestore.rules`).toString(),
  });

  return db;
};

export const teardown = async () => {
  for (const app of apps()) {
    await app.delete();
  }
};
