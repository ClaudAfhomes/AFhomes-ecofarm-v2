import { createCookieAuthGateway } from '@afhomes/shared';
import { env } from './env';
export const isMongoAuth: boolean = false;
export const mongoAuth = createCookieAuthGateway(env.VITE_API_BASE_URL);
