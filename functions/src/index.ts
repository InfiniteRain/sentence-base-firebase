import * as admin from "firebase-admin";
import * as functions from "firebase-functions";
import { server } from "./http-api/server";

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
 * @param transaction The transaction used by a function.
 * @param collection The name of the collection to update the value for.
 * @param type Signifies whether the current value should increment or decrement.
 * @returns Promise to await.
 */
const updateMetaCounter = async (
  transaction: FirebaseFirestore.Transaction,
  collection: string,
  type: "increment" | "decrement"
) => {
  const { metaCollection, fieldValueIncrement } = await import("./shared");

  transaction.set(
    metaCollection.doc(metaCountersDocumentId),
    {
      [collection]: fieldValueIncrement(type === "increment" ? 1 : -1),
    },
    { merge: true }
  );
};

/**
 * Update the counter user meta information for the collection.
 * @param transaction The transaction used by a function.
 * @param userUid The UID of the user to update the value for.
 * @param collection The name of the collection to update the value for.
 * @param type Signifies whether the current value should increment or decrement.
 * @returns Promise to await.
 */
const updateUserMetaCounter = async (
  transaction: FirebaseFirestore.Transaction,
  userUid: string,
  collection: string,
  type: "increment" | "decrement"
) => {
  const { usersCollection, fieldValueIncrement } = await import("./shared");

  const userDocument = usersCollection.doc(userUid);
  const data = (await transaction.get(userDocument)).data();

  if (!data) {
    return;
  }

  transaction.set(
    userDocument,
    {
      counters: {
        [collection]: fieldValueIncrement(type === "increment" ? 1 : -1),
      },
    },
    { merge: true }
  );
};

/**
 * Record a given event ID in Firestore. Used for idempotency checks.
 * @param transaction The transaction used by a function.
 * @param eventId The event ID in question.
 */
export const recordEventId = async (
  transaction: FirebaseFirestore.Transaction,
  eventId: string
) => {
  const { eventIdsCollection, fieldValueServerTimestamp } = await import(
    "./shared"
  );

  transaction.create(eventIdsCollection.doc(eventId), {
    createdAt: fieldValueServerTimestamp(),
  });
};

/**
 * Check if a given event ID record exists. Used for idempotency checks.
 * @param transaction The transaction used by a function.
 * @param eventId The event ID in question.
 * @returns A boolean indicating the record existence.
 */
export const eventIdExists = async (
  transaction: FirebaseFirestore.Transaction,
  eventId: string
): Promise<boolean> => {
  const { eventIdsCollection } = await import("./shared");

  return (await transaction.get(eventIdsCollection.doc(eventId))).exists;
};

/**
 * Expose the REST API through the HTTPS function.
 */
export const api = functions.https.onRequest(server);

/**
 * Update the meta information upon document creation.
 */
export const incrementCountersOnCreate = functions.firestore
  .document("{collection}/{documentId}")
  .onCreate(async (change, context) => {
    const { firestore } = await import("./shared");
    const collection = context.params.collection;

    // Don't execute for "meta" and "eventIds" collections to prevent infinite
    // loops.
    if (["meta", "eventIds"].includes(collection)) {
      return;
    }

    await firestore.runTransaction(async (transaction) => {
      // Abort operation if the event ID has already been recorded.
      if (await eventIdExists(transaction, context.eventId)) {
        return;
      }

      const userUid = change.data().userUid;

      if (typeof userUid === "string") {
        await updateUserMetaCounter(
          transaction,
          userUid,
          collection,
          "increment"
        );
      }

      await updateMetaCounter(transaction, collection, "increment");
      // Record the event ID for the sake of idempotency.
      await recordEventId(transaction, context.eventId);
    });
  });

/**
 * Update the meta information upon document deletion.
 */
export const decrementCountersOnDelete = functions.firestore
  .document("{collection}/{documentId}")
  .onDelete(async (change, context) => {
    const { firestore } = await import("./shared");
    const collection = context.params.collection;

    // Don't execute for "meta" and "eventIds" collections to prevent infinite
    // loops.
    if (["meta", "eventIds"].includes(collection)) {
      return;
    }

    await firestore.runTransaction(async (transaction) => {
      // Abort operation if the event ID has already been recorded.
      if (await eventIdExists(transaction, context.eventId)) {
        return;
      }

      const userUid = change.data().userUid;

      if (typeof userUid === "string") {
        await updateUserMetaCounter(
          transaction,
          userUid,
          collection,
          "decrement"
        );
      }

      await updateMetaCounter(transaction, collection, "decrement");
      // Record the event ID for the sake of idempotency.
      await recordEventId(transaction, context.eventId);
    });
  });

/**
 * Create a user document upon registration.
 */
export const createUserDocument = functions.auth
  .user()
  .onCreate(async (user) => {
    const { usersCollection } = await import("./shared");

    await usersCollection.doc(user.uid).set({
      pendingSentences: 0,
    });
  });

/**
 * Clean all event ID records that are older then 1 hour.
 */
export const cleanEventIds = functions.pubsub
  .schedule("every 1 hours")
  .onRun(async () => {
    const { firestore, eventIdsCollection, timestampNow, timestampFromMillis } =
      await import("./shared");

    const now = timestampNow();
    const threshold = timestampFromMillis(now.toMillis() - 3600000);

    for (;;) {
      const snap = await eventIdsCollection
        .where("createdAt", "<", threshold)
        .limit(100)
        .get();

      if (snap.empty) {
        break;
      }

      const batch = firestore.batch();

      for (const doc of snap.docs) {
        batch.delete(doc.ref);
      }

      await batch.commit();
    }
  });
