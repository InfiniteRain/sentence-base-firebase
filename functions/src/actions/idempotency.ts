export const recordEventId = async (
  transaction: FirebaseFirestore.Transaction,
  eventId: string
) => {
  const { eventIdsCollection, fieldValueServerTimestamp } = await import(
    "../shared"
  );

  transaction.create(eventIdsCollection.doc(eventId), {
    createdAt: fieldValueServerTimestamp(),
  });
};

export const eventIdExists = async (
  transaction: FirebaseFirestore.Transaction,
  eventId: string
): Promise<boolean> => {
  const { eventIdsCollection } = await import("../shared");

  return (await transaction.get(eventIdsCollection.doc(eventId))).exists;
};

export const eventIdCleanup = async () => {
  const { firestore, eventIdsCollection, timestampNow, timestampFromMillis } =
    await import("../shared");

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
};
