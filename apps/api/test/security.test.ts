import { describe, expect, it } from 'vitest';
import { createApp, HIRE_REQUEST_BODY_LIMIT_BYTES } from '../src/index.js';

const AGENT_REGISTRY = 'eip155:56:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:7';

describe('API security boundaries', () => {
  it('applies defensive headers to public responses', async () => {
    const response = await createApp().request('/health');

    expect(response.status).toBe(200);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-frame-options')).toBe('SAMEORIGIN');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('rejects hire bodies over the explicit limit without parsing them', async () => {
    const response = await createApp().request(`/agents/${AGENT_REGISTRY}/hire`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
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
    const response = await createApp().request(`/agents/${AGENT_REGISTRY}/hire`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
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
    const response = await createApp().request(`/agents/${AGENT_REGISTRY}/hire`, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
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
