import { redirect } from '@sveltejs/kit';
import { createHmac } from 'crypto';
import { env } from '$env/dynamic/private';
import type { Handle } from '@sveltejs/kit';

export const COOKIE_NAME = 'rhub_auth';

export function authToken(): string {
  const secret = env.COOKIE_SECRET || 'rhub-change-me-in-env';
  return createHmac('sha256', secret).update('rhub-authenticated').digest('hex');
}

const PUBLIC_PATHS = ['/login', '/logout', '/favicon.ico', '/robots.txt'];

export const handle: Handle = async ({ event, resolve }) => {
  const { pathname } = event.url;

  // Always allow static assets and auth routes
  if (pathname.startsWith('/_app/') || PUBLIC_PATHS.some(p => pathname.startsWith(p))) {
    return resolve(event);
  }

  const token = event.cookies.get(COOKIE_NAME);
  if (token !== authToken()) {
    throw redirect(303, `/login?redirect=${encodeURIComponent(pathname)}`);
  }

  event.locals.authenticated = true;
  return resolve(event);
};
