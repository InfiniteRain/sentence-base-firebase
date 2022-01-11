process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";

jest.mock("../src/config", () => ({
  config: {
    maximumPendingSentences: 10,
  },
}));

import {
  projectId,
  timestampMatcher,
  cleanFirestore,
  initAuth,
} from "./helpers";
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

  const wrappedAddSentence = functionsTest.wrap(addSentence);

  const getDocumentDataFromId = async (
    collection: string,
    id: string
  ): Promise<FirebaseFirestore.DocumentData | undefined> => {
    const snap = await firestore.collection(collection).doc(id).get();
    return snap.data();
  };

  const getDocumentCount = async (collection: string): Promise<number> => {
    const snap = await firestore.collection(collection).get();
    return snap.docs.length;
  };

  beforeEach(async () => {
    await cleanFirestore(firestore);
  });

  afterAll(() => {
    functionsTest.cleanup();
  });

  describe("logged out", () => {
    test("createUserDocument should create new user document", async () => {
      await expect(getDocumentCount("users")).resolves.toEqual(0);

      const authContext = await initAuth(functionsTest);

      await expect(getDocumentCount("users")).resolves.toEqual(1);

      const userData = await getDocumentDataFromId(
        "users",
        authContext.auth.uid
      );

      expect(userData).toEqual({
        pendingSentences: 0,
      });
    });

    test("addSentence should reject", async () => {
      expect(wrappedAddSentence({})).rejects.toThrow("not logged in");
    });
  });

  describe("logged in", () => {
    let authContext!: {
      auth: {
        uid: string;
      };
    };

    beforeEach(async () => {
      authContext = await initAuth(functionsTest);
    });

    test("addSentence should validate", async () => {
      expect(wrappedAddSentence({}, authContext)).rejects.toThrow(
        /is required$/
      );
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

      const existingWordRef = await firestore
        .collection("words")
        .where("userUid", "==", authContext.auth.uid)
        .get();
      expect(existingWordRef.docs.length).toEqual(1);
    });

    test("addSentence should not add more sentences after the limit has been reached", async () => {
      const oldUserData = await getDocumentDataFromId(
        "users",
        authContext.auth.uid
      );
      expect(oldUserData?.pendingSentences).toEqual(0);

      for (let i = 0; i < 10; i++) {
        await wrappedAddSentence(
          {
            dictionaryForm: "猫",
            reading: "ネコ",
            sentence: `${i}匹目の猫が現れる`,
          },
          authContext
        );
      }

      const newUserData = await getDocumentDataFromId(
        "users",
        authContext.auth.uid
      );

      expect(newUserData?.pendingSentences).toEqual(10);
      await expect(getDocumentCount("sentences")).resolves.toEqual(10);

      const addSentencePromise = wrappedAddSentence(
        {
          dictionaryForm: "猫",
          reading: "ネコ",
          sentence: "もう一匹の猫が現れる",
        },
        authContext
      );

      await expect(addSentencePromise).rejects.toThrow(
        "pending sentences limit reached"
      );
      await expect(getDocumentCount("sentences")).resolves.toEqual(10);
    });
  });
});

// todo: make a test that makes sure that non-pending sentences are not counted towards the limit
// todo: make a test that decrements the currentPending number when sentence deletes
// todo: make a test that reset the currenPending number when batch mined
