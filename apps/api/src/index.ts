import { randomUUID, timingSafeEqual } from 'node:crypto';
import { buildAgentActivationMessage } from '@ambit/core';
import { prisma } from '@ambit/db';
import { Hono, type Context } from 'hono';
import { isAddressEqual, recoverMessageAddress } from 'viem';
import { bodyLimit } from 'hono/body-limit';
import { secureHeaders } from 'hono/secure-headers';
import {
  MarketplaceConflictError,
  MarketplaceNotFoundError,
  MarketplacePolicyError,
  MarketplaceUnavailableError,
  RequestValidationError,
  isAgentRegistry,
  parseAgentSearchQuery,
  parseExecutionListQuery,
  parseHireAgentInput,
  type MarketplaceRepository,
} from './marketplace.js';
import { createPrismaMarketplaceRepository } from './prisma-repository.js';

export const health = (context: Context) => context.json({ status: 'ok', service: 'ambit-api' });
export const HIRE_REQUEST_BODY_LIMIT_BYTES = 16 * 1024;
export const HIRE_AUTH_ENV = 'AMBIT_HIRE_TOKEN';
export const RELEASE_ID_ENV = 'AMBIT_RELEASE_ID';

export interface HttpRequestEvent {
  event: 'http-request';
  service: 'ambit-api';
  requestId: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  timestamp: string;
}

export interface StartupEvent {
  event: 'startup';
  service: 'ambit-api';
  releaseId: string | null;
  port: number;
  timestamp: string;
}

export type OperationalEvent = HttpRequestEvent | StartupEvent;
export type OperationalLogger = (event: OperationalEvent) => void;

export interface CreateAppOptions {
  repository?: MarketplaceRepository;
  hireToken?: string | null;
  releaseId?: string | null;
  logger?: OperationalLogger;
  requestIdFactory?: () => string;
}

export function createApp(options: CreateAppOptions = {}): Hono {
  const repository = options.repository ?? createPrismaMarketplaceRepository(prisma);
  const hireToken = options.hireToken ?? process.env[HIRE_AUTH_ENV] ?? null;
  const releaseId = options.releaseId ?? process.env[RELEASE_ID_ENV] ?? null;
  const logger = options.logger ?? (() => undefined);
  const requestIdFactory = options.requestIdFactory ?? randomUUID;
  const app = new Hono();

  app.onError((error, context) => errorResponse(error, context));
  app.use('*', secureHeaders());
  app.use('*', async (context, next) => {
    const requestId = requestIdFactory();
    const startedAt = Date.now();
    context.header('x-request-id', requestId);
    try {
      await next();
    } finally {
      try {
        logger({
          event: 'http-request',
          service: 'ambit-api',
          requestId,
          method: context.req.method,
          path: safePath(context.req.url),
          status: context.res.status,
          durationMs: Math.max(0, Date.now() - startedAt),
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        void error;
      }
    }
  });
  app.get('/health', health);
  app.get('/version', (context) => {
    if (!isUsableReleaseId(releaseId)) {
      return context.json(
        {
          status: 'unavailable',
          service: 'ambit-api',
          error: {
            code: 'release-identity-unavailable',
            message: 'release identity is not configured',
          },
        },
        503,
      );
    }
    return context.json({ status: 'ok', service: 'ambit-api', releaseId });
  });
  app.get('/ready', async (context) => {
    try {
      await repository.ready();
      return context.json({ status: 'ok', service: 'ambit-api' });
    } catch {
      return context.json(
        {
          status: 'unavailable',
          service: 'ambit-api',
          error: {
            code: 'repository-unavailable',
            message: 'marketplace repository is unavailable',
          },
        },
        503,
      );
    }
  });

  app.get('/agents', async (context) => {
    const query = parseAgentSearchQuery(context.req.query());
    return context.json(await repository.listAgents(query));
  });

  app.get('/agents/:agentRegistry/executions', async (context) => {
    const agentRegistry = requireAgentRegistry(context.req.param('agentRegistry'));
    const query = parseExecutionListQuery(context.req.query());
    return context.json(await repository.listExecutions(agentRegistry, query));
  });

  app.post(
    '/agents/:agentRegistry/hire',
    (context, next) => requireHireAuthorization(context, hireToken, next),
    bodyLimit({
      maxSize: HIRE_REQUEST_BODY_LIMIT_BYTES,
      onError: (context) =>
        context.json(
          {
            error: {
              code: 'payload-too-large',
              message: `request body exceeds ${HIRE_REQUEST_BODY_LIMIT_BYTES} byte limit`,
            },
          },
          413,
        ),
    }),
    async (context) => {
      requireJsonContentType(context);
      const agentRegistry = requireAgentRegistry(context.req.param('agentRegistry'));
      let body: unknown;
      try {
        body = await context.req.json();
      } catch {
        throw new RequestValidationError(['request body must be valid JSON']);
      }
      const input = parseHireAgentInput(body);
      const authorization = await verifyActivationSignature(agentRegistry, input);
      const request = await repository.createHire(agentRegistry, input, authorization);
      return context.json({ request }, 202);
    },
  );

  app.get('/agents/:agentRegistry', async (context) => {
    const agentRegistry = requireAgentRegistry(context.req.param('agentRegistry'));
    const agent = await repository.getAgent(agentRegistry);
    if (!agent) throw new MarketplaceNotFoundError('agent not found');
    return context.json({ agent });
  });

  return app;
}

async function verifyActivationSignature(
  agentRegistry: string,
  input: ReturnType<typeof parseHireAgentInput>,
): Promise<{ signer: ReturnType<typeof parseHireAgentInput>['requester']; verifiedAt: Date }> {
  try {
    const recovered = await recoverMessageAddress({
      message: buildAgentActivationMessage({
        agentRegistry,
        clientRequestId: input.clientRequestId,
        requester: input.requester,
        destination: input.destination,
        ...(input.protocol ? { protocol: input.protocol } : {}),
        requestedValue: input.requestedValue,
        expiresAt: input.expiresAt,
      }),
      signature: input.signature,
    });
    if (!isAddressEqual(recovered, input.requester)) throw new Error('signer mismatch');
    return { signer: recovered, verifiedAt: new Date() };
  } catch {
    throw new RequestValidationError(['signature does not authorize this activation request']);
  }
}

export function logOperationalEvent(event: OperationalEvent): void {
  console.log(JSON.stringify(event));
}

function isUsableReleaseId(releaseId: string | null): releaseId is string {
  return (
    releaseId !== null &&
    releaseId.length >= 7 &&
    releaseId.length <= 128 &&
    /^[A-Za-z0-9][A-Za-z0-9._:@+-]*$/u.test(releaseId)
  );
}

function safePath(url: string): string {
  try {
    const path = new URL(url).pathname;
    return path.length <= 256 ? path : '<path-omitted>';
  } catch {
    return '<invalid-url>';
  }
}

async function requireHireAuthorization(
  context: Context,
  configuredToken: string | null,
  next: () => Promise<void>,
): Promise<Response | void> {
  if (!isUsableHireToken(configuredToken)) {
    return context.json(
      {
        error: {
          code: 'mutation-auth-unavailable',
          message: 'hire authorization is not configured',
        },
      },
      503,
    );
  }

  const authorization = context.req.header('authorization');
  const prefix = 'Bearer ';
  const presentedToken = authorization?.startsWith(prefix)
    ? authorization.slice(prefix.length)
    : null;
  if (!presentedToken || !matchesToken(presentedToken, configuredToken)) {
    return context.json(
      { error: { code: 'unauthorized', message: 'hire authorization required' } },
      401,
      { 'www-authenticate': 'Bearer' },
    );
  }

  await next();
}

function isUsableHireToken(token: string | null): token is string {
  return (
    token !== null && token.length >= 16 && token.length <= 512 && /^[\x21-\x7e]+$/u.test(token)
  );
}

function matchesToken(presentedToken: string, configuredToken: string): boolean {
  const presented = Buffer.from(presentedToken, 'utf8');
  const configured = Buffer.from(configuredToken, 'utf8');
  return presented.length === configured.length && timingSafeEqual(presented, configured);
}

function requireAgentRegistry(value: string): string {
  if (!isAgentRegistry(value)) throw new RequestValidationError(['agentRegistry is invalid']);
  return value;
}

function requireJsonContentType(context: Context): void {
  const mediaType = context.req.header('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (mediaType !== 'application/json') {
    throw new RequestValidationError(['content-type must be application/json']);
  }
}

function errorResponse(error: Error, context: Context): Response {
  if (error instanceof RequestValidationError) {
    return context.json(
      { error: { code: 'invalid-request', message: error.message, issues: error.issues } },
      400,
    );
  }
  if (error instanceof MarketplaceNotFoundError) {
    return context.json({ error: { code: 'not-found', message: error.message } }, 404);
  }
  if (error instanceof MarketplaceConflictError) {
    return context.json({ error: { code: 'conflict', message: error.message } }, 409);
  }
  if (error instanceof MarketplacePolicyError) {
    return context.json({ error: { code: 'policy-rejected', message: error.message } }, 403);
  }
  if (error instanceof MarketplaceUnavailableError) {
    return context.json({ error: { code: 'repository-unavailable', message: error.message } }, 503);
  }
  return context.json(
    { error: { code: 'internal-error', message: 'unexpected marketplace API failure' } },
    500,
  );
}

export * from './marketplace.js';
export * from './prisma-repository.js';
