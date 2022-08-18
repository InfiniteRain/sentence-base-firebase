import "./setup-env";
import {
  projectId,
  timestampMatcher,
  clean,
  initAuth,
  expectErrors,
  expectSuccess,
  addSentence,
  createBatch,
  deleteSentence,
  getPendingSentences,
  editSentence,
  createBatchFromBacklog,
} from "./helpers";
import * as admin from "firebase-admin";

admin.initializeApp({
  projectId: `${projectId}`,
});

describe("Api tests", () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("You're not running the test suite in an emulator!");
  }

  jest.setTimeout(10000);

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
  const backlogTestWords: [string, string][] = [
    ["ペン", "ペン"],
    ["魑魅魍魎", "チミモウリョウ"],
    ["勝ち星", "カチボシ"],
    ["猫", "ネコ"],
    ["犬", "イヌ"],
    ["学校", "ガッコウ"],
    ["家", "イエ"],
  ];

  const firestore = admin.firestore();

  const getDocumentById = async (collection: string, id: string) =>
    await firestore.collection(collection).doc(id).get();

  const getDocumentDataById = async (
    collection: string,
    id: string
  ): Promise<FirebaseFirestore.DocumentData | undefined> =>
    (await getDocumentById(collection, id)).data();

  const getDocumentCount = async (collection: string): Promise<number> => {
    const snap = await firestore.collection(collection).get();
    return snap.docs.length;
  };

  const mineWords = async (
    words: [string, string][],
    token: string
  ): Promise<string[]> => {
    const sentenceIds: string[] = [];

    for (const [dictionaryForm, reading] of words) {
      const result = await addSentence(
        dictionaryForm,
        reading,
        `${dictionaryForm}の文`,
        ["some", "tags"],
        token
      );

      sentenceIds.push(result.data.sentenceId);
    }

    return sentenceIds;
  };

  const mineTestWords = async (token: string): Promise<string[]> =>
    await mineWords(testWords, token);

  const prepareBacklogWords = async (
    words: [string, string][],
    token: string
  ): Promise<string[]> => {
    const dummySentence = await addSentence(
      "dummy",
      "dummy",
      "dummy sentence",
      [],
      token
    );
    const sentenceIds: string[] = [];

    for (const [dictionaryForm, reading] of words) {
      const result = await addSentence(
        dictionaryForm,
        reading,
        `${dictionaryForm}の文`,
        ["some", "tags"],
        token
      );

      sentenceIds.push(result.data.sentenceId);
    }

    // Batching dummy data normally, thus making all words in backlogTestWords
    // being marked as non-pending.
    await createBatch([dummySentence.data.sentenceId], token);

    // All the remaining sentence IDs thus have isPending and isMining both
    // set to false.
    return sentenceIds;
  };

  const prepareTestBacklogWords = async (token: string): Promise<string[]> =>
    await prepareBacklogWords(backlogTestWords, token);

  beforeEach(async () => {
    await clean();
  });

  describe("logged out", () => {
    test("addSentence should reject", async () => {
      await expectErrors(addSentence("猫", "ネコ", "これは猫です。", []), [
        "Not logged in.",
      ]);
    });

    test("newBatch should reject", async () => {
      await expectErrors(createBatch(["これは猫です。"]), ["Not logged in."]);
    });

    test("deleteSentence should reject", async () => {
      await expectErrors(deleteSentence("xxx"), ["Not logged in."]);
    });

    test("editSentence should reject", async () => {
      await expectErrors(editSentence("xxx", "これは猫です。", []), [
        "Not logged in.",
      ]);
    });

    test("getPendingSentences should reject", async () => {
      await expectErrors(getPendingSentences(), ["Not logged in."]);
    });

    test("batchFromBacklog should reject", async () => {
      await expectErrors(createBatchFromBacklog([], [], []), [
        "Not logged in.",
      ]);
    });
  });

  describe("logged in", () => {
    let user!: admin.auth.UserRecord;
    let token!: string;

    beforeEach(async () => {
      [user, token] = await initAuth();
    });

    describe("addSentence", () => {
      test("should validate", async () => {
        await expectErrors(addSentence("", "", "", [], token));
      });

      test("should result with a word and a sentence added", async () => {
        const testDictionaryForm = "猫";
        const testReading = "ネコ";
        const testSentence = "これは猫です。";

        const result = await addSentence(
          testDictionaryForm,
          testReading,
          testSentence,
          ["some", "tags"],
          token
        );

        const sentenceSnapData = await getDocumentDataById(
          "sentences",
          result.data.sentenceId
        );

        expect(sentenceSnapData).toEqual({
          userUid: user.uid,
          wordId: expect.any(String),
          sentence: testSentence,
          isPending: true,
          isMined: false,
          tags: ["some", "tags"],
          createdAt: timestampMatcher,
          updatedAt: timestampMatcher,
        });

        const wordSnapData = await getDocumentDataById(
          "words",
          sentenceSnapData?.wordId
        );

        expect(wordSnapData).toEqual({
          userUid: user.uid,
          dictionaryForm: testDictionaryForm,
          reading: testReading,
          frequency: 1,
          isMined: false,
          buryLevel: 0,
          createdAt: timestampMatcher,
          updatedAt: timestampMatcher,
        });
      });

      test("should deduplicate tags", async () => {
        const testDictionaryForm = "猫";
        const testReading = "ネコ";
        const testSentence = "これは猫です。";

        const result = await addSentence(
          testDictionaryForm,
          testReading,
          testSentence,
          ["some", "some", "tags", "tags"],
          token
        );

        const sentenceSnapData = await getDocumentDataById(
          "sentences",
          result.data.sentenceId
        );

        expect(sentenceSnapData).toEqual({
          userUid: user.uid,
          wordId: expect.any(String),
          sentence: testSentence,
          isPending: true,
          isMined: false,
          tags: ["some", "tags"],
          createdAt: timestampMatcher,
          updatedAt: timestampMatcher,
        });
      });

      test("should trim fields", async () => {
        const testDictionaryForm = "猫";
        const testReading = "ネコ";
        const testSentence = "これは猫です。";

        const result = await addSentence(
          ` ${testDictionaryForm} `,
          ` ${testReading} `,
          ` ${testSentence} `,
          ["some", "tags"],
          token
        );

        const sentenceSnapData = await getDocumentDataById(
          "sentences",
          result.data.sentenceId
        );

        expect(sentenceSnapData).toEqual({
          userUid: user.uid,
          wordId: expect.any(String),
          sentence: testSentence,
          isPending: true,
          isMined: false,
          tags: ["some", "tags"],
          createdAt: timestampMatcher,
          updatedAt: timestampMatcher,
        });

        const wordSnapData = await getDocumentDataById(
          "words",
          sentenceSnapData?.wordId
        );

        expect(wordSnapData).toEqual({
          userUid: user.uid,
          dictionaryForm: testDictionaryForm,
          reading: testReading,
          frequency: 1,
          isMined: false,
          buryLevel: 0,
          createdAt: timestampMatcher,
          updatedAt: timestampMatcher,
        });
      });

      test("should increase frequency on duplicate word instead of adding a new word", async () => {
        const testDictionaryForm = "猫";
        const testReading = "ネコ";
        const testSentences = [
          "これは猫です。",
          "猫がかわいい",
          "猫が寝ている",
        ];

        let wordId: string | undefined;

        for (const testSentence of testSentences) {
          const result = await addSentence(
            testDictionaryForm,
            testReading,
            testSentence,
            [],
            token
          );

          const sentenceSnapData = await getDocumentDataById(
            "sentences",
            result.data.sentenceId
          );

          wordId = wordId ?? sentenceSnapData?.wordId;

          expect(wordId).toBeDefined();
          expect(sentenceSnapData).toEqual({
            userUid: user.uid,
            wordId,
            sentence: sentenceSnapData?.sentence,
            isPending: true,
            isMined: false,
            tags: [],
            createdAt: timestampMatcher,
            updatedAt: timestampMatcher,
          });
        }

        const wordSnapData = await getDocumentDataById("words", wordId ?? "");

        expect(wordSnapData).toEqual({
          userUid: user.uid,
          dictionaryForm: testDictionaryForm,
          reading: testReading,
          frequency: 3,
          isMined: false,
          buryLevel: 0,
          createdAt: timestampMatcher,
          updatedAt: timestampMatcher,
        });

        await new Promise((resolve) => setTimeout(resolve, 1000));
        expect(wordSnapData?.updatedAt > wordSnapData?.createdAt).toBeTruthy();

        const existingWordRef = await firestore
          .collection("words")
          .where("userUid", "==", user.uid)
          .get();
        expect(existingWordRef.docs.length).toEqual(1);
      });

      test("should not add more sentences after the limit has been reached", async () => {
        const maximumPendingSentences = 15;
        const oldUserData = await getDocumentDataById("users", user.uid);
        expect(oldUserData?.pendingSentences).toEqual(0);

        for (let i = 0; i < maximumPendingSentences; i++) {
          await addSentence("猫", "ネコ", `${i}匹目の猫が現れる`, [], token);
        }

        const newUserData = await getDocumentDataById("users", user.uid);

        expect(newUserData?.pendingSentences).toEqual(maximumPendingSentences);
        await expect(getDocumentCount("sentences")).resolves.toEqual(
          maximumPendingSentences
        );

        const addSentencePromise = addSentence(
          "猫",
          "ネコ",
          "もう一匹の猫が現れる",
          [],
          token
        );

        await expectErrors(addSentencePromise, [
          "Pending sentences limit reached.",
        ]);
        await expect(getDocumentCount("sentences")).resolves.toEqual(
          maximumPendingSentences
        );
      });

      test("should set isMined to false after the word has been mined again", async () => {
        const sentenceIds = await mineTestWords(token);
        const sentenceData = await getDocumentDataById(
          "sentences",
          sentenceIds[0]
        );

        const oldWordData = await getDocumentDataById(
          "words",
          sentenceData?.wordId
        );
        expect(oldWordData?.isMined).toEqual(false);

        await createBatch(sentenceIds, token);

        const newWordData = await getDocumentDataById(
          "words",
          sentenceData?.wordId
        );
        expect(newWordData?.isMined).toEqual(true);

        await addSentence(
          newWordData?.dictionaryForm,
          newWordData?.reading,
          `${newWordData?.dictionaryForm}の文`,
          [],
          token
        );

        const newestWordData = await getDocumentDataById(
          "words",
          sentenceData?.wordId
        );
        expect(newestWordData?.isMined).toEqual(false);
      });
    });

    describe("newBatch", () => {
      test("should validate", async () => {
        await expectErrors(createBatch([], token));
      });

      test("should not work with non-existent sentences", async () => {
        await expectErrors(createBatch(["wrongId"], token), [
          "Invalid sentence IDs provided.",
        ]);
      });

      test("should not work with non-owned sentences", async () => {
        const [_user2, token2] = await initAuth();
        const [sentenceId] = await mineWords([["猫", "ネコ"]], token2);

        await expectErrors(createBatch([sentenceId], token), [
          "Invalid sentence IDs provided.",
        ]);
      });

      test("should not work with non-pending sentences", async () => {
        const [sentenceId] = await mineWords([["猫", "ネコ"]], token);

        await firestore.collection("sentences").doc(sentenceId).update({
          isPending: false,
        });

        await expectErrors(createBatch([sentenceId], token), [
          "Invalid sentence IDs provided.",
        ]);
      });

      test("should result with a batch being added", async () => {
        const sentenceIds = await mineTestWords(token);
        const result = await createBatch(sentenceIds, token);

        expect(result.data.batchId).toEqual(expect.any(String));

        const batchData = await getDocumentDataById(
          "batches",
          result.data.batchId
        );

        expect(batchData).toEqual({
          userUid: user.uid,
          sentences: expect.arrayContaining([
            {
              sentenceId: expect.any(String),
              sentence: expect.any(String),
              wordDictionaryForm: expect.any(String),
              wordReading: expect.any(String),
              tags: ["some", "tags"],
            },
          ]),
          createdAt: timestampMatcher,
          updatedAt: timestampMatcher,
        });
      });

      test("should change isMined and isPending accordingly", async () => {
        const sentenceIdsToMine = await mineTestWords(token);
        const sentenceIdsToIgnore = await mineWords(
          [
            ["魚", "サカナ"],
            ["牛乳", "ギュウニュウ"],
          ],
          token
        );

        for (const sentenceId of [
          ...sentenceIdsToMine,
          ...sentenceIdsToIgnore,
        ]) {
          const sentenceData = await getDocumentDataById(
            "sentences",
            sentenceId
          );

          expect(sentenceData?.isMined).toEqual(false);
          expect(sentenceData?.isPending).toEqual(true);

          const wordData = await getDocumentDataById(
            "words",
            sentenceData?.wordId
          );

          expect(wordData?.isMined).toEqual(false);
        }

        await createBatch(sentenceIdsToMine, token);

        for (const sentenceId of [
          ...sentenceIdsToMine,
          ...sentenceIdsToIgnore,
        ]) {
          const isIgnored = sentenceIdsToIgnore.includes(sentenceId);

          const sentenceData = await getDocumentDataById(
            "sentences",
            sentenceId
          );

          expect(sentenceData?.isMined).toEqual(isIgnored ? false : true);
          expect(sentenceData?.isPending).toEqual(false);

          const wordData = await getDocumentDataById(
            "words",
            sentenceData?.wordId
          );

          expect(wordData?.isMined).toEqual(isIgnored ? false : true);
        }
      });

      test("should not work with the same batch being submitted twice", async () => {
        const sentenceIds = await mineTestWords(token);
        await expectSuccess(createBatch(sentenceIds, token), {
          batchId: expect.any(String),
        });
        await expectErrors(createBatch(sentenceIds, token), [
          "Invalid sentence IDs provided.",
        ]);
      });

      test("should reset the user's pendingSentences counter", async () => {
        const oldUserData = await getDocumentDataById("users", user.uid);
        expect(oldUserData?.pendingSentences).toEqual(0);

        const sentenceIds = await mineTestWords(token);

        const newUserData = await getDocumentDataById("users", user.uid);
        expect(newUserData?.pendingSentences).toEqual(10);

        await createBatch(sentenceIds, token);

        const newestUserData = await getDocumentDataById("users", user.uid);
        expect(newestUserData?.pendingSentences).toEqual(0);
      });
    });

    describe("deleteSentence", () => {
      test("should not work with non-existent sentences", async () => {
        await expectErrors(deleteSentence("wrongId", token), [
          "Invalid sentence ID provided.",
        ]);
      });

      test("should not work with non-owned sentences", async () => {
        const [_user2, token2] = await initAuth();
        const [sentenceId] = await mineWords([["猫", "ネコ"]], token2);

        await expectErrors(deleteSentence(sentenceId, token), [
          "Invalid sentence ID provided.",
        ]);
      });

      test("should not work with non-pending sentences", async () => {
        const [sentenceId] = await mineWords([["猫", "ネコ"]], token);

        await firestore.collection("sentences").doc(sentenceId).update({
          isPending: false,
        });

        await expectErrors(deleteSentence(sentenceId, token), [
          "Invalid sentence ID provided.",
        ]);
      });

      test("should result with the sentence being deleted", async () => {
        const [sentenceId] = await mineWords([["猫", "ネコ"]], token);

        const oldSentenceDocSnap = await getDocumentById(
          "sentences",
          sentenceId
        );
        expect(oldSentenceDocSnap.exists).toBeTruthy();

        await expectSuccess(deleteSentence(sentenceId, token));

        const newSentenceDocSnap = await getDocumentById(
          "sentences",
          sentenceId
        );
        expect(newSentenceDocSnap.exists).toBeFalsy();
      });

      test("should decrement user's pendingSentence counter", async () => {
        const oldUserData = await getDocumentDataById("users", user.uid);
        expect(oldUserData?.pendingSentences).toEqual(0);

        const [sentenceId] = await mineWords([["猫", "ネコ"]], token);

        const newUserData = await getDocumentDataById("users", user.uid);
        expect(newUserData?.pendingSentences).toEqual(1);

        await deleteSentence(sentenceId, token);

        const newestUserData = await getDocumentDataById("users", user.uid);
        expect(newestUserData?.pendingSentences).toEqual(0);
      });

      test("should decrement word's frequency counter", async () => {
        const [sentenceId] = await mineWords([["猫", "ネコ"]], token);
        const sentenceData = await getDocumentDataById("sentences", sentenceId);

        const oldWordData = await getDocumentDataById(
          "words",
          sentenceData?.wordId
        );
        expect(oldWordData?.frequency).toEqual(1);

        await deleteSentence(sentenceId, token);

        const newWordData = await getDocumentDataById(
          "words",
          sentenceData?.wordId
        );
        expect(newWordData?.frequency).toEqual(0);
        expect(newWordData?.updatedAt > oldWordData?.updatedAt).toBeTruthy();
      });
    });

    describe("getPendingSentences", () => {
      test("should work", async () => {
        const oldQueryResult = await getPendingSentences(token);
        expect(oldQueryResult.data.sentences.length).toEqual(0);

        const sentenceIds = await mineTestWords(token);
        const newQueryResult = await getPendingSentences(token);

        expect(newQueryResult.data.sentences.length).toEqual(10);
        for (const [id, testSentence] of testWords.reverse().entries()) {
          expect(newQueryResult.data.sentences[id]).toEqual({
            sentenceId: expect.any(String),
            wordId: expect.any(String),
            dictionaryForm: testSentence[0],
            reading: testSentence[1],
            sentence: expect.any(String),
            frequency: expect.any(Number),
            tags: ["some", "tags"],
          });
        }

        await createBatch(sentenceIds, token);

        const newestQuery = await getPendingSentences(token);

        expect(newestQuery.data.sentences.length).toEqual(0);
      });
    });

    describe("editSentence", () => {
      test("should not work with non-existent sentences", async () => {
        await expectErrors(editSentence("wrongId", "xxx", [], token), [
          "Invalid sentence ID provided.",
        ]);
      });

      test("should not work with non-owned sentences", async () => {
        const [_user2, token2] = await initAuth();
        const [sentenceId] = await mineWords([["猫", "ネコ"]], token2);

        await expectErrors(editSentence(sentenceId, "xxx", [], token), [
          "Invalid sentence ID provided.",
        ]);
      });

      test("should not work with non-pending sentences", async () => {
        const [sentenceId] = await mineWords([["猫", "ネコ"]], token);

        await firestore.collection("sentences").doc(sentenceId).update({
          isPending: false,
        });

        await expectErrors(editSentence(sentenceId, "xxx", [], token), [
          "Invalid sentence ID provided.",
        ]);
      });

      test("should result with the sentence being edited, tags deduplicated and fields trimmed", async () => {
        const [sentenceId] = await mineWords([["猫", "ネコ"]], token);

        const oldSentenceDocSnap = await getDocumentById(
          "sentences",
          sentenceId
        );
        const oldData = oldSentenceDocSnap.data();
        expect(oldData).toEqual({
          sentence: "猫の文",
          wordId: expect.any(String),
          isPending: true,
          tags: ["some", "tags"],
          isMined: false,
          userUid: expect.any(String),
          createdAt: timestampMatcher,
          updatedAt: timestampMatcher,
        });

        await expectSuccess(
          editSentence(
            sentenceId,
            " new sentence  ",
            ["new", "new", "tags", "tags"],
            token
          )
        );

        const newSentenceDocSnap = await getDocumentById(
          "sentences",
          sentenceId
        );
        const newData = newSentenceDocSnap.data();
        expect(newData).toEqual({
          sentence: "new sentence",
          wordId: expect.any(String),
          isPending: true,
          tags: ["new", "tags"],
          isMined: false,
          userUid: expect.any(String),
          createdAt: timestampMatcher,
          updatedAt: timestampMatcher,
        });
        expect(newData?.updatedAt > oldData?.updatedAt).toBeTruthy();
      });
    });

    describe("batchFromBacklog", () => {
      test("should validate", async () => {
        await expectErrors(createBatchFromBacklog([], [], [], token));
      });

      test("should not work with duplicate values between arrays", async () => {
        const expectedErrors = [
          "IDs passed in sentences, markAsMined and pushToTheEnd have to be unique between arrays.",
        ];

        await expectErrors(
          createBatchFromBacklog(["sameId"], [], ["sameId"], token),
          expectedErrors
        );
        await expectErrors(
          createBatchFromBacklog(["sameId"], ["sameId"], [], token),
          expectedErrors
        );
        await expectErrors(
          createBatchFromBacklog(["sameId"], ["sameId"], ["sameId"], token),
          expectedErrors
        );
      });

      test("should not work with non-existent sentences or words", async () => {
        const [sentenceId] = await prepareBacklogWords([["猫", "ネコ"]], token);

        await expectErrors(createBatchFromBacklog(["wrongId"], [], [], token), [
          "Invalid sentence IDs provided.",
        ]);
        await expectErrors(
          createBatchFromBacklog([sentenceId], ["wrongId"], [], token),
          ["Invalid sentence IDs in markAsMined provided."]
        );
        await expectErrors(
          createBatchFromBacklog([sentenceId], [], ["wrongId"], token),
          ["Invalid sentence IDs in pushToTheEnd provided."]
        );
      });

      test("should not work with non-owned sentences or words", async () => {
        const [_user2, token2] = await initAuth();
        const [ownedSentenceId] = await prepareBacklogWords(
          [["猫", "ネコ"]],
          token
        );
        const [foreignSentenceId] = await prepareBacklogWords(
          [["猫", "ネコ"]],
          token2
        );

        await expectErrors(
          createBatchFromBacklog([foreignSentenceId], [], [], token),
          ["Invalid sentence IDs provided."]
        );
        await expectErrors(
          createBatchFromBacklog(
            [ownedSentenceId],
            [foreignSentenceId],
            [],
            token
          ),
          ["Invalid sentence IDs in markAsMined provided."]
        );
        await expectErrors(
          createBatchFromBacklog(
            [ownedSentenceId],
            [],
            [foreignSentenceId],
            token
          ),
          ["Invalid sentence IDs in pushToTheEnd provided."]
        );
      });

      test("should not work with pending sentences", async () => {
        const [sentenceId] = await mineWords([["猫", "ネコ"]], token);

        await expectErrors(
          createBatchFromBacklog([sentenceId], [], [], token),
          ["Invalid sentence IDs provided."]
        );
      });

      test("should result with a batch being added", async () => {
        const nonPendingSentenceIds = await prepareTestBacklogWords(token);

        const result = await createBatchFromBacklog(
          nonPendingSentenceIds,
          [],
          [],
          token
        );

        const batchData = await getDocumentDataById(
          "batches",
          result.data.batchId
        );

        expect(batchData).toEqual({
          userUid: user.uid,
          sentences: expect.arrayContaining([
            {
              sentenceId: expect.any(String),
              sentence: expect.any(String),
              wordDictionaryForm: expect.any(String),
              wordReading: expect.any(String),
              tags: ["some", "tags"],
            },
          ]),
          createdAt: timestampMatcher,
          updatedAt: timestampMatcher,
        });
      });

      test("should change isMined accordingly", async () => {
        const sentenceIdsToBatch = await prepareTestBacklogWords(token);
        const sentenceIdsToIgnore = await prepareBacklogWords(
          [
            ["魚", "サカナ"],
            ["牛乳", "ギュウニュウ"],
          ],
          token
        );

        for (const sentenceId of [
          ...sentenceIdsToBatch,
          ...sentenceIdsToIgnore,
        ]) {
          const sentenceData = await getDocumentDataById(
            "sentences",
            sentenceId
          );

          expect(sentenceData?.isMined).toEqual(false);
          expect(sentenceData?.isPending).toEqual(false);

          const wordData = await getDocumentDataById(
            "words",
            sentenceData?.wordId
          );

          expect(wordData?.isMined).toEqual(false);
        }

        await createBatchFromBacklog(sentenceIdsToBatch, [], [], token);

        for (const sentenceId of [
          ...sentenceIdsToBatch,
          ...sentenceIdsToIgnore,
        ]) {
          const isIgnored = sentenceIdsToIgnore.includes(sentenceId);
          const sentenceData = await getDocumentDataById(
            "sentences",
            sentenceId
          );

          expect(sentenceData?.isMined).toEqual(!isIgnored);
          expect(sentenceData?.isPending).toEqual(false);

          const wordData = await getDocumentDataById(
            "words",
            sentenceData?.wordId
          );

          expect(wordData?.isMined).toEqual(!isIgnored);
        }
      });

      test("should not work with the same batch being submitted twice", async () => {
        const sentenceIds = await prepareTestBacklogWords(token);
        await expectSuccess(
          createBatchFromBacklog(sentenceIds, [], [], token),
          {
            batchId: expect.any(String),
          }
        );
        await expectErrors(createBatchFromBacklog(sentenceIds, [], [], token), [
          "Invalid sentence IDs provided.",
        ]);
      });

      test("should not reset the user's pendingSentences counter", async () => {
        const sentenceIds = await prepareTestBacklogWords(token);

        const oldUserData = await getDocumentDataById("users", user.uid);
        expect(oldUserData?.pendingSentences).toEqual(0);

        await mineTestWords(token);

        const newUserData = await getDocumentDataById("users", user.uid);
        expect(newUserData?.pendingSentences).toEqual(10);

        await createBatchFromBacklog(sentenceIds, [], [], token);

        const newestUserData = await getDocumentDataById("users", user.uid);
        expect(newestUserData?.pendingSentences).toEqual(10);
      });

      test("should mark all words in markAsMined as mined", async () => {
        const sentenceIds = await prepareTestBacklogWords(token);
        const markAsMined = [];

        for (const sentenceId of [sentenceIds[0], sentenceIds[1]]) {
          markAsMined.push(
            (await getDocumentDataById("sentences", sentenceId))?.wordId
          );
        }

        const idsToIgnore = [sentenceIds[2], sentenceIds[3]];
        const batchAsNormal = sentenceIds.slice(4);

        for (const wordId of markAsMined) {
          const wordData = await getDocumentDataById("words", wordId);

          expect(wordData?.isMined).toEqual(false);
        }

        await createBatchFromBacklog(batchAsNormal, markAsMined, [], token);

        for (const sentenceId of sentenceIds) {
          const isIgnored = idsToIgnore.includes(sentenceId);
          const sentenceData = await getDocumentDataById(
            "sentences",
            sentenceId
          );
          const wordData = await getDocumentDataById(
            "words",
            sentenceData?.wordId
          );

          expect(wordData?.isMined).toEqual(!isIgnored);
        }
      });

      test("should increment buryLevel of all words in pushToTheEnd", async () => {
        const sentenceIds = await prepareTestBacklogWords(token);
        const pushToTheEnd = [];

        for (const sentenceId of [sentenceIds[0], sentenceIds[1]]) {
          pushToTheEnd.push(
            (await getDocumentDataById("sentences", sentenceId))?.wordId
          );
        }

        const firstBatch = [sentenceIds[2], sentenceIds[3]];
        const secondBatch = sentenceIds.slice(4);

        for (const wordId of pushToTheEnd) {
          const wordData = await getDocumentDataById("words", wordId);

          expect(wordData?.buryLevel).toEqual(0);
        }

        await createBatchFromBacklog(firstBatch, [], pushToTheEnd, token);

        for (const wordId of pushToTheEnd) {
          const wordData = await getDocumentDataById("words", wordId);

          expect(wordData?.buryLevel).toEqual(1);
        }

        await createBatchFromBacklog(secondBatch, [], pushToTheEnd, token);

        for (const wordId of pushToTheEnd) {
          const wordData = await getDocumentDataById("words", wordId);

          expect(wordData?.buryLevel).toEqual(2);
        }
      });

      test("should mark all words in markAsMined as mined and increment buryLevel of all words in pushToTheEnd", async () => {
        const sentenceIds = await prepareTestBacklogWords(token);
        const markAsMined = [];
        const pushToTheEnd = [];

        for (const sentenceId of [sentenceIds[0], sentenceIds[1]]) {
          markAsMined.push(
            (await getDocumentDataById("sentences", sentenceId))?.wordId
          );
        }

        for (const sentenceId of [sentenceIds[2], sentenceIds[3]]) {
          pushToTheEnd.push(
            (await getDocumentDataById("sentences", sentenceId))?.wordId
          );
        }

        const batch = sentenceIds.slice(4);

        for (const wordId of markAsMined) {
          const wordData = await getDocumentDataById("words", wordId);

          expect(wordData?.isMined).toEqual(false);
        }

        for (const wordId of pushToTheEnd) {
          const wordData = await getDocumentDataById("words", wordId);

          expect(wordData?.buryLevel).toEqual(0);
        }

        await createBatchFromBacklog(batch, markAsMined, pushToTheEnd, token);

        for (const wordId of markAsMined) {
          const wordData = await getDocumentDataById("words", wordId);

          expect(wordData?.isMined).toEqual(true);
        }

        for (const wordId of pushToTheEnd) {
          const wordData = await getDocumentDataById("words", wordId);

          expect(wordData?.buryLevel).toEqual(1);
        }
      });
    });
  });
});

// todo: add better tests for validation
