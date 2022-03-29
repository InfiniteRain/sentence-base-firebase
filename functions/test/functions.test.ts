import "./setup-env";
import {
  projectId,
  timestampMatcher,
  clean,
  initAuth,
  expectErrors,
  expectSuccess,
  addSentence,
  newBatch,
  deleteSentence,
  getPendingSentences,
  getMetaCounter,
  waitForCounterUpdate,
  getUserMetaCounter,
  editSentence,
} from "./helpers";
import * as admin from "firebase-admin";

admin.initializeApp({
  projectId: `${projectId}`,
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

  const getDocumentById = async (collection: string, id: string) =>
    await firestore.collection(collection).doc(id).get();

  const deleteDocumentById = async (collection: string, id: string) =>
    await firestore.collection(collection).doc(id).delete();

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

  beforeEach(async () => {
    await clean();
  });

  describe("logged out", () => {
    jest.setTimeout(10000);

    test("createUserDocument should create new user document", async () => {
      await expect(getDocumentCount("users")).resolves.toEqual(0);

      const [user] = await initAuth();

      await expect(getDocumentCount("users")).resolves.toEqual(1);

      const userData = await getDocumentDataById("users", user.uid);

      expect(userData).toEqual({
        pendingSentences: 0,
      });
    });

    test("createUserDocument should increment the meta counter", async () => {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      await expect(getMetaCounter("users")).resolves.toEqual(0);

      await initAuth();
      await waitForCounterUpdate(0, "users");

      await expect(getMetaCounter("users")).resolves.toEqual(1);

      await initAuth();
      await waitForCounterUpdate(1, "users");

      await expect(getMetaCounter("users")).resolves.toEqual(2);
    });

    test("addSentence should reject", async () => {
      await expectErrors(addSentence("猫", "ネコ", "これは猫です。", []), [
        "Not logged in.",
      ]);
    });

    test("newBatch should reject", async () => {
      await expectErrors(newBatch(["これは猫です。"]), ["Not logged in."]);
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
  });

  describe("logged in", () => {
    let user!: admin.auth.UserRecord;
    let token!: string;

    beforeEach(async () => {
      [user, token] = await initAuth();
    });

    test("meta counters should increment when documents are created", async () => {
      const userUid = user.uid;
      const testDictionaryForm = "猫";
      const testReading = "ネコ";
      const testSentence = "これは猫です。";

      const sentenceIds = [];

      for (let i = 0; i < 5; i++) {
        await expect(getMetaCounter("words")).resolves.toEqual(i);
        await expect(getMetaCounter("sentences")).resolves.toEqual(i);
        await expect(getUserMetaCounter(userUid, "words")).resolves.toEqual(i);
        await expect(getUserMetaCounter(userUid, "sentences")).resolves.toEqual(
          i
        );

        const result = await addSentence(
          `${testDictionaryForm}-${i}`,
          `${testReading}-${i}`,
          `${testSentence}-${i}`,
          ["some", "tags"],
          token
        );

        await Promise.all([
          waitForCounterUpdate(i, "words"),
          waitForCounterUpdate(i, "sentences"),
        ]);
        sentenceIds.push(result.data.sentenceId);

        await expect(getMetaCounter("words")).resolves.toEqual(i + 1);
        await expect(getMetaCounter("sentences")).resolves.toEqual(i + 1);
        await expect(getUserMetaCounter(userUid, "words")).resolves.toEqual(
          i + 1
        );
        await expect(getUserMetaCounter(userUid, "sentences")).resolves.toEqual(
          i + 1
        );
      }

      await expect(getMetaCounter("batches")).resolves.toEqual(0);
      await expect(getUserMetaCounter(userUid, "batches")).resolves.toEqual(0);

      await newBatch(sentenceIds, token);

      await waitForCounterUpdate(0, "batches");
      await expect(getMetaCounter("batches")).resolves.toEqual(1);
      await expect(getUserMetaCounter(userUid, "batches")).resolves.toEqual(1);
    });

    test("meta counters should decrement when documents are deleted", async () => {
      const userUid = user.uid;
      const testDictionaryForm = "猫";
      const testReading = "ネコ";
      const testSentence = "これは猫です。";

      const sentenceIds = [];

      for (let i = 0; i < 5; i++) {
        const result = await addSentence(
          `${testDictionaryForm}-${i}`,
          `${testReading}-${i}`,
          `${testSentence}-${i}`,
          ["some", "tags"],
          token
        );
        await Promise.all([
          waitForCounterUpdate(i, "words"),
          waitForCounterUpdate(i, "sentences"),
        ]);

        sentenceIds.push(result.data.sentenceId);
      }

      const result = await newBatch(sentenceIds, token);
      await waitForCounterUpdate(0, "batches");

      await expect(getMetaCounter("batches")).resolves.toEqual(1);
      await expect(getUserMetaCounter(userUid, "batches")).resolves.toEqual(1);

      await deleteDocumentById("batches", result.data.batchId);
      await waitForCounterUpdate(1, "batches");

      await expect(getMetaCounter("batches")).resolves.toEqual(0);
      await expect(getUserMetaCounter(userUid, "batches")).resolves.toEqual(0);

      for (let i = 4; i >= 0; i--) {
        const sentenceId = sentenceIds[i];
        const wordId = (await getDocumentDataById("sentences", sentenceId))
          ?.wordId;

        await expect(getMetaCounter("words")).resolves.toEqual(i + 1);
        await expect(getMetaCounter("sentences")).resolves.toEqual(i + 1);
        await expect(getUserMetaCounter(userUid, "words")).resolves.toEqual(
          i + 1
        );
        await expect(getUserMetaCounter(userUid, "sentences")).resolves.toEqual(
          i + 1
        );

        await Promise.all([
          waitForCounterUpdate(i + 1, "words"),
          deleteDocumentById("words", wordId),
        ]);

        await Promise.all([
          deleteDocumentById("sentences", sentenceId),
          waitForCounterUpdate(i + 1, "sentences"),
        ]);

        await expect(getMetaCounter("words")).resolves.toEqual(i);
        await expect(getMetaCounter("sentences")).resolves.toEqual(i);
        await expect(getUserMetaCounter(userUid, "words")).resolves.toEqual(i);
        await expect(getUserMetaCounter(userUid, "sentences")).resolves.toEqual(
          i
        );
      }
    });

    test("addSentence should validate", async () => {
      await expectErrors(addSentence("", "", "", [], token));
    });

    test("addSentence should result with a word and a sentence added", async () => {
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
        createdAt: timestampMatcher,
        updatedAt: timestampMatcher,
      });
    });

    test("addSentence should deduplicate tags", async () => {
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

    test("addSentence should increase frequency on duplicate word instead of adding a new word", async () => {
      const testDictionaryForm = "猫";
      const testReading = "ネコ";
      const testSentences = ["これは猫です。", "猫がかわいい", "猫が寝ている"];

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

    test("addSentence should not add more sentences after the limit has been reached", async () => {
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

    test("addSentence should set isMined to false after the word has been mined again", async () => {
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

      await newBatch(sentenceIds, token);

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

    test("newBatch should validate", async () => {
      await expectErrors(newBatch([], token));
    });

    test("newBatch should not work with non-existent sentences", async () => {
      await expectErrors(newBatch(["wrongId"], token), [
        "Invalid sentence IDs provided.",
      ]);
    });

    test("newBatch should not work with non-owned sentences", async () => {
      const [_user2, token2] = await initAuth();
      const sentenceId = (await mineWords([["猫", "ネコ"]], token2))[0];

      await expectErrors(newBatch([sentenceId], token), [
        "Invalid sentence IDs provided.",
      ]);
    });

    test("newBatch should not work with non-pending sentences", async () => {
      const sentenceId = (await mineWords([["猫", "ネコ"]], token))[0];

      await firestore.collection("sentences").doc(sentenceId).update({
        isPending: false,
      });

      await expectErrors(newBatch([sentenceId], token), [
        "Invalid sentence IDs provided.",
      ]);
    });

    test("newBatch should result with a batch being added", async () => {
      const sentenceIds = await mineTestWords(token);
      const result = await newBatch(sentenceIds, token);

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

    test("newBatch should change isMined and isPending accordingly", async () => {
      const sentenceIdsToMine = await mineTestWords(token);
      const sentenceIdsToIgnore = await mineWords(
        [
          ["魚", "サカナ"],
          ["牛乳", "ギュウニュウ"],
        ],
        token
      );

      for (const sentenceId of [...sentenceIdsToMine, ...sentenceIdsToIgnore]) {
        const sentenceData = await getDocumentDataById("sentences", sentenceId);

        expect(sentenceData?.isMined).toEqual(false);
        expect(sentenceData?.isPending).toEqual(true);

        const wordData = await getDocumentDataById(
          "words",
          sentenceData?.wordId
        );

        expect(wordData?.isMined).toEqual(false);
      }

      await newBatch(sentenceIdsToMine, token);

      for (const sentenceId of [...sentenceIdsToMine, ...sentenceIdsToIgnore]) {
        const isIgnored = sentenceIdsToIgnore.includes(sentenceId);

        const sentenceData = await getDocumentDataById("sentences", sentenceId);

        expect(sentenceData?.isMined).toEqual(isIgnored ? false : true);
        expect(sentenceData?.isPending).toEqual(false);

        const wordData = await getDocumentDataById(
          "words",
          sentenceData?.wordId
        );

        expect(wordData?.isMined).toEqual(isIgnored ? false : true);
      }
    });

    test("newBatch should not work with the same batch being submitted twice", async () => {
      const sentenceIds = await mineTestWords(token);
      await expectSuccess(newBatch(sentenceIds, token), {
        batchId: expect.any(String),
      });
      await expectErrors(newBatch(sentenceIds, token), [
        "Invalid sentence IDs provided.",
      ]);
    });

    test("newBatch should reset the user's pendingSentences counter", async () => {
      const oldUserData = await getDocumentDataById("users", user.uid);
      expect(oldUserData?.pendingSentences).toEqual(0);

      const sentenceIds = await mineTestWords(token);

      const newUserData = await getDocumentDataById("users", user.uid);
      expect(newUserData?.pendingSentences).toEqual(10);

      await newBatch(sentenceIds, token);

      const newestUserData = await getDocumentDataById("users", user.uid);
      expect(newestUserData?.pendingSentences).toEqual(0);
    });

    test("deleteSentence should not work with non-existent sentences", async () => {
      await expectErrors(deleteSentence("wrongId", token), [
        "Invalid sentence ID provided.",
      ]);
    });

    test("deleteSentence should not work with non-owned sentences", async () => {
      const [_user2, token2] = await initAuth();
      const sentenceId = (await mineWords([["猫", "ネコ"]], token2))[0];

      await expectErrors(deleteSentence(sentenceId, token), [
        "Invalid sentence ID provided.",
      ]);
    });

    test("deleteSentence should not work with non-pending sentences", async () => {
      const sentenceId = (await mineWords([["猫", "ネコ"]], token))[0];

      await firestore.collection("sentences").doc(sentenceId).update({
        isPending: false,
      });

      await expectErrors(deleteSentence(sentenceId, token), [
        "Invalid sentence ID provided.",
      ]);
    });

    test("deleteSentence should result with the sentence being deleted", async () => {
      const sentenceId = (await mineWords([["猫", "ネコ"]], token))[0];

      const oldSentenceDocSnap = await getDocumentById("sentences", sentenceId);
      expect(oldSentenceDocSnap.exists).toBeTruthy();

      await expectSuccess(deleteSentence(sentenceId, token));

      const newSentenceDocSnap = await getDocumentById("sentences", sentenceId);
      expect(newSentenceDocSnap.exists).toBeFalsy();
    });

    test("deleteSentence should decrement user's pendingSentence counter", async () => {
      const oldUserData = await getDocumentDataById("users", user.uid);
      expect(oldUserData?.pendingSentences).toEqual(0);

      const sentenceId = (await mineWords([["猫", "ネコ"]], token))[0];

      const newUserData = await getDocumentDataById("users", user.uid);
      expect(newUserData?.pendingSentences).toEqual(1);

      await deleteSentence(sentenceId, token);

      const newestUserData = await getDocumentDataById("users", user.uid);
      expect(newestUserData?.pendingSentences).toEqual(0);
    });

    test("deleteSentence should decrement word's frequency counter", async () => {
      const sentenceId = (await mineWords([["猫", "ネコ"]], token))[0];
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

    test("getPendingSentences should work", async () => {
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

      await newBatch(sentenceIds, token);

      const newestQuery = await getPendingSentences(token);

      expect(newestQuery.data.sentences.length).toEqual(0);
    });

    test("editSentence should not work with non-existent sentences", async () => {
      await expectErrors(editSentence("wrongId", "xxx", [], token), [
        "Invalid sentence ID provided.",
      ]);
    });

    test("editSentence should not work with non-owned sentences", async () => {
      const [_user2, token2] = await initAuth();
      const sentenceId = (await mineWords([["猫", "ネコ"]], token2))[0];

      await expectErrors(editSentence(sentenceId, "xxx", [], token), [
        "Invalid sentence ID provided.",
      ]);
    });

    test("editSentence should not work with non-pending sentences", async () => {
      const sentenceId = (await mineWords([["猫", "ネコ"]], token))[0];

      await firestore.collection("sentences").doc(sentenceId).update({
        isPending: false,
      });

      await expectErrors(editSentence(sentenceId, "xxx", [], token), [
        "Invalid sentence ID provided.",
      ]);
    });

    test("editSentence should result with the sentence being edited and deduplicate tags", async () => {
      const sentenceId = (await mineWords([["猫", "ネコ"]], token))[0];

      const oldSentenceDocSnap = await getDocumentById("sentences", sentenceId);
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
          "new sentence",
          ["new", "new", "tags", "tags"],
          token
        )
      );

      const newSentenceDocSnap = await getDocumentById("sentences", sentenceId);
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
});

// todo: add better tests for validation
