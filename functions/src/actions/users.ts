import type { UserRecord } from "firebase-functions/v1/auth";

export const addNewUserDocument = async (user: UserRecord) => {
  const { usersCollection } = await import("../shared");

  await usersCollection.doc(user.uid).set({
    pendingSentences: 0,
  });
};
