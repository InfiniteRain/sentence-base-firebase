import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { server } from "./server";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: admin.auth.DecodedIdToken;
    }
  }
}

admin.initializeApp();

/**
 * The documentId of the counters meta information.
 */
const metaCountersDocumentId = "counters";

/**
 * Update the counter meta information for the collection.
 * @param collection The name of the collection to update the value for.
 * @param type Signifies whether the current value should increment or decrement.
 * @returns Promise to await.
 */
const updateMetaCounter = async (
  collection: string,
  type: "increment" | "decrement"
) => {
  const firestore = admin.firestore();
  const metaCollection = firestore.collection("meta");

  return await metaCollection.doc(metaCountersDocumentId).set(
    {
      [collection]: admin.firestore.FieldValue.increment(
        type === "increment" ? 1 : -1
      ),
    },
    { merge: true }
  );
};

/**
 * Update the counter user meta information for the collection.
 * @param userUid The UID of the user to update the value for.
 * @param collection The name of the collection to update the value for.
 * @param type Signifies whether the current value should increment or decrement.
 * @returns Promise to await.
 */
const updateUserMetaCounter = async (
  userUid: string,
  collection: string,
  type: "increment" | "decrement"
) => {
  const firestore = admin.firestore();
  const userDocument = firestore.collection("users").doc(userUid);
  const data = (await userDocument.get()).data();

  if (!data) {
    return;
  }

  return userDocument.set(
    {
      counters: {
        [collection]: admin.firestore.FieldValue.increment(
          type === "increment" ? 1 : -1
        ),
      },
    },
    { merge: true }
  );
};

/**
 * Updates the meta information upon document creation.
 */
export const incrementCountersOnCreate = functions.firestore
  .document("{collection}/{documentId}")
  .onCreate(async (change, context) => {
    const collection = context.params.collection;

    if (collection === "meta") {
      return;
    }

    const userUid = change.data().userUid;

    if (typeof userUid === "string") {
      await updateUserMetaCounter(userUid, collection, "increment");
    }

    await updateMetaCounter(collection, "increment");
  });

/**
 * Updates the meta information upon document deletion.
 */
export const decrementCountersOnDelete = functions.firestore
  .document("{collection}/{documentId}")
  .onDelete(async (change, context) => {
    const collection = context.params.collection;

    if (collection === "meta") {
      return;
    }

    const userUid = change.data().userUid;

    if (typeof userUid === "string") {
      await updateUserMetaCounter(userUid, collection, "decrement");
    }

    await updateMetaCounter(collection, "decrement");
  });

/**
 * Creates a user document upon registration.
 */
export const createUserDocument = functions.auth
  .user()
  .onCreate(async (user) => {
    const firestore = admin.firestore();
    const usersCollection = firestore.collection("users");

    await usersCollection.doc(user.uid).set({
      pendingSentences: 0,
    });
  });

/**
 * Exposes the REST API through the HTTPS function.
 */
export const api = functions.https.onRequest(server);

// todo: chanding the userId from one to another will cause a desync!
