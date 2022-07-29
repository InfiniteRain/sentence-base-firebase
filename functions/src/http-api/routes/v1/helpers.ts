import { Response } from "express";
import { ValidationError } from "express-validator";
import { ActionHttpError } from "../../../actions/action-http-error";

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

export const wrapActionResultInResponse = async <T>(
  res: Response,
  actionPromise: Promise<T>,
  dataWrapper: (data: T) => T extends void ? undefined : Record<string, unknown>
) => {
  try {
    const data = await actionPromise;
    successResponse(res, dataWrapper(data));
  } catch (error) {
    if (error instanceof ActionHttpError) {
      errorResponse(res, error.code, [error.message]);
      return;
    }

    errorResponse(res, 500, ["Internal server error."]);
  }
};
