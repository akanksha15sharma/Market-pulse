import { data, redirect, type ActionFunctionArgs } from 'react-router';
import {
  portfolioInputSchema,
  portfolioTransactionInputSchema,
  portfoliosResponseSchema,
  assetSchema,
} from '@marketpulse/contracts';
import { z } from 'zod';
import { api, ApiError } from '../../lib/api-client';

const catalogSchema = z.object({ assets: z.array(assetSchema) });
export type PortfolioActionResult = {
  ok: boolean;
  intent: 'create' | 'delete' | 'add-trade' | 'delete-trade' | 'unknown';
  message: string;
  redirectTo: string | null;
};

export async function portfoliosLoader() {
  try {
    const [portfolioData, catalogData] = await Promise.all([
      api('/portfolios'),
      api('/assets?limit=50&page=1&sort=symbol'),
    ]);
    return {
      ...portfoliosResponseSchema.parse(portfolioData),
      ...catalogSchema.parse(catalogData),
    };
  } catch (error) {
    if (error instanceof ApiError && error.status === 401)
      throw redirect('/login');
    throw error;
  }
}
export async function portfoliosAction({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST')
    throw new Response('Method not allowed', { status: 405 });
  const form = await request.formData();
  let intent: PortfolioActionResult['intent'] = 'unknown';
  try {
    intent = z
      .enum(['create', 'delete', 'add-trade', 'delete-trade'])
      .parse(form.get('intent'));
    if (intent === 'create') {
      const { name, mode } = portfolioInputSchema.parse({
        name: form.get('name'),
        mode: form.get('mode'),
      });
      const result = await api<{ portfolio: { id: string } }>('/portfolios', {
        method: 'POST',
        body: { name, mode },
      });
      return data({
        ok: true,
        intent,
        message: 'Portfolio created.',
        redirectTo: `/portfolio?portfolio=${result.portfolio.id}`,
      } satisfies PortfolioActionResult);
    }
    const id = z.uuid().parse(form.get('portfolioId'));
    const path = `/portfolios/${id}`;
    if (intent === 'delete') {
      await api(path, { method: 'DELETE' });
      return data({
        ok: true,
        intent,
        message: 'Portfolio deleted.',
        redirectTo: '/portfolio',
      } satisfies PortfolioActionResult);
    }
    if (intent === 'add-trade') {
      const localExecutedAt = z.string().min(1).parse(form.get('executedAt'));
      const executedDate = new Date(localExecutedAt);
      const executedAt = Number.isFinite(executedDate.getTime())
        ? executedDate.toISOString()
        : localExecutedAt;
      const input = portfolioTransactionInputSchema.parse({
        assetId: form.get('assetId'),
        side: form.get('side'),
        quantity: form.get('quantity'),
        unitPrice: form.get('unitPrice'),
        fee: form.get('fee') || '0',
        executedAt,
      });
      await api(`${path}/transactions`, { method: 'POST', body: input });
      return data({
        ok: true,
        intent,
        message: `${input.side === 'BUY' ? 'Buy' : 'Sell'} trade recorded.`,
        redirectTo: null,
      } satisfies PortfolioActionResult);
    }
    const transactionId = z.uuid().parse(form.get('transactionId'));
    await api(`${path}/transactions/${transactionId}`, { method: 'DELETE' });
    return data({
      ok: true,
      intent,
      message: 'Trade removed.',
      redirectTo: null,
    } satisfies PortfolioActionResult);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401)
      return redirect('/login');
    return data(
      {
        ok: false,
        intent,
        message:
          error instanceof z.ZodError
            ? 'Enter a valid portfolio name or trade with a positive quantity and execution price.'
            : error instanceof ApiError
              ? error.message
              : 'Unable to save this change. Please try again.',
        redirectTo: null,
      } satisfies PortfolioActionResult,
      {
        status:
          error instanceof ApiError && error.status >= 400
            ? error.status
            : error instanceof z.ZodError
              ? 400
              : 503,
      },
    );
  }
}
