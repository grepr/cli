import type { SchemaReadJob } from '../openapi/openApiTypes.js';

/**
 * Builds a link to the Grepr Jobs page filtered to the newly created backfill.
 * The UI origin is only inferred when the configured API URL has the standard
 * terminal `/api` path segment. Root `app.*` hosts are scoped to the configured
 * organization; already scoped `<org>.app.*` hosts are preserved.
 */
export function buildBackfillGreprUrl(
  job: Pick<SchemaReadJob, 'name'>,
  apiBaseUrl: string | undefined,
  orgName: string
): string | undefined {
  if (!apiBaseUrl || !job.name || !orgName) {
    return undefined;
  }

  let url: URL;
  try {
    url = new URL(apiBaseUrl);
  } catch {
    return undefined;
  }

  const apiPath = url.pathname.replace(/\/+$/, '');
  if (!apiPath.endsWith('/api')) {
    return undefined;
  }

  if (url.hostname.split('.')[0] === 'app') {
    url.hostname = `${orgName}.${url.hostname}`;
  }

  url.pathname = `${apiPath.slice(0, -'/api'.length)}/jobs`;
  url.search = '';
  url.hash = '';
  url.searchParams.set('uiFilters.name', job.name);
  return url.toString();
}
