/* eslint-disable require-jsdoc */

export class ActionHttpError extends Error {
  constructor(public readonly code: number, public readonly message: string) {
    super();
  }
}
