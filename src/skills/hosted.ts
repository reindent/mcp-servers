#!/usr/bin/env node
import { createFetchHandler } from '../shared/hosted.js';
import { toLambdaHandler } from '../shared/lambda.js';
import { serveLocal } from '../shared/local-http.js';
import { build } from './index.js';

/**
 * Hosted entry for the skills server: the Lambda handler, plus a localhost runner
 * for testing. The origin secret and host allowlist come from the environment so the
 * same bundle serves local (unset = open on 127.0.0.1) and production (set by the deployment).
 */
export const fetchHandler = createFetchHandler({
  build,
  originSecret: process.env.ORIGIN_SECRET,
  allowedHosts: process.env.ALLOWED_HOSTS ? process.env.ALLOWED_HOSTS.split(',') : ['skills.reindent.com'],
  // skills.reindent.com is shared with the static skills site, so this server lives under
  // /mcp (the edge Route is skills.reindent.com/mcp*; every other path stays the site).
  path: '/mcp',
});

export const handler = toLambdaHandler(fetchHandler);

if (process.env.MCP_LOCAL_PORT) {
  const port = Number(process.env.MCP_LOCAL_PORT);
  serveLocal(fetchHandler, port).then(() => {
    process.stderr.write(`${JSON.stringify({ server: 'skills', event: 'ready', transport: 'http', bind: `127.0.0.1:${port}` })}\n`);
  });
}
