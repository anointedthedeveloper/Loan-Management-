import { asyncHandler, ok } from '../utils/http.js';
import { sendPage } from '../utils/pagination.js';
import { paginationSchema } from '../validators/common.js';
import { DEFAULT_ROLE_PERMISSIONS, ROLES, ROLE_LABELS, permissionGroups } from '../config/permissions.js';
import * as staff from '../services/staff.service.js';
import { actorOf } from './customerController.js';

const id = (req: { params: Record<string, unknown> }) => String(req.params.id);

export const list = asyncHandler(async (_req, res) => ok(res, { users: await staff.listStaff() }));
export const get = asyncHandler(async (req, res) => ok(res, { user: await staff.getStaff(id(req)) }));
export const permissionCatalogue = asyncHandler(async (_req, res) =>
  ok(res, { groups: permissionGroups(), defaults: DEFAULT_ROLE_PERMISSIONS, roles: ROLES.map((value) => ({ value, label: ROLE_LABELS[value] })) }));
export const create = asyncHandler(async (req, res) => ok(res, { user: await staff.createStaff(req.body, actorOf(req)) }, 'Staff account created', 201));
export const update = asyncHandler(async (req, res) => ok(res, { user: await staff.updateStaff(id(req), req.body, actorOf(req)) }, 'Staff account updated'));
export const resetPassword = asyncHandler(async (req, res) => ok(res, await staff.resetStaffPassword(id(req), req.body.password, actorOf(req)), 'Password reset'));
export const remove = asyncHandler(async (req, res) => { await staff.deleteStaff(id(req), actorOf(req)); ok(res, null, 'Staff account deleted'); });
export const activity = asyncHandler(async (req, res) => { const q = paginationSchema.parse(req.query); const r = await staff.getStaffActivity(id(req), q); sendPage(res, r.items, q, r.total); });
