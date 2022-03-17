import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { server } from "./server";

declare global {
  namespace Express {
    interface Request {
      user?: admin.auth.DecodedIdToken;
    }
  }
}

admin.initializeApp();

/**
 * Creates a user document upon registration.
 */
export const createUserDocument = functions.auth
  .user()
  .onCreate(async (user) => {
    const firestore = admin.firestore();
    const usersCollection = firestore.collection("users");

    await usersCollection.doc(user.uid).set({
      pendingSentences: 0,
    });
  });

/**
 * Exposes the REST API through the HTTPS function.
 */
export const api = functions.https.onRequest(server);
