import "./setup-env";
import {
  projectId,
  clean,
  initAuth,
  addSentence,
  newBatch,
  getMetaCounter,
  waitForCounterUpdate,
  getUserMetaCounter,
  waitForEventIdAddition,
} from "./helpers";
import * as admin from "firebase-admin";

admin.initializeApp({
  projectId: `${projectId}`,
});

describe("Function tests", () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("You're not running the test suite in an emulator!");
  }

  jest.setTimeout(10000);

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

  beforeEach(async () => {
    await clean();
  });

  describe("logged out", () => {
    test("incrementCountersOnCreate and decrementCountersOnDelete should record the eventIds", async () => {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      const originalCount = await getDocumentCount("eventIds");

      const [user] = await initAuth();

      await waitForEventIdAddition(originalCount);
      await expect(getDocumentCount("eventIds")).resolves.toEqual(
        originalCount + 1
      );

      await firestore.collection("users").doc(user.uid).delete();

      await waitForEventIdAddition(originalCount + 1);
      await expect(getDocumentCount("eventIds")).resolves.toEqual(
        originalCount + 2
      );

      // Infinite loop check
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await expect(getDocumentCount("eventIds")).resolves.toEqual(
        originalCount + 2
      );
    });

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
          waitForCounterUpdate(i, "words", userUid),
          waitForCounterUpdate(i, "sentences", userUid),
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

      await waitForCounterUpdate(0, "batches", userUid);
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
          waitForCounterUpdate(i, "words", userUid),
          waitForCounterUpdate(i, "sentences", userUid),
        ]);

        sentenceIds.push(result.data.sentenceId);
      }

      const result = await newBatch(sentenceIds, token);
      await waitForCounterUpdate(0, "batches", userUid);

      await expect(getMetaCounter("batches")).resolves.toEqual(1);
      await expect(getUserMetaCounter(userUid, "batches")).resolves.toEqual(1);

      await deleteDocumentById("batches", result.data.batchId);
      await waitForCounterUpdate(1, "batches", userUid);

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
          waitForCounterUpdate(i + 1, "words", userUid),
          deleteDocumentById("words", wordId),
        ]);

        await Promise.all([
          deleteDocumentById("sentences", sentenceId),
          waitForCounterUpdate(i + 1, "sentences", userUid),
        ]);

        await expect(getMetaCounter("words")).resolves.toEqual(i);
        await expect(getMetaCounter("sentences")).resolves.toEqual(i);
        await expect(getUserMetaCounter(userUid, "words")).resolves.toEqual(i);
        await expect(getUserMetaCounter(userUid, "sentences")).resolves.toEqual(
          i
        );
      }
    });
  });
});
