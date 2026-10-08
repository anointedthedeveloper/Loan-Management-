import { asyncHandler, ok } from '../utils/http.js';
import { getOverview } from '../services/dashboard.service.js';

export const overview = asyncHandler(async (req, res) => ok(res, await getOverview(req.auth!.permissions, req.auth!.role)));
