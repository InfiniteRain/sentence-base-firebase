export const config = {
  maximumPendingSentences: process.env.FUNCTIONS_EMULATOR !== "true" ? 200 : 15,
};
