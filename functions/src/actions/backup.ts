import { GoogleAuth } from "google-auth-library";

const { projectId } = JSON.parse(process.env.FIREBASE_CONFIG || "{}");
const backupStorageBucket = `${projectId}-backups`;

export const backup = async () => {
  const auth = new GoogleAuth({
    scopes: [
      "https://www.googleapis.com/auth/datastore",
      "https://www.googleapis.com/auth/cloud-platform",
    ],
  });
  const client = await auth.getClient();
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default):exportDocuments`;
  const backupFileName = new Date().toISOString();
  const backupUrl = `gs://${backupStorageBucket}/${backupFileName}`;

  await client.request({
    url,
    method: "POST",
    data: { outputUriPrefix: backupUrl },
  });
};
