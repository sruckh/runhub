import { redirect } from '@sveltejs/kit';
import { COOKIE_NAME } from '../../hooks.server';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ cookies }) => {
  cookies.delete(COOKIE_NAME, { path: '/' });
  throw redirect(303, '/login');
};
