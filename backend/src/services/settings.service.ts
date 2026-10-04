import { DEFAULT_SETTINGS, SETTINGS_SECTIONS, type Settings, type SettingsSection } from '../config/defaultSettings.js';
import { SystemSetting } from '../models/SystemSetting.js';
import { settingsSchemas } from '../validators/settings.js';
import { AppError } from '../utils/AppError.js';
import { changedFields } from '../utils/diff.js';
import { AUDIT } from '../config/auditActions.js';
import { auditAs } from './AuditService.js';
import type { Actor } from '../types/index.js';

const isSection = (s: string): s is SettingsSection => (SETTINGS_SECTIONS as string[]).includes(s);

const CACHE_MS = 30_000;
let cache: { at: number; value: Settings } | null = null;

/** Settings are read on almost every request but change rarely: cached briefly per server instance (cleared on save). */
export async function getSettings(): Promise<Settings> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  const rows = await SystemSetting.find().lean();
  const out: Record<string, unknown> = {};
  for (const s of SETTINGS_SECTIONS) {
    const stored = rows.find((r) => r.key === s)?.value as object | undefined;
    out[s] = { ...DEFAULT_SETTINGS[s], ...(stored ?? {}) }; // missing keys fall back to defaults
  }
  cache = { at: Date.now(), value: out as Settings };
  return cache.value;
}
export async function getSection<K extends SettingsSection>(s: K): Promise<Settings[K]> {
  return (await getSettings())[s];
}
/** Only non-sensitive company details, for branding on screens and exports. */
export async function getPublicSettings() {
  const s = await getSettings();
  return { company: s.company, preferences: s.preferences };
}

export async function updateSection(section: string, value: unknown, actor: Actor) {
  if (!isSection(section)) throw AppError.notFound('Unknown settings section', 'SETTINGS_SECTION_NOT_FOUND');
  const parsed = settingsSchemas[section].safeParse(value);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const i of parsed.error.issues) fields[i.path.join('.') || '_'] ??= i.message;
    throw AppError.badRequest('Please check the highlighted fields', 'VALIDATION_ERROR', fields);
  }
  const before = (await getSettings())[section];
  await SystemSetting.updateOne({ key: section }, { $set: { value: parsed.data, updatedBy: actor.id } }, { upsert: true });
  cache = null;
  const d = changedFields(before as Record<string, unknown>, parsed.data as Record<string, unknown>);
  if (d.changed) await auditAs(actor, { action: AUDIT.SETTINGS_CHANGED, entity: 'Settings', entityId: section, entityLabel: section, before: d.before, after: d.after });
  return (await getSettings())[section];
}

/** The slice of settings the finance services read. */
export async function getFinanceRules() {
  const s = await getSettings();
  return { repayment: s.repayment, latePayment: s.latePayment, topup: s.topup, loans: s.loans, transactions: s.transactions };
}
