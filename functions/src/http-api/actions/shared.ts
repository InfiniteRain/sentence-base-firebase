/* eslint-disable require-jsdoc */

export type ActionFailure = {
  type: "failure";
  code: number;
  errors: unknown[];
};

export type ActionSuccess<T> = {
  type: "success";
  data: T;
};

export type ActionResult<T = undefined> = ActionFailure | ActionSuccess<T>;

export const failureAction = (
  code: number,
  errors: unknown[]
): ActionFailure => ({
  type: "failure",
  code,
  errors,
});

export const successAction = <T>(data: T): ActionSuccess<T> => ({
  type: "success",
  data,
});

export class ActionError extends Error {
  constructor(public readonly code: number, public readonly message: string) {
    super();
  }
}

export const wrapTransaction = async <T>(
  promise: Promise<T>
): Promise<ActionResult<T>> => {
  try {
    return successAction(await promise);
  } catch (error) {
    if (error instanceof ActionError) {
      return failureAction(error.code, [error.message]);
    }

    return failureAction(500, ["Unexpected Error"]);
  }
};
