import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

export const requestId: RequestHandler = (request, response, next) => {
  const supplied = request.header('X-Request-Id');
  const id = supplied && /^[a-zA-Z0-9-]{1,64}$/.test(supplied) ? supplied : randomUUID();
  response.setHeader('X-Request-Id', id);
  response.locals.requestId = id;
  next();
};
