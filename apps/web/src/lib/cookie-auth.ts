import { createCookieAuthGateway } from '@afhomes/shared';
import { env } from './env';
export const isMongoAuth = env.VITE_AUTH_PROVIDER === 'mongodb';
export const mongoAuth = createCookieAuthGateway(env.VITE_API_BASE_URL);
