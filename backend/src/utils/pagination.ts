import type { Response } from 'express';

export interface PageQuery { page: number; limit: number }
export const skipOf = ({ page, limit }: PageQuery) => (page - 1) * limit;
export const pageMeta = ({ page, limit }: PageQuery, total: number) => ({ page, limit, total, pages: Math.ceil(total / limit) });

export const sendPage = <T>(res: Response, data: T[], q: PageQuery, total: number) =>
  res.json({ success: true, data, pagination: pageMeta(q, total) });
