import type { EventContext } from "firebase-functions/v1";
import type { QueryDocumentSnapshot } from "firebase-functions/v1/firestore";

const metaCountersDocumentId = "counters";

const updateMetaCounter = async (
  transaction: FirebaseFirestore.Transaction,
  collection: string,
  type: "increment" | "decrement"
) => {
  const { metaCollection, fieldValueIncrement } = await import("../shared");

  transaction.set(
    metaCollection.doc(metaCountersDocumentId),
    {
      [collection]: fieldValueIncrement(type === "increment" ? 1 : -1),
    },
    { merge: true }
  );
};

const updateUserMetaCounter = async (
  transaction: FirebaseFirestore.Transaction,
  userUid: string,
  collection: string,
  type: "increment" | "decrement"
) => {
  const { usersCollection, fieldValueIncrement } = await import("../shared");

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

export const updateCounters = async (
  change: QueryDocumentSnapshot,
  context: EventContext,
  type: "increment" | "decrement"
) => {
  const { firestore } = await import("../shared");
  const { eventIdExists, recordEventId } = await import("./idempotency");
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
      await updateUserMetaCounter(transaction, userUid, collection, type);
    }

    await updateMetaCounter(transaction, collection, type);
    // Record the event ID for the sake of idempotency.
    await recordEventId(transaction, context.eventId);
  });
};
