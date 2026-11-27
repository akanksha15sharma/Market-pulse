import { env } from '../config/env.js';
import { createAuthMailer } from './delivery.js';
export type { AuthMail, AuthMailer } from './delivery.js';

export const authMailer = createAuthMailer(env);
