import * as admin from "firebase-admin";
import * as functions from "firebase-functions";
import { server } from "./http-api/server";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: admin.auth.DecodedIdToken;
    }
  }
}

admin.initializeApp();

/**
 * Expose the REST API through the HTTPS function.
 */
export const api = functions.https.onRequest(server);

/**
 * Update the meta information upon document creation.
 */
export const incrementCountersOnCreate = functions.firestore
  .document("{collection}/{documentId}")
  .onCreate(async (change, context) => {
    const { updateCounters } = await import("./actions/counters");

    await updateCounters(change, context, "increment");
  });

/**
 * Update the meta information upon document deletion.
 */
export const decrementCountersOnDelete = functions.firestore
  .document("{collection}/{documentId}")
  .onDelete(async (change, context) => {
    const { updateCounters } = await import("./actions/counters");

    await updateCounters(change, context, "decrement");
  });

/**
 * Create a user document upon registration.
 */
export const createUserDocument = functions.auth
  .user()
  .onCreate(async (user) => {
    const { addNewUserDocument } = await import("./actions/users");

    await addNewUserDocument(user);
  });

/**
 * Clean all event ID records that are older then 1 hour.
 */
export const cleanEventIds = functions.pubsub
  .schedule("every 1 hours")
  .onRun(async () => {
    const { eventIdCleanup } = await import("./actions/idempotency");

    await eventIdCleanup();
  });
