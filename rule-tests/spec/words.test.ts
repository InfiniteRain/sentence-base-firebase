import { setup, teardown } from "./helpers";
// import firebase from "firebase";
import { assertFails } from "@firebase/testing";

describe("Word tests", () => {
  let db!: firebase.firestore.Firestore;

  afterAll(async () => {
    await teardown();
  });

  describe("Logged out", () => {
    beforeEach(async () => {
      db = await setup();
    });

    test("should not have access to collections by default", async () => {
      const ref = db.collection("nonexistent-collection");
      await assertFails(ref.get());
    });

    test("should not be able to create a new word unauthed", async () => {
      const wordsRef = db.collection("words");

      const addPromise = wordsRef.add({
        user_uid: "testUser",
        dictionary_form: "CAT",
        reading: "cat",
      });

      await assertFails(addPromise);
    });
  });
});
