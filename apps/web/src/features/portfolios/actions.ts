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
  try {
    const intent = z
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
      return redirect(`/portfolio?portfolio=${result.portfolio.id}`);
    }
    const id = z.uuid().parse(form.get('portfolioId'));
    const path = `/portfolios/${id}`;
    if (intent === 'delete') {
      await api(path, { method: 'DELETE' });
      return redirect('/portfolio');
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
      return data({ ok: true, message: 'Trade recorded.' });
    }
    const transactionId = z.uuid().parse(form.get('transactionId'));
    await api(`${path}/transactions/${transactionId}`, { method: 'DELETE' });
    return data({ ok: true, message: 'Trade removed.' });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401)
      return redirect('/login');
    return data(
      {
        ok: false,
        message:
          error instanceof z.ZodError
            ? 'Enter a valid portfolio name or trade with a positive quantity and execution price.'
            : error instanceof ApiError
              ? error.message
              : 'Unable to save this change. Please try again.',
      },
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
