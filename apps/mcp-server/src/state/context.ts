/**
 * Per-request execution context.
 *
 * Everything the tool layer needs to know about the current request —
 * most importantly the userId, which scopes memory/workflows to a
 * single Alexa account (spec §39: never share one memory across users).
 */
import type { FastifyRequest } from 'fastify';

export type ExecutionMode = 'bridge' | 'hermes';

export type RequestContext = {
  requestId: string;
  userId: string;
  mode: ExecutionMode;
  startedAt: number;
};

/**
 * Extract the request context from the Fastify request.
 * userId resolution:
 *   - oauth2 mode: from the validated token's `sub` claim (set by auth plugin)
 *   - local mode:  from `x-user-id` header, falling back to 'local-user'
 *     (single-user hackathon dev; the spec allows this for the demo,
 *     but the field is plumbed everywhere so multi-user works at oauth time)
 */
export function requestContext(req: FastifyRequest): RequestContext {
  const headerUser = req.headers['x-user-id'];
  const userId =
    (req as FastifyRequest & { user?: { sub?: string } }).user?.sub ??
    (typeof headerUser === 'string' && headerUser.trim() !== ''
      ? headerUser.trim()
      : 'local-user');

  return {
    requestId: req.id,
    userId,
    mode: 'bridge', // 'hermes' is reserved for the registry-remote track
    startedAt: Date.now(),
  };
}
