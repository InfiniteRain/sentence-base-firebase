import type { ActionResult } from "./shared";

export const createBatch = async (
  userUid: string,
  sentenceIds: string[]
): Promise<ActionResult<string>> => {
  const {
    failureAction,
    successAction,
    fieldPathDocumentId,
    firestore,
    fieldValueServerTimestamp,
    sentencesCollection,
    wordsCollection,
    batchesCollection,
    usersCollection,
  } = await import("./shared");

  const sentenceIdSet = new Set<string>(sentenceIds);
  const mutatedSentenceIds = new Set<string>();
  const sentences = [];
  const currentTimestamp = fieldValueServerTimestamp();
  const updateBatch = firestore.batch();
  const pendingSentenceSnapshot = await sentencesCollection
    .where("userUid", "==", userUid)
    .where("isPending", "==", true)
    .get();

  for (const sentenceDocumentSnap of pendingSentenceSnapshot.docs) {
    if (!sentenceIdSet.has(sentenceDocumentSnap.id)) {
      updateBatch.update(sentenceDocumentSnap.ref, {
        isPending: false,
        updatedAt: currentTimestamp,
      });

      continue;
    }

    mutatedSentenceIds.add(sentenceDocumentSnap.id);

    const wordSnapshot = await wordsCollection
      .where(fieldPathDocumentId(), "==", sentenceDocumentSnap.data().wordId)
      .where("userUid", "==", userUid)
      .limit(1)
      .get();

    if (wordSnapshot.empty) {
      return failureAction(400, ["Referenced word doesn't exist."]);
    }

    const wordDocumentSnap = wordSnapshot.docs[0];
    const wordData = wordDocumentSnap.data();
    const sentenceData = sentenceDocumentSnap.data();

    sentences.push({
      sentenceId: sentenceDocumentSnap.id,
      sentence: sentenceData.sentence,
      wordDictionaryForm: wordData.dictionaryForm,
      wordReading: wordData.reading,
      tags: sentenceData.tags,
    });

    updateBatch.update(sentenceDocumentSnap.ref, {
      isPending: false,
      isMined: true,
      updatedAt: currentTimestamp,
    });
    updateBatch.update(wordDocumentSnap.ref, {
      isMined: true,
      updatedAt: currentTimestamp,
    });
  }

  const setsEquivalent =
    sentenceIdSet.size === mutatedSentenceIds.size &&
    [...sentenceIdSet].every((value) => mutatedSentenceIds.has(value));

  if (!setsEquivalent) {
    return failureAction(400, ["Invalid sentence IDs provided."]);
  }

  const batchRef = await batchesCollection.add({
    userUid: userUid,
    sentences,
    createdAt: currentTimestamp,
    updatedAt: currentTimestamp,
  });

  updateBatch.update(usersCollection.doc(userUid), {
    pendingSentences: 0,
  });

  await updateBatch.commit();

  return successAction(batchRef.id);
};
