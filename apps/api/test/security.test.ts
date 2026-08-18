import { describe, expect, it } from 'vitest';
import { createApp, HIRE_REQUEST_BODY_LIMIT_BYTES } from '../src/index.js';

const AGENT_REGISTRY = 'eip155:56:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:7';
const HIRE_TOKEN = 'test-hire-token-123456';

describe('API security boundaries', () => {
  it('applies defensive headers to public responses', async () => {
    const response = await createApp().request('/health');

    expect(response.status).toBe(200);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-frame-options')).toBe('SAMEORIGIN');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('fails closed without release identity and reports the reviewed identity when configured', async () => {
    const missing = await createApp({ releaseId: null }).request('/version');
    expect(missing.status).toBe(503);
    expect(await missing.json()).toEqual({
      status: 'unavailable',
      service: 'ambit-api',
      error: {
        code: 'release-identity-unavailable',
        message: 'release identity is not configured',
      },
    });

    const configured = await createApp({ releaseId: 'abcdef1234567890' }).request('/version');
    expect(configured.status).toBe(200);
    expect(await configured.json()).toEqual({
      status: 'ok',
      service: 'ambit-api',
      releaseId: 'abcdef1234567890',
    });
  });

  it('generates correlation IDs and logs only bounded request metadata', async () => {
    const events: unknown[] = [];
    const response = await createApp({
      logger: (event) => events.push(event),
      requestIdFactory: () => 'generated-request-id',
    }).request('/health?credential=must-not-log', {
      headers: {
        authorization: 'Bearer must-not-log',
        'x-request-id': 'caller-controlled-id',
      },
    });

    expect(response.headers.get('x-request-id')).toBe('generated-request-id');
    expect(events).toEqual([
      {
        event: 'http-request',
        service: 'ambit-api',
        requestId: 'generated-request-id',
        method: 'GET',
        path: '/health',
        status: 200,
        durationMs: expect.any(Number),
        timestamp: expect.any(String),
      },
    ]);
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain('must-not-log');
    expect(serialized).not.toContain('caller-controlled-id');
  });

  it('fails closed when hire authorization is not configured', async () => {
    const response = await createApp({ hireToken: null }).request(
      `/agents/${AGENT_REGISTRY}/hire`,
      { method: 'POST' },
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: {
        code: 'mutation-auth-unavailable',
        message: 'hire authorization is not configured',
      },
    });
  });

  it('rejects missing and incorrect hire credentials before parsing the body', async () => {
    const missing = await createApp({ hireToken: HIRE_TOKEN }).request(
      `/agents/${AGENT_REGISTRY}/hire`,
      { method: 'POST' },
    );
    expect(missing.status).toBe(401);
    expect(missing.headers.get('www-authenticate')).toBe('Bearer');

    const incorrect = await createApp({ hireToken: HIRE_TOKEN }).request(
      `/agents/${AGENT_REGISTRY}/hire`,
      { method: 'POST', headers: { authorization: 'Bearer incorrect-token' } },
    );
    expect(incorrect.status).toBe(401);
  });

  it('rejects hire bodies over the explicit limit without parsing them', async () => {
    const response = await createApp({ hireToken: HIRE_TOKEN }).request(`/agents/${AGENT_REGISTRY}/hire`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${HIRE_TOKEN}` },
      body: 'x'.repeat(HIRE_REQUEST_BODY_LIMIT_BYTES + 1),
    });

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({
      error: {
        code: 'payload-too-large',
        message: `request body exceeds ${HIRE_REQUEST_BODY_LIMIT_BYTES} byte limit`,
      },
    });
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('rejects hire requests without the JSON media type', async () => {
    const response = await createApp({ hireToken: HIRE_TOKEN }).request(`/agents/${AGENT_REGISTRY}/hire`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain', authorization: `Bearer ${HIRE_TOKEN}` },
      body: JSON.stringify({ clientRequestId: 'client-1' }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: 'invalid-request',
        message: 'content-type must be application/json',
        issues: ['content-type must be application/json'],
      },
    });
  });

  it('accepts JSON parameters without treating them as a different media type', async () => {
    const response = await createApp({ hireToken: HIRE_TOKEN }).request(`/agents/${AGENT_REGISTRY}/hire`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json; charset=utf-8',
        authorization: `Bearer ${HIRE_TOKEN}`,
      },
      body: '{',
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: 'invalid-request',
        message: 'request body must be valid JSON',
        issues: ['request body must be valid JSON'],
      },
    });
  });
});
