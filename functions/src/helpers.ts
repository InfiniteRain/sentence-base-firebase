import { Response } from "express";
import { ValidationError } from "express-validator";

export const errorResponse = (res: Response, code: number, errors: unknown) => {
  res.status(code).send({ success: false, errors });
};

export const authenticationError = (res: Response) => {
  errorResponse(res, 403, ["Not logged in."]);
};

export const validationError = (res: Response, errors: ValidationError[]) => {
  errorResponse(res, 422, errors);
};

export const successResponse = (
  res: Response,
  data: Record<string, unknown>
) => {
  res.send({ success: true, data });
};
