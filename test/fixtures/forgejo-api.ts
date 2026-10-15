import type { ForgejoApiCall, ForgejoAsyncApiCall, ForgejoApiResult } from '../../src/adapters/forgejo/forgejo-types.js';

type FixtureResponse = Pick<ForgejoApiResult<unknown>, 'ok'> & Partial<Omit<ForgejoApiResult<unknown>, 'ok'>>;
type Responder = (...args: Parameters<ForgejoApiCall>) => FixtureResponse;

/**
 * A fixture transport supplies wire data just as the real JSON transport does.
 * The endpoint caller chooses T; tests own the response payload and assertions.
 * Keep that transport assertion here, while checking request arguments and the
 * result envelope in every responder.
 */
function envelope<T>(response: FixtureResponse): ForgejoApiResult<T> {
  return {
    status: null, statusCode: null, stderr: null, error: null,
    ...response,
    data: (response.data ?? null) as T | null,
  };
}

export function forgejoApiFixture(respond: Responder): ForgejoApiCall {
  return <T>(...args: Parameters<ForgejoApiCall>) => envelope<T>(respond(...args));
}

export function forgejoAsyncApiFixture(
  respond: (...args: Parameters<ForgejoApiCall>) => FixtureResponse | Promise<FixtureResponse>,
): ForgejoAsyncApiCall {
  return async <T>(...args: Parameters<ForgejoApiCall>) => envelope<T>(await respond(...args));
}
