import type { FetchHandler } from './hosted.js';

/**
 * Bridge between a Lambda Function URL invocation (API Gateway v2 payload shape) and
 * the fetch-standard handler. Deliberately dependency-free: the event shape below is
 * the subset we read, typed locally, so the runtime bundle stays small.
 */
export type FunctionUrlEvent = {
  version?: string;
  rawPath: string;
  rawQueryString?: string;
  headers: Record<string, string | undefined>;
  body?: string;
  isBase64Encoded?: boolean;
  requestContext: { http: { method: string }; domainName?: string };
};

export type FunctionUrlResult = {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  isBase64Encoded: boolean;
};

export function toLambdaHandler(handler: FetchHandler) {
  return async (event: FunctionUrlEvent): Promise<FunctionUrlResult> => {
    const host = event.headers['host'] ?? event.requestContext.domainName ?? 'localhost';
    const qs = event.rawQueryString ? `?${event.rawQueryString}` : '';
    const url = `https://${host}${event.rawPath}${qs}`;

    const headers = new Headers();
    for (const [k, v] of Object.entries(event.headers)) if (v !== undefined) headers.set(k, v);

    const method = event.requestContext.http.method;
    const hasBody = method !== 'GET' && method !== 'HEAD' && event.body !== undefined;
    const body = hasBody
      ? event.isBase64Encoded
        ? Buffer.from(event.body as string, 'base64')
        : (event.body as string)
      : undefined;

    const res = await handler(new Request(url, { method, headers, body }));
    const out: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      out[k] = v;
    });
    return {
      statusCode: res.status,
      headers: out,
      body: await res.text(),
      isBase64Encoded: false,
    };
  };
}
