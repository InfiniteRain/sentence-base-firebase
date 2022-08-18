type QueryDocumentSnapshot =
  FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData>;

const hasIntersections = (a: Set<string>, b: Set<string>, c: Set<string>) => {
  const combinedArray = [...a].concat([...b], [...c]);
  return combinedArray.length !== new Set(combinedArray).size;
};

const queryWordsByIds = async (
  transaction: FirebaseFirestore.Transaction,
  userUid: string,
  words: Set<string>,
  name: string
) => {
  const { wordsCollection, fieldPathDocumentId } = await import("../shared");
  const { ActionHttpError } = await import("./action-http-error");

  const wordSnaphots = (
    await Promise.all(
      [...words].map((wordId) =>
        transaction.get(
          wordsCollection
            .where(fieldPathDocumentId(), "==", wordId)
            .where("userUid", "==", userUid)
            .where("isMined", "==", false)
            .limit(1)
        )
      )
    )
  )
    .filter((snap) => !snap.empty)
    .map((snap) => snap.docs[0]);

  if (wordSnaphots.length !== words.size) {
    return Promise.reject(
      new ActionHttpError(400, `Invalid sentence IDs in ${name} provided.`)
    );
  }

  return wordSnaphots;
};

const handleWordSideffects = async (
  transaction: FirebaseFirestore.Transaction,
  userUid: string,
  wordsToMarkAsMined: Set<string>,
  wordsToPushToTheEnd: Set<string>
) => {
  const { fieldValueIncrement } = await import("../shared");

  const wordsToMarkAsMinedSnaphots = await queryWordsByIds(
    transaction,
    userUid,
    wordsToMarkAsMined,
    "markAsMined"
  );
  const wordsToPushToTheEndSnapshots = await queryWordsByIds(
    transaction,
    userUid,
    wordsToPushToTheEnd,
    "pushToTheEnd"
  );

  await Promise.all(
    wordsToMarkAsMinedSnaphots.map((snap) =>
      transaction.update(snap.ref, {
        isMined: true,
      })
    )
  );
  await Promise.all(
    wordsToPushToTheEndSnapshots.map((snap) =>
      transaction.update(snap.ref, {
        buryLevel: fieldValueIncrement(1),
      })
    )
  );
};

export const createBatch = async (
  userUid: string,
  sentenceIds: Set<string>
): Promise<string> => {
  const {
    firestore,
    sentencesCollection,
    wordsCollection,
    batchesCollection,
    usersCollection,
    fieldPathDocumentId,
    fieldValueServerTimestamp,
  } = await import("../shared");
  const { ActionHttpError } = await import("./action-http-error");

  return await firestore.runTransaction(async (transaction) => {
    const mutatedSentenceIds = new Set<string>();
    const wordSnapshotMap = new Map<
      string,
      FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData>
    >();
    const sentences = [];
    const currentTimestamp = fieldValueServerTimestamp();
    const pendingSentenceSnapshot = await transaction.get(
      sentencesCollection
        .where("userUid", "==", userUid)
        .where("isPending", "==", true)
    );

    for (const sentenceDocumentSnap of pendingSentenceSnapshot.docs) {
      if (!sentenceIds.has(sentenceDocumentSnap.id)) {
        continue;
      }

      const wordId = sentenceDocumentSnap.data().wordId;
      const wordSnapshot = await transaction.get(
        wordsCollection
          .where(fieldPathDocumentId(), "==", wordId)
          .where("userUid", "==", userUid)
          .limit(1)
      );

      if (wordSnapshot.empty) {
        return Promise.reject(
          new ActionHttpError(400, "Referenced word doesn't exist.")
        );
      }

      wordSnapshotMap.set(wordId, wordSnapshot.docs[0]);
    }

    for (const sentenceDocumentSnap of pendingSentenceSnapshot.docs) {
      if (!sentenceIds.has(sentenceDocumentSnap.id)) {
        transaction.update(sentenceDocumentSnap.ref, {
          isPending: false,
          updatedAt: currentTimestamp,
        });

        continue;
      }

      mutatedSentenceIds.add(sentenceDocumentSnap.id);

      const wordDocumentSnap = wordSnapshotMap.get(
        sentenceDocumentSnap.data().wordId
      ) as FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData>;
      const wordData = wordDocumentSnap.data();
      const sentenceData = sentenceDocumentSnap.data();

      sentences.push({
        sentenceId: sentenceDocumentSnap.id,
        sentence: sentenceData.sentence,
        wordDictionaryForm: wordData.dictionaryForm,
        wordReading: wordData.reading,
        tags: sentenceData.tags,
      });

      transaction.update(sentenceDocumentSnap.ref, {
        isPending: false,
        isMined: true,
        updatedAt: currentTimestamp,
      });
      transaction.update(wordDocumentSnap.ref, {
        isMined: true,
        updatedAt: currentTimestamp,
      });
    }

    const setsEquivalent =
      sentenceIds.size === mutatedSentenceIds.size &&
      [...sentenceIds].every((value) => mutatedSentenceIds.has(value));

    if (!setsEquivalent) {
      return Promise.reject(
        new ActionHttpError(400, "Invalid sentence IDs provided.")
      );
    }

    const batchRef = batchesCollection.doc();
    transaction.create(batchRef, {
      userUid: userUid,
      sentences,
      createdAt: currentTimestamp,
      updatedAt: currentTimestamp,
    });

    transaction.update(usersCollection.doc(userUid), {
      pendingSentences: 0,
    });

    return batchRef.id;
  });
};

export const createBatchFromBacklog = async (
  userUid: string,
  sentenceIds: Set<string>,
  markAsMined: Set<string>,
  pushToTheEnd: Set<string>
): Promise<string> => {
  const {
    firestore,
    sentencesCollection,
    wordsCollection,
    batchesCollection,
    fieldPathDocumentId,
    fieldValueServerTimestamp,
  } = await import("../shared");
  const { ActionHttpError } = await import("./action-http-error");

  if (hasIntersections(sentenceIds, markAsMined, pushToTheEnd)) {
    return Promise.reject(
      new ActionHttpError(
        400,
        "IDs passed in sentences, markAsMined and pushToTheEnd have to be unique between arrays."
      )
    );
  }

  return await firestore.runTransaction(async (transaction) => {
    const sentenceIdSet = new Set<string>(sentenceIds);
    const markAsMinedSet = new Set<string>(markAsMined);
    const pushToTheEndSet = new Set<string>(pushToTheEnd);

    const sentences = [];
    const currentTimestamp = fieldValueServerTimestamp();

    const sentenceSnapshots = (
      await Promise.all(
        [...sentenceIdSet].map((id) =>
          transaction.get(
            sentencesCollection
              .where(fieldPathDocumentId(), "==", id)
              .where("userUid", "==", userUid)
              .where("isPending", "==", false)
              .where("isMined", "==", false)
              .limit(1)
          )
        )
      )
    )
      .filter((snap) => !snap.empty)
      .map((snap) => snap.docs[0]);

    if (sentenceSnapshots.length !== sentenceIdSet.size) {
      return Promise.reject(
        new ActionHttpError(400, "Invalid sentence IDs provided.")
      );
    }

    const wordSnapshotMap = new Map<string, QueryDocumentSnapshot>(
      (
        await Promise.all(
          sentenceSnapshots.map((snap) =>
            transaction.get(
              wordsCollection
                .where(fieldPathDocumentId(), "==", snap.data().wordId)
                .where("userUid", "==", userUid)
                .where("isMined", "==", false)
                .limit(1)
            )
          )
        )
      )
        .filter((snap) => !snap.empty)
        .map((snap) => [snap.docs[0].id, snap.docs[0]])
    );

    if (wordSnapshotMap.size !== sentenceIdSet.size) {
      return Promise.reject(
        new ActionHttpError(400, "Referenced word doesn't exist.")
      );
    }

    await handleWordSideffects(
      transaction,
      userUid,
      markAsMinedSet,
      pushToTheEndSet
    );

    for (const sentenceSnapshot of sentenceSnapshots) {
      const wordDocumentSnapshot = wordSnapshotMap.get(
        sentenceSnapshot.data().wordId
      ) as QueryDocumentSnapshot;
      const wordData = wordDocumentSnapshot.data();
      const sentenceData = sentenceSnapshot.data();

      sentences.push({
        sentenceId: sentenceSnapshot.id,
        sentence: sentenceData.sentence,
        wordDictionaryForm: wordData.dictionaryForm,
        wordReading: wordData.reading,
        tags: sentenceData.tags,
      });

      transaction.update(sentenceSnapshot.ref, {
        isMined: true,
        updatedAt: currentTimestamp,
      });
      transaction.update(wordDocumentSnapshot.ref, {
        isMined: true,
        updatedAt: currentTimestamp,
      });
    }

    const batchRef = batchesCollection.doc();

    transaction.create(batchRef, {
      userUid,
      sentences,
      createdAt: currentTimestamp,
      updatedAt: currentTimestamp,
    });

    return batchRef.id;
  });
};
