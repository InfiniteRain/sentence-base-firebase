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
): Promise<Sentence[]> => {
  const { firestore, sentencesCollection, wordsCollection } = await import(
    "../shared"
  );

  const sentenceSnapshot = await sentencesCollection
    .where("userUid", "==", userUid)
    .where("isPending", "==", true)
    .orderBy("createdAt", "desc")
    .get();

  if (sentenceSnapshot.docs.length === 0) {
    return [];
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

  return sentences;
};

export const addSentence = async (
  userUid: string,
  dictionaryForm: string,
  reading: string,
  sentence: string,
  tags: string[]
): Promise<string> => {
  const {
    firestore,
    wordsCollection,
    sentencesCollection,
    usersCollection,
    fieldValueServerTimestamp,
    fieldValueIncrement,
  } = await import("../shared");
  const { ActionHttpError } = await import("./action-http-error");
  const { config } = await import("../config");

  return await firestore.runTransaction(async (transaction) => {
    const userSnap = await transaction.get(usersCollection.doc(userUid));

    if (userSnap.data()?.pendingSentences >= config.maximumPendingSentences) {
      return Promise.reject(
        new ActionHttpError(429, "Pending sentences limit reached.")
      );
    }

    const currentTimestamp = fieldValueServerTimestamp();
    const existingWordRef = await transaction.get(
      wordsCollection
        .where("userUid", "==", userUid)
        .where("dictionaryForm", "==", dictionaryForm)
        .where("reading", "==", reading)
    );
    const wordExists = existingWordRef.docs.length !== 0;
    const wordRef = wordExists
      ? existingWordRef.docs[0].ref
      : wordsCollection.doc();

    wordExists
      ? transaction.update(wordRef, {
          frequency: fieldValueIncrement(1),
          isMined: false,
          buryLevel: 0,
          updatedAt: currentTimestamp,
        })
      : transaction.create(wordRef, {
          userUid: userUid,
          dictionaryForm,
          reading,
          frequency: 1,
          isMined: false,
          buryLevel: 0,
          createdAt: currentTimestamp,
          updatedAt: currentTimestamp,
        });

    const sentenceRef = sentencesCollection.doc();
    transaction.create(sentenceRef, {
      userUid: userUid,
      wordId: wordRef.id,
      sentence,
      isPending: true,
      isMined: false,
      tags: [...new Set(tags)],
      createdAt: currentTimestamp,
      updatedAt: currentTimestamp,
    });

    transaction.update(userSnap.ref, {
      pendingSentences: fieldValueIncrement(1),
    });

    return sentenceRef.id;
  });
};

export const deleteSentence = async (
  userUid: string,
  sentenceId: string
): Promise<void> => {
  const {
    firestore,
    wordsCollection,
    sentencesCollection,
    usersCollection,
    fieldValueServerTimestamp,
    fieldValueIncrement,
    fieldPathDocumentId,
  } = await import("../shared");
  const { ActionHttpError } = await import("./action-http-error");

  return await firestore.runTransaction(async (transaction) => {
    const currentTimestamp = fieldValueServerTimestamp();

    const sentenceSnapshot = await transaction.get(
      sentencesCollection
        .where(fieldPathDocumentId(), "==", sentenceId)
        .where("userUid", "==", userUid)
        .where("isPending", "==", true)
        .limit(1)
    );

    if (sentenceSnapshot.empty) {
      return Promise.reject(
        new ActionHttpError(400, "Invalid sentence ID provided.")
      );
    }

    const sentenceSnap = sentenceSnapshot.docs[0];
    const wordId = sentenceSnap.data().wordId;

    transaction.delete(sentenceSnap.ref);
    transaction.update(usersCollection.doc(userUid), {
      pendingSentences: fieldValueIncrement(-1),
    });
    transaction.update(wordsCollection.doc(wordId), {
      frequency: fieldValueIncrement(-1),
      updatedAt: currentTimestamp,
    });
  });
};

export const editSentence = async (
  userUid: string,
  sentenceId: string,
  sentence: string,
  tags: string[]
): Promise<void> => {
  const {
    firestore,
    sentencesCollection,
    fieldValueServerTimestamp,
    fieldPathDocumentId,
  } = await import("../shared");
  const { ActionHttpError } = await import("./action-http-error");

  return await firestore.runTransaction(async (transaction) => {
    const sentenceSnapshot = await transaction.get(
      sentencesCollection
        .where(fieldPathDocumentId(), "==", sentenceId)
        .where("userUid", "==", userUid)
        .where("isPending", "==", true)
        .limit(1)
    );

    if (sentenceSnapshot.empty) {
      return Promise.reject(
        new ActionHttpError(400, "Invalid sentence ID provided.")
      );
    }

    transaction.update(sentenceSnapshot.docs[0].ref, {
      sentence,
      tags: [...new Set(tags)],
      updatedAt: fieldValueServerTimestamp(),
    });

    return void 0;
  });
};
