import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ActionFunctionArgs } from 'react-router';
import { portfoliosAction } from '../src/features/portfolios/actions';

const portfolioId = '00000000-0000-4000-8000-000000000001';
const assetId = '00000000-0000-4000-8000-000000000002';
const transactionId = '00000000-0000-4000-8000-000000000003';

function action(fields: Record<string, string>) {
  return portfoliosAction({
    request: new Request('http://localhost/portfolio', {
      method: 'POST',
      body: new URLSearchParams(fields),
    }),
    params: {},
    context: {},
  } as ActionFunctionArgs);
}

test('portfolio actions return current, intent-specific success feedback', async () => {
  const original = globalThis.fetch;
  const requests: { path: string; method: string }[] = [];
  try {
    globalThis.fetch = async (input, options) => {
      const path = String(input);
      const method = options?.method ?? 'GET';
      if (path.endsWith('/auth/csrf'))
        return new Response('{"csrfToken":"test-token"}');
      requests.push({ path, method });
      if (path.endsWith('/portfolios') && method === 'POST')
        return new Response(JSON.stringify({ portfolio: { id: portfolioId } }));
      return new Response(null, { status: 204 });
    };

    const created = await action({
      intent: 'create',
      name: 'Long-term',
      mode: 'REAL',
    });
    assert.ok(!(created instanceof Response));
    assert.deepEqual(created.data, {
      ok: true,
      intent: 'create',
      message: 'Portfolio created.',
      redirectTo: `/portfolio?portfolio=${portfolioId}`,
    });

    const deleted = await action({ intent: 'delete', portfolioId });
    assert.ok(!(deleted instanceof Response));
    assert.deepEqual(deleted.data, {
      ok: true,
      intent: 'delete',
      message: 'Portfolio deleted.',
      redirectTo: '/portfolio',
    });

    for (const side of ['BUY', 'SELL'] as const) {
      const trade = await action({
        intent: 'add-trade',
        portfolioId,
        assetId,
        side,
        quantity: '2',
        unitPrice: '10',
        fee: '0',
        executedAt: '2026-11-28T12:00',
      });
      assert.ok(!(trade instanceof Response));
      assert.deepEqual(trade.data, {
        ok: true,
        intent: 'add-trade',
        message: `${side === 'BUY' ? 'Buy' : 'Sell'} trade recorded.`,
        redirectTo: null,
      });
    }

    const removed = await action({
      intent: 'delete-trade',
      portfolioId,
      transactionId,
    });
    assert.ok(!(removed instanceof Response));
    assert.equal(removed.data.message, 'Trade removed.');
    assert.deepEqual(
      requests.map(({ method }) => method),
      ['POST', 'DELETE', 'POST', 'POST', 'DELETE'],
    );
  } finally {
    globalThis.fetch = original;
  }
});
