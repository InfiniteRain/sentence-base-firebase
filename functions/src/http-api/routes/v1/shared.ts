import { Response } from "express";
import { ValidationError } from "express-validator";
import type { ActionResult } from "../../actions/shared";

export const errorResponse = (
  res: Response,
  code: number,
  errors: unknown[]
) => {
  res.status(code).send({ success: false, errors });
};

export const successResponse = (
  res: Response,
  data?: Record<string, unknown>
) => {
  res.send({ success: true, data });
};

export const authenticationError = (res: Response) => {
  errorResponse(res, 403, ["Not logged in."]);
};

export const validationError = (res: Response, errors: ValidationError[]) => {
  errorResponse(res, 422, errors);
};

export const wrapActionResult = <T>(
  res: Response,
  result: ActionResult<T>,
  dataWrapper: (
    data: T
  ) => T extends undefined ? undefined : Record<string, unknown>
) => {
  if (result.type === "failure") {
    errorResponse(res, result.code, result.errors);
    return;
  }

  successResponse(res, dataWrapper(result.data));
};
