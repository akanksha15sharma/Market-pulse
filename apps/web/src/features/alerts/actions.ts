import {
  data,
  redirect,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from 'react-router';
import { z } from 'zod';
import {
  alertCreateSchema,
  alertTargetSchema,
  alertSchema,
  alertsResponseSchema,
  alertEventsResponseSchema,
  alertQuerySchema,
} from '@marketpulse/contracts';
import { api, ApiError } from '../../lib/api-client';
export async function alertsLoader({ request }: LoaderFunctionArgs) {
  const params = new URL(request.url).searchParams;
  const parsed = alertQuerySchema.safeParse({
    page: params.get('page') ?? 1,
    ...(params.get('status') ? { status: params.get('status') } : {}),
  });
  if (!parsed.success) throw redirect('/alerts');
  const inspect = params.get('inspect');
  if (inspect && !z.uuid().safeParse(inspect).success)
    throw redirect('/alerts');
  const historyPage = z.coerce
    .number()
    .int()
    .min(1)
    .max(10000)
    .safeParse(params.get('historyPage') ?? 1);
  if (!historyPage.success) throw redirect('/alerts');
  try {
    const query = new URLSearchParams({
      page: String(parsed.data.page),
      limit: String(parsed.data.limit),
      ...(parsed.data.status ? { status: parsed.data.status } : {}),
    });
    const result = alertsResponseSchema.parse(await api(`/alerts?${query}`));
    if (!inspect) return { ...result, inspected: null, history: null };
    const known = result.alerts.find((alert) => alert.id === inspect);
    const inspected =
      known ??
      alertSchema.parse(
        (await api<{ alert: unknown }>(`/alerts/${inspect}`)).alert,
      );
    const history = alertEventsResponseSchema.parse(
      await api(`/alerts/${inspect}/events?page=${historyPage.data}&limit=20`),
    );
    return { ...result, inspected, history };
  } catch (error) {
    if (error instanceof ApiError && error.status === 401)
      throw redirect('/login');
    throw error;
  }
}
export async function alertsAction({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST')
    throw new Response('Method not allowed', { status: 405 });
  const form = await request.formData();
  try {
    const intent = z
      .enum(['create', 'edit', 'pause', 'rearm', 'delete'])
      .parse(form.get('intent'));
    const target = () => ({
      direction: form.get('direction'),
      threshold: form.get('threshold'),
    });
    if (intent === 'create') {
      const input = alertCreateSchema.parse({
        ...target(),
        assetId: form.get('assetId'),
      });
      const result = await api<{ alert: unknown }>('/alerts', {
        method: 'POST',
        body: input,
      });
      const alert = alertSchema.parse(result.alert);
      return redirect(`/alerts?inspect=${alert.id}`);
    }
    const id = z.uuid().parse(form.get('id'));
    const path = `/alerts/${id}`;
    if (intent === 'delete') {
      await api(path, { method: 'DELETE' });
      return redirect('/alerts');
    }
    if (intent === 'edit')
      await api(path, {
        method: 'PATCH',
        body: alertTargetSchema.parse(target()),
      });
    else await api(`${path}/${intent}`, { method: 'POST' });
    return data({
      ok: true,
      message:
        intent === 'edit'
          ? 'Target saved and alert paused. Arm it again to apply this target.'
          : intent === 'pause'
            ? 'Alert paused.'
            : 'Alert armed. Waiting for a fresh real observation after arming.',
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401)
      return redirect('/login');
    return data(
      {
        ok: false,
        message:
          error instanceof z.ZodError
            ? 'Choose an asset and direction, and enter a positive USD target with at most 18 decimal places.'
            : error instanceof ApiError
              ? error.message
              : 'Could not save the alert. Please try again.',
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
