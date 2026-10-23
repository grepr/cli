/**
 * Request building and validation for `grepr api`.
 *
 * The guards here are defense in depth for a generic request command: they keep the CLI from
 * being talked into sending something other than a public Grepr API call. They are NOT the security
 * boundary; the server enforces authentication and authorization.
 */

export type HttpMethod = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

const HTTP_METHODS: readonly HttpMethod[] = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'];

/** Methods whose fields travel as query parameters rather than a JSON body. */
const QUERY_FIELD_METHODS: readonly HttpMethod[] = ['GET', 'HEAD', 'DELETE'];

/** Methods that never carry a request body. */
const BODYLESS_METHODS: readonly HttpMethod[] = ['GET', 'HEAD'];

/** Methods that run without a confirmation prompt. */
const SAFE_METHODS: readonly HttpMethod[] = ['GET', 'HEAD'];

/**
 * The server's internal API namespace, which is never part of the public API. No public path has a
 * segment with this name, so it is refused anywhere in the request path: the base URL's path and
 * the endpoint together, whatever prefix the base URL carries.
 */
const INTERNAL_SEGMENT = 'internal';
const API_PATH_PREFIX = '/api';
const INTERNAL_HOST_PREFIX = 'internal-';

/** Percent-encodings of `.`, `/`, `\` and `;`, which could smuggle a path segment past the checks. */
const ENCODED_PATH_DELIMITERS = /%(2e|2f|5c|3b)/i;
/** A URL scheme (`https:`) or a protocol-relative `//host` reference. */
const ABSOLUTE_URL = /^([a-z][a-z0-9+.-]*:|\/\/)/i;
/** Whitespace and control characters, which the URL parser strips or rewrites. */
const UNSAFE_CHARACTERS = /[\s\p{Cc}]/u;
/** An RFC 9110 header field name. */
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

const MANAGED_HEADER_NAMES = ['authorization', 'proxy-authorization', 'cookie', 'x-grepr-api-key'];
const MANAGED_HEADER_PREFIX = 'x-grepr-auth';

/** A user-facing refusal to build or send a request. */
export class ApiRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

export type JsonScalar = string | number | boolean | null;
export type JsonValue = JsonScalar | JsonValue[] | { [key: string]: JsonValue };

declare const validatedApiPath: unique symbol;

/**
 * A path under the API root (e.g. `/v1/jobs`) that has passed {@link parseEndpoint}'s checks. Only
 * {@link toApiPath} creates one, so a request sender that takes an `ApiPath` cannot be handed a raw
 * string such as `.evil.com/x` that would move the request, and its token, to another host.
 */
export type ApiPath = string & { readonly [validatedApiPath]: true };

/** A resolved public API endpoint: the validated path plus any query string it carried. */
export interface ApiEndpoint {
  path: ApiPath;
  query: [string, string][];
}

export interface ApiRequestInput {
  endpoint: string;
  method?: string;
  rawFields: string[];
  typedFields: string[];
  headers: string[];
  /**
   * Reads the raw `--input` body, when `--input` was given. Called only after every other flag has
   * been validated, so a bad flag fails without waiting on stdin.
   */
  readInputBody?: () => Promise<string>;
}

export interface ApiRequest {
  method: HttpMethod;
  path: ApiPath;
  query: [string, string][];
  headers: Record<string, string>;
  body?: string;
}

/**
 * Normalizes an endpoint given as `v1/jobs`, `/v1/jobs` or `/api/v1/jobs` (each optionally with a
 * query string) to its path under the API root, refusing internal endpoints and anything that could
 * resolve somewhere other than the path it names.
 */
export function parseEndpoint(endpoint: string): ApiEndpoint {
  const trimmed = endpoint.trim();
  if (trimmed.length === 0) {
    throw new ApiRequestError('endpoint is required, e.g. v1/jobs');
  }
  if (ABSOLUTE_URL.test(trimmed)) {
    throw new ApiRequestError('pass an API path such as v1/jobs, not a full URL');
  }
  if (UNSAFE_CHARACTERS.test(trimmed) || trimmed.includes('#')) {
    throw new ApiRequestError('endpoint must not contain whitespace, control characters or "#"');
  }
  const queryIndex = trimmed.indexOf('?');
  const rawPath = queryIndex === -1 ? trimmed : trimmed.slice(0, queryIndex);
  const rawQuery = queryIndex === -1 ? '' : trimmed.slice(queryIndex + 1);

  const path = toApiPath(stripApiPrefix(rawPath.startsWith('/') ? rawPath : `/${rawPath}`));
  return { path, query: [...new URLSearchParams(rawQuery).entries()] };
}

/** Validates a normalized path (leading `/`, no `/api` prefix) and brands it as an {@link ApiPath}. */
function toApiPath(path: string): ApiPath {
  assertSafePath(path);
  // The one place the brand is applied: every ApiPath has been through assertSafePath.
  return path as ApiPath;
}

function stripApiPrefix(path: string): string {
  return path.startsWith(`${API_PATH_PREFIX}/`) ? path.slice(API_PATH_PREFIX.length) : path;
}

function assertSafePath(path: string): void {
  if (path.includes('\\') || path.includes(';') || path.includes('//')) {
    throw new ApiRequestError('endpoint path must not contain "\\", ";" or "//"');
  }
  if (ENCODED_PATH_DELIMITERS.test(path)) {
    throw new ApiRequestError('endpoint path must not contain percent-encoded ".", "/", "\\" or ";"');
  }
  if (path.split('/').some((segment) => segment === '.' || segment === '..')) {
    throw new ApiRequestError('endpoint path must not contain "." or ".." segments');
  }
  if (hasInternalSegment(path)) {
    throw new ApiRequestError('internal endpoints are not part of the public Grepr API');
  }
  if (path === '/') {
    throw new ApiRequestError('endpoint is required, e.g. v1/jobs');
  }
}

/**
 * Whether a path has an `internal` segment, compared case-insensitively after percent-decoding so
 * `%69nternal` can't slip past. A path that does not decode is refused outright.
 */
function hasInternalSegment(path: string): boolean {
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    throw new ApiRequestError('endpoint path has an invalid percent-encoding');
  }
  return decoded.split('/').some((segment) => segment.toLowerCase() === INTERNAL_SEGMENT);
}

/** Refuses an API base URL that points at an internal load balancer or the internal API path. */
export function assertPublicApiBaseUrl(apiBaseUrl: string): void {
  let url: URL;
  try {
    url = new URL(apiBaseUrl);
  } catch {
    throw new ApiRequestError(`invalid API base URL: ${apiBaseUrl}`);
  }
  if (url.hostname.toLowerCase().startsWith(INTERNAL_HOST_PREFIX) || hasInternalSegment(url.pathname)) {
    throw new ApiRequestError('grepr api only calls the public API; the configured API base URL is internal');
  }
}

/**
 * Parses repeated `-H 'Name: value'` flags, refusing headers the CLI manages itself and values
 * fetch would reject, so a bad header fails before `--input` is read rather than at send time.
 */
export function parseHeaders(rawHeaders: string[]): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const raw of rawHeaders) {
    const separator = raw.indexOf(':');
    const name = separator === -1 ? '' : raw.slice(0, separator).trim();
    if (!HEADER_NAME.test(name)) {
      throw new ApiRequestError(`invalid header "${raw}": expected 'Name: value'`);
    }
    const lowerName = name.toLowerCase();
    if (MANAGED_HEADER_NAMES.includes(lowerName) || lowerName.startsWith(MANAGED_HEADER_PREFIX)) {
      throw new ApiRequestError("authentication headers are managed by the CLI and can't be set with -H");
    }
    const value = raw.slice(separator + 1).trim();
    assertValidHeaderValue(name, value);
    headers[name] = value;
  }
  return headers;
}

/**
 * Applies fetch's own header validation, which refuses values such as ones holding a newline. The
 * message names the header but not its value, which may be a secret.
 */
function assertValidHeaderValue(name: string, value: string): void {
  try {
    new Headers([[name, value]]);
  } catch {
    throw new ApiRequestError(`invalid header "${name}": the value has characters HTTP does not allow`);
  }
}

/** A key ending in `[]` always builds an array, even from a single value. */
const ARRAY_KEY_SUFFIX = '[]';

/** Splits `key=value` (or `key[]=value`) on the first `=`. */
function splitField(field: string): { key: string; text: string; array: boolean } {
  const separator = field.indexOf('=');
  const rawKey = separator === -1 ? '' : field.slice(0, separator);
  const array = rawKey.endsWith(ARRAY_KEY_SUFFIX);
  const key = array ? rawKey.slice(0, -ARRAY_KEY_SUFFIX.length) : rawKey;
  if (key.length === 0) {
    throw new ApiRequestError(`invalid field "${field}": expected key=value or key[]=value`);
  }
  return { key, text: field.slice(separator + 1), array };
}

/** JSON's number grammar. It has no leading zeros, so ids like `007` stay strings. */
const JSON_NUMBER = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/;
const JSON_KEYWORDS = ['true', 'false', 'null'];

/**
 * The JSON text a `-F` value puts in a body: a number, true/false or null as a literal, written
 * exactly as given so int64 values (nanosecond timestamps) and `1.0` reach the server unchanged;
 * anything else as a JSON string. Parsing into a JS number would round past 2^53.
 */
export function typedFieldJson(value: string): string {
  return JSON_KEYWORDS.includes(value) || JSON_NUMBER.test(value) ? value : JSON.stringify(value);
}

/**
 * One `-f`/`-F` field: its text as typed (for a query string), as JSON (for a body), and whether its
 * key was written `key[]`.
 */
interface Field {
  key: string;
  text: string;
  json: string;
  array: boolean;
}

function parseFields(rawFields: string[], typedFields: string[]): Field[] {
  return [
    ...rawFields.map((field): Field => {
      const { key, text, array } = splitField(field);
      return { key, text, json: JSON.stringify(text), array };
    }),
    ...typedFields.map((field): Field => {
      const { key, text, array } = splitField(field);
      return { key, text, json: typedFieldJson(text), array };
    }),
  ];
}

/**
 * Builds a JSON object from fields. A key becomes an array when it repeats or is written `key[]`;
 * otherwise its single value is a scalar. Written as text rather than through JSON.stringify so
 * `-F` numbers keep their exact digits.
 */
function fieldsToBody(fields: Field[]): string {
  const valuesByKey = new Map<string, { values: string[]; array: boolean }>();
  for (const { key, json, array } of fields) {
    const entry = valuesByKey.get(key);
    valuesByKey.set(key, {
      values: [...(entry?.values ?? []), json],
      array: array || (entry?.array ?? false),
    });
  }
  const members = [...valuesByKey].map(([key, { values, array }]) =>
    `${JSON.stringify(key)}:${array || values.length > 1 ? `[${values.join(',')}]` : values[0]}`);
  return `{${members.join(',')}}`;
}

/**
 * Resolves `-X`, defaulting to GET unless `--input` supplies a body. Fields alone keep GET (as query
 * parameters), so narrowing a list never silently becomes a write.
 */
export function parseMethod(method: string | undefined, hasBodyInput: boolean): HttpMethod {
  if (method === undefined) {
    return hasBodyInput ? 'POST' : 'GET';
  }
  const upper = method.toUpperCase();
  const match = HTTP_METHODS.find((candidate) => candidate === upper);
  if (!match) {
    throw new ApiRequestError(`unsupported method "${method}"; use one of ${HTTP_METHODS.join(', ')}`);
  }
  return match;
}

export function requiresConfirmation(method: HttpMethod): boolean {
  return !SAFE_METHODS.includes(method);
}

/**
 * Validates the user's flags and assembles the request `grepr api` will send. Every flag is checked
 * before the `--input` body is read.
 */
export async function buildApiRequest(input: ApiRequestInput): Promise<ApiRequest> {
  const endpoint = parseEndpoint(input.endpoint);
  const fields = parseFields(input.rawFields, input.typedFields);
  const hasInput = input.readInputBody !== undefined;
  const method = parseMethod(input.method, hasInput);
  const headers = parseHeaders(input.headers);

  if (hasInput && BODYLESS_METHODS.includes(method)) {
    throw new ApiRequestError(`${method} requests cannot send a body; drop --input`);
  }

  const fieldsInQuery = QUERY_FIELD_METHODS.includes(method);
  if (!fieldsInQuery && hasInput && fields.length > 0) {
    throw new ApiRequestError('--input cannot be combined with -f/-F fields for a request body');
  }
  const query = fieldsInQuery
    ? [...endpoint.query, ...fields.map(({ key, text }): [string, string] => [key, text])]
    : endpoint.query;
  const fieldBody = !fieldsInQuery && fields.length > 0 ? fieldsToBody(fields) : undefined;
  const body = input.readInputBody ? await input.readInputBody() : fieldBody;
  return { method, path: endpoint.path, query, headers: withJsonContentType(headers, body), body };
}

/** Defaults a body's Content-Type to JSON unless the user set one with -H. */
function withJsonContentType(headers: Record<string, string>, body: string | undefined): Record<string, string> {
  const hasContentType = Object.keys(headers).some((name) => name.toLowerCase() === 'content-type');
  return body === undefined || hasContentType ? headers : { ...headers, 'Content-Type': 'application/json' };
}
