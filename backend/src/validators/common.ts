import { z } from 'zod';

export const pageQuery = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
};
export const paginationSchema = z.object(pageQuery);
export const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid identifier');
