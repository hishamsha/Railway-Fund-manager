import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { ApiError } from './api-error.js';

export const notFound: RequestHandler = (_request, response) => {
  response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Resource not found', request_id: response.locals.requestId } });
};

export const errorHandler: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
  void _next;
  if (error instanceof ApiError) {
    response.status(error.status).json({ error: { code: error.code, message: error.message, request_id: response.locals.requestId } });
    return;
  }
  if (error instanceof ZodError) {
    response.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request', fields: error.flatten().fieldErrors, request_id: response.locals.requestId } });
    return;
  }
  if (error instanceof SyntaxError && 'body' in error) {
    response.status(400).json({ error: { code: 'INVALID_JSON', message: 'Invalid JSON body', request_id: response.locals.requestId } });
    return;
  }
  response.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error', request_id: response.locals.requestId } });
};
