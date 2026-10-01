export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code: string = 'ERROR',
    public readonly details?: unknown,
  ) {
    super(message);
  }
  static badRequest(msg: string, code = 'BAD_REQUEST', details?: unknown) { return new AppError(400, msg, code, details); }
  static unauthorized(msg = 'Authentication required', code = 'UNAUTHORIZED') { return new AppError(401, msg, code); }
  static forbidden(msg = 'You do not have permission to perform this action', code = 'FORBIDDEN') { return new AppError(403, msg, code); }
  static notFound(msg = 'Resource not found', code = 'NOT_FOUND') { return new AppError(404, msg, code); }
  static conflict(msg: string, code = 'CONFLICT') { return new AppError(409, msg, code); }
}
