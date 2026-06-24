import { fail, redirect } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { COOKIE_NAME, authToken } from '../../hooks.server';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ cookies }) => {
  if (cookies.get(COOKIE_NAME) === authToken()) {
    throw redirect(303, '/');
  }
  return {};
};

export const actions: Actions = {
  default: async ({ request, cookies, url }) => {
    const data = await request.formData();
    const password = data.get('password') as string;

    if (!password || password !== env.SITE_PASSWORD) {
      return fail(401, { error: 'Invalid password' });
    }

    cookies.set(COOKIE_NAME, authToken(), {
      path: '/',
      httpOnly: true,
      sameSite: 'strict',
      secure: true,
      maxAge: 60 * 60 * 24 * 30, // 30 days
    });

    const redirectTo = url.searchParams.get('redirect') || '/';
    throw redirect(303, redirectTo);
  },
};
