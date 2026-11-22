import { data, redirect, type ActionFunctionArgs } from 'react-router';
import { z } from 'zod';
import {
  watchlistInputSchema,
  watchlistItemInputSchema,
  watchlistsResponseSchema,
  type WatchlistView,
} from '@marketpulse/contracts';
import { api, ApiError } from '../../lib/api-client';

export async function watchlistsLoader() {
  try {
    return watchlistsResponseSchema.parse(await api('/watchlists'));
  } catch (error) {
    if (error instanceof ApiError && error.status === 401)
      throw redirect('/login');
    throw error;
  }
}
export async function watchlistsAction({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST')
    throw new Response('Method not allowed', { status: 405 });
  const form = await request.formData();
  try {
    const intent = z
      .enum(['create', 'rename', 'delete', 'add', 'remove'])
      .parse(form.get('intent'));
    if (intent === 'create') {
      const body = watchlistInputSchema.parse({ name: form.get('name') });
      const { watchlist } = await api<{ watchlist: WatchlistView }>(
        '/watchlists',
        { method: 'POST', body },
      );
      return redirect(`/watchlists?list=${watchlist.id}`);
    }
    const id = z.uuid().parse(form.get('id'));
    const path = `/watchlists/${id}`;
    if (intent === 'delete') {
      await api(path, { method: 'DELETE' });
      return redirect('/watchlists');
    }
    if (intent === 'rename') {
      await api(path, {
        method: 'PATCH',
        body: watchlistInputSchema.parse({ name: form.get('name') }),
      });
      return data({ ok: true, message: 'Watchlist renamed.' });
    }
    const { assetId } = watchlistItemInputSchema.parse({
      assetId: form.get('assetId'),
    });
    if (intent === 'add')
      await api(`${path}/items`, { method: 'POST', body: { assetId } });
    else await api(`${path}/items/${assetId}`, { method: 'DELETE' });
    return data({
      ok: true,
      message:
        intent === 'add'
          ? 'Asset saved to your watchlist.'
          : 'Asset removed from your watchlist.',
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401)
      return redirect('/login');
    return data(
      {
        ok: false,
        message:
          error instanceof z.ZodError
            ? 'Use a list name of 1–100 characters and select a valid asset.'
            : error instanceof ApiError
              ? error.message
              : 'Unable to save changes. Please try again.',
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
