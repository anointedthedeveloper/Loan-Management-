import ExcelJS from 'exceljs';
import { Customer } from '../models/Customer.js';
import { ensureSequenceAtLeast } from '../models/Counter.js';
import { CLIENT_ID_FLOOR, MARITAL_STATUSES } from '../config/customerOptions.js';
import { AUDIT } from '../config/auditActions.js';
import { normalizePhone } from '../utils/phone.js';
import { AppError } from '../utils/AppError.js';
import { auditAs } from './AuditService.js';
import { ensureCustomerIndexes } from '../models/customerIndexes.js';
import type { Actor } from '../types/index.js';

/**
 * Imports customers from Protech's customer sheet (Clients ID, Clients Name, IPPIS NO, MINISTRY, phone no, Address, NIN, BVN,
 * DATE OF BIRTH, MARITAL STATUS, NEXT OF KIN PHONE NO). Everything except name/IPPIS/ministry is usually blank: those profiles are
 * created as "incomplete" so staff are reminded to fill them in.
 *  - A client number becomes the customer ID (client 640 -> PTC-000640).
 *  - Rows with an IPPIS number are government workers; rows without are non-government and the MINISTRY column is their organisation.
 *  - Duplicate or missing client numbers get a fresh number after the highest one (never reused), and are listed in the report.
 *  - Re-running is safe: a row whose IPPIS number (or client number) already exists only fills in details that are still empty.
 */
export interface ImportReport {
  dryRun: boolean; total: number; created: number; updated: number; unchanged: number
  idChanges: { row: number; name: string; from: string | null; to: string; reason: string }[]
  skipped: { row: number; name: string; reason: string }[]
  warnings: { row: number; name: string; message: string }[]
  nextCustomerId: string
}

const MINISTRY_FIXES: Record<string, string> = { '0SGF': 'OSGF', 'POLICE AFAIR': 'POLICE AFFAIRS', 'SALARY': 'SALARIES', 'SPORT': 'SPORTS', 'LABOUR/PRODUCTI': 'LABOUR/PRODUCTIVITY' };
const pad = (n: number) => `PTC-${String(n).padStart(6, '0')}`;
const clean = (v: unknown) => (v === null || v === undefined ? '' : String(typeof v === 'object' && v && 'text' in (v as any) ? (v as any).text : v).replace(/\s+/g, ' ').trim());
const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s\-'/])([a-z])/g, (_m, a, b) => a + b.toUpperCase());
const normMinistry = (s: string) => { const u = s.toUpperCase().replace(/\s+/g, ' ').trim(); return MINISTRY_FIXES[u] ?? u; };

function parseDate(v: unknown): Date | null {
  if (v instanceof Date && !isNaN(+v)) return new Date(Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate()));
  const s = clean(v); if (!s) return null;
  let m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s); // dd/mm/yyyy (Nigerian order)
  if (m) { const d = new Date(Date.UTC(+m[3]!, +m[2]! - 1, +m[1]!)); return d.getUTCMonth() === +m[2]! - 1 ? d : null; }
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!));
  if (/^\d+$/.test(s) && +s > 1000 && +s < 80000) return new Date(Date.UTC(1899, 11, 30) + +s * 86_400_000); // Excel serial date
  return null;
}
const maritalOf = (s: string) => { const t = s.toLowerCase(); return MARITAL_STATUSES.find((m) => t.startsWith(m.value.slice(0, 4)))?.value; };

interface Row { row: number; id: number | null; name: string; ippis: string; ministry: string; phone: string; address: string; nin: string; bvn: string; dob: unknown; marital: string; nokPhone: string }

async function readRows(buf: Buffer): Promise<Row[]> {
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buf as any); } catch { throw AppError.badRequest('This is not a valid Excel (.xlsx) file', 'IMPORT_BAD_FILE'); }
  const ws = wb.worksheets[0];
  if (!ws) throw AppError.badRequest('The workbook has no sheets', 'IMPORT_BAD_FILE');
  const head = new Map<string, number>();
  ws.getRow(1).eachCell((c, i) => head.set(clean(c.value).toLowerCase(), i));
  const col = (...names: string[]) => names.map((n) => head.get(n)).find((x) => x !== undefined);
  const cName = col('clients name', 'client name', 'name'); const cIppis = col('ippis no', 'ippis number', 'ippis'); const cMin = col('ministry', 'organisation', 'organization');
  if (!cName) throw AppError.badRequest('Could not find a "Clients Name" column in the first row', 'IMPORT_BAD_FILE');
  const cId = col('clients id', 'client id', 'id'); const get = (r: ExcelJS.Row, c?: number) => (c ? r.getCell(c).value : null);
  const cPhone = col('phone no', 'phone', 'phone number'); const cAddr = col('address'); const cNin = col('nin'); const cBvn = col('bvn'); const cDob = col('date of birth', 'dob'); const cMs = col('marital status'); const cNok = col('next of kin phone no', 'next of kin phone');
  const rows: Row[] = [];
  ws.eachRow((r, n) => {
    if (n === 1) return;
    const name = clean(get(r, cName)); if (!name) return;
    const idRaw = clean(get(r, cId)).replace(/^PTC[-\s]?/i, ''); const idNum = /^\d+$/.test(idRaw) && +idRaw > 0 ? +idRaw : null;
    rows.push({ row: n, id: idNum, name, ippis: clean(get(r, cIppis)).toUpperCase(), ministry: normMinistry(clean(get(r, cMin))), phone: clean(get(r, cPhone)), address: clean(get(r, cAddr)), nin: clean(get(r, cNin)).replace(/\D/g, ''), bvn: clean(get(r, cBvn)).replace(/\D/g, ''), dob: get(r, cDob), marital: clean(get(r, cMs)), nokPhone: clean(get(r, cNok)) });
  });
  return rows;
}

export async function importCustomers(buf: Buffer, opts: { dryRun: boolean; actor: Actor }): Promise<ImportReport> {
  await ensureCustomerIndexes(true);
  const rows = await readRows(buf);
  if (!rows.length) throw AppError.badRequest('The sheet has no customers to import', 'IMPORT_EMPTY');
  const report: ImportReport = { dryRun: opts.dryRun, total: rows.length, created: 0, updated: 0, unchanged: 0, idChanges: [], skipped: [], warnings: [], nextCustomerId: '' };

  // 1. client numbers: first use of a number keeps it; duplicates/missing get a new one
  const used = new Set<number>(); const target = new Map<number, number>(); // row index -> client number
  rows.forEach((r, i) => { if (r.id && !used.has(r.id)) { used.add(r.id); target.set(i, r.id); } });
  const maxSheet = Math.max(0, ...used);
  const existing = await Customer.find({ isArchived: false }).select('customerId employment.ippisNumber legacyId fullName');
  const byIppis = new Map(existing.filter((c) => c.employment?.ippisNumber).map((c) => [String(c.employment!.ippisNumber).toUpperCase(), c]));
  const byLegacy = new Map(existing.filter((c) => c.legacyId).map((c) => [String(c.legacyId), c]));
  const byCustomerId = new Map(existing.map((c) => [c.customerId, c]));
  const existingMax = Math.max(0, ...existing.map((c) => +(/(\d+)$/.exec(c.customerId)?.[1] ?? 0)));
  let fresh = Math.max(CLIENT_ID_FLOOR, maxSheet, existingMax);
  rows.forEach((r, i) => {
    if (target.has(i)) return;
    if (r.ippis && byIppis.has(r.ippis)) { target.set(i, +(/(\d+)$/.exec(byIppis.get(r.ippis)!.customerId)?.[1] ?? 0)); return; } // already imported: keeps its number, nothing new is assigned
    const prev = rows[i - 1]?.id; const next = rows[i + 1]?.id;
    // the sheet is in descending order, so a duplicate sitting just above a free number is almost certainly a typo for it (632, 632, 630 -> 631)
    if (r.id && prev && next && prev - 1 > next && !used.has(prev - 1) && r.id === prev) { used.add(prev - 1); target.set(i, prev - 1); report.idChanges.push({ row: r.row, name: titleCase(r.name), from: String(r.id), to: pad(prev - 1), reason: `duplicate client number ${r.id}; the free number between ${prev} and ${next} was used` }); return; }
    fresh += 1; used.add(fresh); target.set(i, fresh);
    report.idChanges.push({ row: r.row, name: titleCase(r.name), from: r.id ? String(r.id) : null, to: pad(fresh), reason: r.id ? `duplicate client number ${r.id}` : 'no client number in the sheet' });
  });

  // 2. create / fill in
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!; const label = titleCase(r.name);
    const keptOriginal = !!r.id && target.get(i) === r.id;
    const customerId = pad(target.get(i)!);
    const tokens = label.split(' ');
    const firstName = tokens[0]!; const lastName = tokens.length > 1 ? tokens[tokens.length - 1]! : tokens[0]!; const middleName = tokens.length > 2 ? tokens.slice(1, -1).join(' ') : undefined;
    const warn = (message: string) => report.warnings.push({ row: r.row, name: label, message });
    const phone = r.phone ? normalizePhone(r.phone) : null; if (r.phone && !phone) warn(`phone "${r.phone}" is not a valid Nigerian number; left blank`);
    const nin = /^\d{11}$/.test(r.nin) ? r.nin : ''; if (r.nin && !nin) warn('NIN is not 11 digits; left blank');
    const bvn = /^\d{11}$/.test(r.bvn) ? r.bvn : ''; if (r.bvn && !bvn) warn('BVN is not 11 digits; left blank');
    const dob = r.dob ? parseDate(r.dob) : null; if (r.dob && !dob) warn('date of birth not understood; left blank');
    const marital = r.marital ? maritalOf(r.marital) : undefined; if (r.marital && !marital) warn(`marital status "${r.marital}" not understood; left blank`);
    const nok = r.nokPhone ? normalizePhone(r.nokPhone) : null; if (r.nokPhone && !nok) warn('next of kin phone not valid; left blank');
    const fields: Record<string, any> = {
      ...(phone ? { phone } : {}), ...(r.address ? { address: r.address } : {}), ...(nin ? { nin } : {}), ...(bvn ? { bvn } : {}), ...(dob ? { dateOfBirth: dob } : {}), ...(marital ? { maritalStatus: marital } : {}),
      ...(nok ? { 'emergencyContact.phone': nok } : {}),
    };

    const match = (r.ippis && byIppis.get(r.ippis)) || (keptOriginal && byLegacy.get(String(r.id))) || null;
    if (match) { // already in the system: only fill what is still empty
      const doc = await Customer.findById(match._id);
      if (!doc) continue;
      let changed = false;
      for (const [k, v] of Object.entries(fields)) { if (!doc.get(k)) { doc.set(k, v); changed = true; } }
      if (r.ministry && !doc.get('employment.ministry')) { doc.set('employment.ministry', r.ministry); changed = true; }
      if (!doc.get('employment.sector') && r.ippis) { doc.set('employment.sector', 'government'); changed = true; }
      if (changed) { if (!opts.dryRun) { try { await doc.save(); } catch (e: any) { report.skipped.push({ row: r.row, name: label, reason: `could not update: ${e?.code === 11000 ? 'a phone/NIN/BVN is already used by another customer' : e.message}` }); continue; } } report.updated++; } else report.unchanged++;
      continue;
    }
    const clash = byCustomerId.get(customerId);
    if (clash) { report.skipped.push({ row: r.row, name: label, reason: `${customerId} is already used by ${clash.fullName}. Remove that test customer first, or change the client number` }); continue; }
    byCustomerId.set(customerId, { customerId, fullName: label } as any);
    if (opts.dryRun) { report.created++; continue; }
    try {
      await Customer.create({
        customerId, firstName, middleName, lastName, fullName: label, status: 'active', createdBy: opts.actor.id, updatedBy: opts.actor.id,
        ...(keptOriginal ? { legacyId: String(r.id) } : {}),
        phone: phone ?? undefined, address: r.address || undefined, nin: nin || undefined, bvn: bvn || undefined, dateOfBirth: dob ?? undefined, maritalStatus: marital,
        employment: { sector: r.ippis ? 'government' : 'non_government', ippisNumber: r.ippis || undefined, ministry: r.ministry || undefined },
        emergencyContact: nok ? { phone: nok } : undefined,
      } as any);
      report.created++;
    } catch (e: any) { report.skipped.push({ row: r.row, name: label, reason: e?.code === 11000 ? 'a phone number, NIN, BVN or IPPIS number is already used by another customer' : e.message }); }
  }

  report.nextCustomerId = pad(Math.max(fresh, maxSheet, CLIENT_ID_FLOOR, ...[...used]) + 1);
  if (!opts.dryRun) {
    await ensureSequenceAtLeast('customer', Math.max(fresh, maxSheet, CLIENT_ID_FLOOR, ...[...used]));
    await auditAs(opts.actor, { action: AUDIT.CUSTOMERS_IMPORTED, entity: 'Customer', entityLabel: `${report.created} created, ${report.updated} updated`, after: { total: report.total, created: report.created, updated: report.updated, skipped: report.skipped.length } });
  }
  return report;
}
