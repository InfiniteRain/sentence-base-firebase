import type { ActionResult } from "./shared";

type Sentence = {
  sentenceId: string;
  wordId: string;
  dictionaryForm: string;
  reading: string;
  sentence: string;
  frequency: number;
  tags: string[];
};

export const getPendingSentences = async (
  userUid: string
): Promise<ActionResult<Sentence[]>> => {
  const { firestore, sentencesCollection, wordsCollection, successAction } =
    await import("./shared");

  const sentenceSnapshot = await sentencesCollection
    .where("userUid", "==", userUid)
    .where("isPending", "==", true)
    .orderBy("createdAt", "desc")
    .get();

  if (sentenceSnapshot.docs.length === 0) {
    return successAction([]);
  }

  const wordsToFetch = sentenceSnapshot.docs.map((sentenceDoc) =>
    wordsCollection.doc(sentenceDoc.data().wordId)
  );
  const wordDocs = await firestore.getAll(...wordsToFetch);
  const wordMap = new Map(
    wordDocs.map((wordDoc) => [wordDoc.id, wordDoc.data()])
  );
  const sentences = sentenceSnapshot.docs.map((sentenceDoc) => {
    const sentenceData = sentenceDoc.data();
    const wordData = wordMap.get(sentenceData.wordId);

    return {
      sentenceId: sentenceDoc.id,
      wordId: sentenceData.wordId,
      dictionaryForm: wordData?.dictionaryForm ?? "unknown",
      reading: wordData?.reading ?? "unknown",
      sentence: sentenceData.sentence,
      frequency: wordData?.frequency ?? 0,
      tags: sentenceData.tags,
    };
  });

  return successAction(sentences);
};

export const addSentence = async (
  userUid: string,
  dictionaryForm: string,
  reading: string,
  sentence: string,
  tags: string[]
): Promise<ActionResult<string>> => {
  const {
    wordsCollection,
    sentencesCollection,
    usersCollection,
    fieldValueServerTimestamp,
    fieldValueIncrement,
    failureAction,
    successAction,
  } = await import("./shared");
  const { config } = await import("../config");

  const userSnap = await usersCollection.doc(userUid).get();

  if (userSnap.data()?.pendingSentences >= config.maximumPendingSentences) {
    return failureAction(429, ["Pending sentences limit reached."]);
  }

  const currentTimestamp = fieldValueServerTimestamp();
  const existingWordRef = await wordsCollection
    .where("userUid", "==", userUid)
    .where("dictionaryForm", "==", dictionaryForm)
    .where("reading", "==", reading)
    .get();
  const wordExists = existingWordRef.docs.length !== 0;

  const wordRef = wordExists
    ? existingWordRef.docs[0]
    : await wordsCollection.add({
        userUid: userUid,
        dictionaryForm,
        reading,
        frequency: 1,
        isMined: false,
        createdAt: currentTimestamp,
        updatedAt: currentTimestamp,
      });

  if (wordExists) {
    const snap = existingWordRef.docs[0];
    snap.ref.update({
      frequency: fieldValueIncrement(1),
      isMined: false,
      updatedAt: currentTimestamp,
    });
  }

  const sentenceRef = await sentencesCollection.add({
    userUid: userUid,
    wordId: wordRef.id,
    sentence,
    isPending: true,
    isMined: false,
    tags: [...new Set(tags)],
    createdAt: currentTimestamp,
    updatedAt: currentTimestamp,
  });

  await userSnap.ref.update({
    pendingSentences: fieldValueIncrement(1),
  });

  return successAction(sentenceRef.id);
};

export const deleteSentence = async (
  userUid: string,
  sentenceId: string
): Promise<ActionResult> => {
  const {
    wordsCollection,
    sentencesCollection,
    usersCollection,
    fieldValueServerTimestamp,
    fieldValueIncrement,
    fieldPathDocumentId,
    failureAction,
    successAction,
  } = await import("./shared");

  const currentTimestamp = fieldValueServerTimestamp();

  const sentenceSnapshot = await sentencesCollection
    .where(fieldPathDocumentId(), "==", sentenceId)
    .where("userUid", "==", userUid)
    .where("isPending", "==", true)
    .limit(1)
    .get();

  if (sentenceSnapshot.empty) {
    return failureAction(400, ["Invalid sentence ID provided."]);
  }

  const sentenceSnap = sentenceSnapshot.docs[0];
  const wordId = sentenceSnap.data().wordId;

  await sentenceSnap.ref.delete();
  await usersCollection.doc(userUid).update({
    pendingSentences: fieldValueIncrement(-1),
  });
  await wordsCollection.doc(wordId).update({
    frequency: fieldValueIncrement(-1),
    updatedAt: currentTimestamp,
  });

  return successAction(void 0);
};

export const editSentence = async (
  userUid: string,
  sentenceId: string,
  sentence: string,
  tags: string[]
): Promise<ActionResult> => {
  const {
    sentencesCollection,
    fieldValueServerTimestamp,
    fieldPathDocumentId,
    failureAction,
    successAction,
  } = await import("./shared");

  const sentenceSnapshot = await sentencesCollection
    .where(fieldPathDocumentId(), "==", sentenceId)
    .where("userUid", "==", userUid)
    .where("isPending", "==", true)
    .limit(1)
    .get();

  if (sentenceSnapshot.empty) {
    return failureAction(400, ["Invalid sentence ID provided."]);
  }

  await sentenceSnapshot.docs[0].ref.update({
    sentence,
    tags: [...new Set(tags)],
    updatedAt: fieldValueServerTimestamp(),
  });

  return successAction(void 0);
};
