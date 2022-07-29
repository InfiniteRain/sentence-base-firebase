export const createBatch = async (
  userUid: string,
  sentenceIds: string[]
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
    const sentenceIdSet = new Set<string>(sentenceIds);
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
      if (!sentenceIdSet.has(sentenceDocumentSnap.id)) {
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
      if (!sentenceIdSet.has(sentenceDocumentSnap.id)) {
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
      sentenceIdSet.size === mutatedSentenceIds.size &&
      [...sentenceIdSet].every((value) => mutatedSentenceIds.has(value));

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
