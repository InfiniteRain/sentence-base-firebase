process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";

const maximumPendingSentences = 15;

jest.mock("../src/config", () => ({
  config: {
    maximumPendingSentences,
  },
}));

import {
  projectId,
  timestampMatcher,
  cleanFirestore,
  initAuth,
  AuthContext,
} from "./helpers";
import firebaseFunctionsTest from "firebase-functions-test";
import { addSentence, newBatch } from "../src";
import * as admin from "firebase-admin";

const functionsTest = firebaseFunctionsTest({
  projectId: `${projectId}-tests`,
});

describe("Function tests", () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("You're not running the test suite in an emulator!");
  }

  const testWords: [string, string][] = [
    ["ペン", "ペン"],
    ["魑魅魍魎", "チミモウリョウ"],
    ["勝ち星", "カチボシ"],
    ["魑魅魍魎", "チミモウリョウ"],
    ["猫", "ネコ"],
    ["犬", "イヌ"],
    ["魑魅魍魎", "チミモウリョウ"],
    ["学校", "ガッコウ"],
    ["家", "イエ"],
    ["勝ち星", "カチボシ"],
  ];

  const firestore = admin.firestore();

  const wrappedAddSentence = functionsTest.wrap(addSentence);
  const wrappedNewBatch = functionsTest.wrap(newBatch);

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

  const mineWords = async (
    authContext: AuthContext,
    words: [string, string][]
  ): Promise<string[]> => {
    const sentenceIds: string[] = [];

    for (const [dictionaryForm, reading] of words) {
      const sentenceId = await wrappedAddSentence(
        {
          dictionaryForm,
          reading,
          sentence: `${dictionaryForm}の文`,
        },
        authContext
      );

      sentenceIds.push(sentenceId);
    }

    return sentenceIds;
  };

  const mineTestWords = async (authContext: AuthContext): Promise<string[]> =>
    await mineWords(authContext, testWords);

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

    test("newBatch should reject", async () => {
      expect(wrappedNewBatch({})).rejects.toThrow("not logged in");
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

      for (let i = 0; i < maximumPendingSentences; i++) {
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

      expect(newUserData?.pendingSentences).toEqual(maximumPendingSentences);
      await expect(getDocumentCount("sentences")).resolves.toEqual(
        maximumPendingSentences
      );

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
      await expect(getDocumentCount("sentences")).resolves.toEqual(
        maximumPendingSentences
      );
    });

    test("addSentence should set isMined to false after the word has been mined again", async () => {
      const sentenceIds = await mineTestWords(authContext);
      const sentenceData = await getDocumentDataFromId(
        "sentences",
        sentenceIds[0]
      );

      const oldWordData = await getDocumentDataFromId(
        "words",
        sentenceData?.wordId
      );
      expect(oldWordData?.isMined).toEqual(false);

      await wrappedNewBatch({ sentenceIds }, authContext);

      const newWordData = await getDocumentDataFromId(
        "words",
        sentenceData?.wordId
      );
      expect(newWordData?.isMined).toEqual(true);

      await wrappedAddSentence(
        {
          dictionaryForm: newWordData?.dictionaryForm,
          reading: newWordData?.reading,
          sentence: `${newWordData?.dictionaryForm}の文`,
        },
        authContext
      );

      const newestWordData = await getDocumentDataFromId(
        "words",
        sentenceData?.wordId
      );
      expect(newestWordData?.isMined).toEqual(false);
    });

    test("newBatch should validate", async () => {
      await expect(wrappedNewBatch({}, authContext)).rejects.toThrow(
        /is required$/
      );
    });

    test("newBatch should not work with non-existent sentences", async () => {
      await expect(
        wrappedNewBatch(
          {
            sentenceIds: ["wrongId"],
          },
          authContext
        )
      ).rejects.toThrow("invalid sentence ids provided");
    });

    test("newBatch should not work with non-owned sentences", async () => {
      const authContext2 = await initAuth(functionsTest);
      const sentenceId = await wrappedAddSentence(
        {
          dictionaryForm: "猫",
          reading: "ネコ",
          sentence: "これは猫です。",
        },
        authContext2
      );

      await expect(
        wrappedNewBatch(
          {
            sentenceIds: [sentenceId],
          },
          authContext
        )
      ).rejects.toThrow("invalid sentence ids provided");
    });

    test("newBatch should not work with non-pending sentences", async () => {
      const sentenceId = await wrappedAddSentence(
        {
          dictionaryForm: "猫",
          reading: "ネコ",
          sentence: "これは猫です。",
        },
        authContext
      );

      await firestore.collection("sentences").doc(sentenceId).update({
        isPending: false,
      });

      await expect(
        wrappedNewBatch(
          {
            sentenceIds: [sentenceId],
          },
          authContext
        )
      ).rejects.toThrow("invalid sentence ids provided");
    });

    test("newBatch should result with a batch being added", async () => {
      const sentenceIds = await mineTestWords(authContext);
      const batchId = await wrappedNewBatch({ sentenceIds }, authContext);

      expect(batchId).toEqual(expect.any(String));

      const batchData = await getDocumentDataFromId("batches", batchId);

      expect(batchData).toEqual({
        sentences: expect.arrayContaining([
          {
            sentenceId: expect.any(String),
            sentence: expect.any(String),
            wordDictionaryForm: expect.any(String),
            wordReading: expect.any(String),
          },
        ]),
        createdAt: timestampMatcher,
        updatedAt: timestampMatcher,
      });
    });

    test("newBatch should change isMined and isPending accordingly", async () => {
      const sentenceIdsToMine = await mineTestWords(authContext);
      const sentenceIdsToIgnore = await mineWords(authContext, [
        ["魚", "サカナ"],
        ["牛乳", "ギュウニュウ"],
      ]);

      for (const sentenceId of [...sentenceIdsToMine, ...sentenceIdsToIgnore]) {
        const sentenceData = await getDocumentDataFromId(
          "sentences",
          sentenceId
        );

        expect(sentenceData?.isMined).toEqual(false);
        expect(sentenceData?.isPending).toEqual(true);

        const wordData = await getDocumentDataFromId(
          "words",
          sentenceData?.wordId
        );

        expect(wordData?.isMined).toEqual(false);
      }

      await wrappedNewBatch({ sentenceIds: sentenceIdsToMine }, authContext);

      for (const sentenceId of [...sentenceIdsToMine, ...sentenceIdsToIgnore]) {
        const isIgnored = sentenceIdsToIgnore.includes(sentenceId);

        const sentenceData = await getDocumentDataFromId(
          "sentences",
          sentenceId
        );

        expect(sentenceData?.isMined).toEqual(isIgnored ? false : true);
        expect(sentenceData?.isPending).toEqual(false);

        const wordData = await getDocumentDataFromId(
          "words",
          sentenceData?.wordId
        );

        expect(wordData?.isMined).toEqual(isIgnored ? false : true);
      }
    });

    test("newBatch should not work with the same batch being submitted twice", async () => {
      const sentenceIds = await mineTestWords(authContext);
      await expect(
        wrappedNewBatch({ sentenceIds }, authContext)
      ).resolves.toEqual(expect.any(String));
      await expect(
        wrappedNewBatch({ sentenceIds }, authContext)
      ).rejects.toThrow("invalid sentence ids provided");
    });
  });
});

// todo: delete pending sentence
// todo: decrement frequency of the associated word when pending sentence deleted
// todo: add max string cap to word and sentence and reading (req validation)
// todo: make a test that makes sure that non-pending sentences are not counted towards the limit
// todo: make a test that decrements the currentPending number when sentence deletes
// todo: make a test that reset the currenPending number when batch mined
