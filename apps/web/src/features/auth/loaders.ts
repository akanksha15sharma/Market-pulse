import { redirect } from 'react-router';
import type { PublicUser } from '@marketpulse/contracts';
import { api, ApiError } from '../../lib/api-client';
export type SessionView = {
  id: string;
  createdAt: string;
  expiresAt: string;
  current: boolean;
};
export async function accountLoader() {
  try {
    const { user } = await api<{ user: PublicUser }>('/auth/me');
    const { sessions } = await api<{ sessions: SessionView[] }>(
      '/auth/sessions',
    );
    return { user, sessions };
  } catch (error) {
    if (error instanceof ApiError && error.status === 401)
      throw redirect('/login');
    throw error;
  }
}
