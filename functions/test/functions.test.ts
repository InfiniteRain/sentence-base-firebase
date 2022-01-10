process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";

import { projectId, timestampMatcher } from "./helpers";
import firebaseFunctionsTest from "firebase-functions-test";
import { addSentence } from "../src";
import * as admin from "firebase-admin";

const functionsTest = firebaseFunctionsTest({
  projectId: `${projectId}-tests`,
});

describe("Function tests", () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("You're not running the test suite in an emulator!");
  }

  const firestore = admin.firestore();
  const authContext = {
    auth: {
      uid: "testUser",
    },
  };

  const wrappedAddSentence = functionsTest.wrap(addSentence);

  const getDocumentDataFromId = async (
    collection: string,
    id: string
  ): Promise<FirebaseFirestore.DocumentData | undefined> => {
    const snap = await firestore.collection(collection).doc(id).get();
    return snap.data();
  };

  beforeEach(async () => {
    for (const collection of ["words", "sentences"]) {
      const snap = await firestore.collection(collection).get();
      const deleteBatch = firestore.batch();

      for (const doc of snap.docs) {
        const docRef = firestore.collection(collection).doc(doc.id);
        deleteBatch.delete(docRef);
      }

      await deleteBatch.commit();
    }
  });

  afterAll(() => {
    functionsTest.cleanup();
  });

  test("addSentence should reject", async () => {
    expect(wrappedAddSentence({})).rejects.toThrow("not logged in");
  });

  test("addSentence should validate", async () => {
    expect(wrappedAddSentence({}, authContext)).rejects.toThrow(/is required$/);
  });

  test("addSentence should result with a word and a sentence added", async () => {
    const testDictionaryForm = "猫";
    const testReading = "ネコ";
    const testSentence = "これは猫です。";

    const sentenceId = await wrappedAddSentence(
      {
        dictionaryForm: testDictionaryForm,
        reading: testReading,
        sentence: testSentence,
      },
      authContext
    );

    const sentenceSnapData = await getDocumentDataFromId(
      "sentences",
      sentenceId
    );

    expect(sentenceSnapData).toEqual({
      userUid: authContext.auth.uid,
      wordId: expect.any(String),
      sentence: testSentence,
      isPending: true,
      isMined: false,
      createdAt: timestampMatcher,
      updatedAt: timestampMatcher,
    });

    const wordSnapData = await getDocumentDataFromId(
      "words",
      sentenceSnapData?.wordId
    );

    expect(wordSnapData).toEqual({
      userUid: authContext.auth.uid,
      dictionaryForm: testDictionaryForm,
      reading: testReading,
      frequency: 1,
      isMined: false,
      createdAt: timestampMatcher,
      updatedAt: timestampMatcher,
    });
  });

  test("addSentence should increase frequency on duplicate word instead of adding a new word", async () => {
    const testDictionaryForm = "猫";
    const testReading = "ネコ";
    const testSentences = ["これは猫です。", "猫がかわいい", "猫が寝ている"];

    let wordId: string | undefined;

    for (const testSentence of testSentences) {
      const sentenceId = await wrappedAddSentence(
        {
          dictionaryForm: testDictionaryForm,
          reading: testReading,
          sentence: testSentence,
        },
        authContext
      );

      const sentenceSnapData = await getDocumentDataFromId(
        "sentences",
        sentenceId
      );

      wordId = wordId ?? sentenceSnapData?.wordId;

      expect(wordId).toBeDefined();
      expect(sentenceSnapData).toEqual({
        userUid: authContext.auth.uid,
        wordId,
        sentence: sentenceSnapData?.sentence,
        isPending: true,
        isMined: false,
        createdAt: timestampMatcher,
        updatedAt: timestampMatcher,
      });
    }

    const wordSnapData = await getDocumentDataFromId("words", wordId ?? "");

    expect(wordSnapData).toEqual({
      userUid: authContext.auth.uid,
      dictionaryForm: testDictionaryForm,
      reading: testReading,
      frequency: 3,
      isMined: false,
      createdAt: timestampMatcher,
      updatedAt: timestampMatcher,
    });

    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(wordSnapData?.updatedAt > wordSnapData?.createdAt).toBeTruthy();
  });
});
