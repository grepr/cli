import { describe, expect, it } from 'bun:test';
import { buildBackfillGreprUrl } from '../../../main/typescript/lib/backfill-grepr-link.js';
import type { SchemaReadJob } from '../../../main/typescript/openapi/openApiTypes.js';

const JOB_ID = '0s0g0vyy0d0cy';

function job(id = JOB_ID): Pick<SchemaReadJob, 'id'> {
  return { id };
}

describe('buildBackfillGreprUrl', () => {
  it('test_buildBackfillGreprUrl_productionUrl_opensTheBackfillOnTheBackfillsTab', () => {
    const result = buildBackfillGreprUrl(
      job(),
      'https://acme.app.grepr.ai/api',
      'acme'
    );

    const url = new URL(result ?? '');
    expect(url.origin).toBe('https://acme.app.grepr.ai');
    expect(url.pathname).toBe('/jobs');
    expect([url.searchParams.get('view'), url.searchParams.get('backfill')]).toEqual([
      'backfills',
      JOB_ID,
    ]);
  });

  it('test_buildBackfillGreprUrl_stagingRootHostAddsOrganizationSubdomain', () => {
    const result = buildBackfillGreprUrl(
      job(),
      'https://app.staging.grepr.ai/api',
      'greprstaging'
    );

    const url = new URL(result ?? '');
    expect(url.origin).toBe('https://greprstaging.app.staging.grepr.ai');
    expect(url.pathname).toBe('/jobs');
  });

  it('test_buildBackfillGreprUrl_localRootHostAddsOrganizationAndPreservesPortAndPathPrefix', () => {
    const result = buildBackfillGreprUrl(
      job('id with spaces'),
      'http://app.grepr.localhost:7665/grepr/api/',
      'greprlocal'
    );

    const url = new URL(result ?? '');
    expect(url.origin).toBe('http://greprlocal.app.grepr.localhost:7665');
    expect(url.pathname).toBe('/grepr/jobs');
    expect(url.searchParams.get('backfill')).toBe('id with spaces');
  });

  it('test_buildBackfillGreprUrl_clearsApiQueryAndHash', () => {
    const result = buildBackfillGreprUrl(
      job(),
      'https://acme.app.grepr.ai/api?debug=true#fragment',
      'acme'
    );

    const url = new URL(result ?? '');
    expect(url.hash).toBe('');
    expect([...url.searchParams.keys()]).toEqual(['view', 'backfill']);
  });

  it('test_buildBackfillGreprUrl_unsupportedApiUrlReturnsUndefined', () => {
    expect(buildBackfillGreprUrl(job(), 'https://api.example.com/v1', 'acme')).toBeUndefined();
    expect(buildBackfillGreprUrl(job(), 'not-a-url', 'acme')).toBeUndefined();
    expect(buildBackfillGreprUrl(job(), undefined, 'acme')).toBeUndefined();
    expect(buildBackfillGreprUrl(job(), 'https://app.grepr.ai/api', '')).toBeUndefined();
  });
});
