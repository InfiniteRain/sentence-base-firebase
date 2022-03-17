import "dotenv/config";
import firebaseJson from "../../firebase.json";

process.env.FIRESTORE_EMULATOR_HOST = `localhost:${firebaseJson.emulators.firestore.port}`;
process.env.FIREBASE_AUTH_EMULATOR_HOST = `localhost:${firebaseJson.emulators.auth.port}`;
