import { z } from 'zod';

/**
 * Shared input primitives. Every tool parameter on both servers is built from these,
 * so validation is uniform rather than per-tool improvisation.
 *
 * `slug` is the important one: slugs are interpolated into upstream URLs, so an
 * unvalidated slug is a path-traversal and request-forgery vector. The pattern below
 * admits only the shape both catalogs actually use.
 */
export const slug = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Must be a lowercase hyphenated slug.');

export const query = z
  .string()
  .min(1, 'Provide something to search for.')
  .max(200, 'Query is too long.')
  .transform((s) => s.trim());

export const limit = z.number().int().min(1).max(50).default(20);

export const cursor = z.number().int().min(0).max(10_000).default(0);
