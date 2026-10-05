import { NextFunction, Request, RequestHandler, Response } from "express";

/** Express 4 does not forward rejected promises to error middleware; this does. */
export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };
