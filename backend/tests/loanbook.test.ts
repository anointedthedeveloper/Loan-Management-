import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, as, setupDb, teardownDb, ceoToken, accountantToken, customerPayload } from './helpers.js';
import { User } from '../src/models/User.js';

let ceo = ''; let acct = ''; let product = '';
const api = (m: 'get' | 'post' | 'put', url: string, t = ceo) => (request(app) as any)[m](url).set(as(t));
const bin = (res: any, cb: any) => { const c: Buffer[] = []; res.on('data', (d: Buffer) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); };
const ym = (monthsAgo: number) => { const d = new Date(); d.setUTCMonth(d.getUTCMonth() - monthsAgo); return d.toISOString().slice(0, 7); };

beforeAll(async () => {
  await setupDb(); ceo = await ceoToken(); acct = await accountantToken();
  product = (await api('post', '/api/loan-products').send({ name: 'Salary Advance', code: 'SAL', category: 'Salary advance', interestRate: 5, rateBasis: 'per_month', applicationFeeRate: 4, allowedFrequencies: ['monthly'], defaultFrequency: 'monthly' })).body.data.product.id;
});
afterAll(teardownDb);

async function client(name: string, ippis: string, ministry: string, legacyId?: string) {
  const [first, last] = name.split(' ');
  return (await api('post', '/api/customers').send(customerPayload({ firstName: first, middleName: '', lastName: last, legacyId, employment: { sector: 'government', ippisNumber: ippis, ministry, occupation: 'Clerk' } }))).body.data.customer.id as string;
}
const loan = async (customerId: string, amount: number, months: number, start: string, first: string) =>
  (await api('post', '/api/loans').send({ customerId, productId: product, amount, duration: { value: months, unit: 'months' }, startDate: start, firstPaymentDate: first })).body.data.loan;
const pay = (loanId: string, amount: number, date: string) => api('post', '/api/repayments').send({ loanId, amount, date, method: 'cash' });

/** Tiny evaluator for the Excel formulas we write (ROUND, SUM, cell refs, %), to prove they compute the same numbers as the engine. */
function evalFormula(f: string, cell: (ref: string) => number): number {
  const withRanges = f.replace(/SUM\(([A-Z]+\d+):([A-Z]+\d+)\)/g, (_m, a: string, b: string) => {
    const [ca, ra] = [a.replace(/\d+/g, ''), Number(a.replace(/\D+/g, ''))]; const [cb] = [b.replace(/\d+/g, '')];
    const col = (s: string) => [...s].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0); const letter = (n: number) => { let s = ''; while (n > 0) { s = String.fromCharCode(65 + ((n - 1) % 26)) + s; n = Math.floor((n - 1) / 26); } return s; };
    let total = 0; for (let c = col(ca); c <= col(cb); c++) total += cell(`${letter(c)}${ra}`); return String(total);
  });
  const js = withRanges.replace(/([A-Z]+\d+)/g, (_m, ref: string) => String(cell(ref))).replace(/(\d+(?:\.\d+)?)%/g, '($1/100)').replace(/ROUND\(/g, 'R2(');
  return new Function('R2', `return ${js}`)((x: number, d: number) => Math.round((x + Number.EPSILON) * 10 ** d) / 10 ** d);
}

describe("loan book (Protech's monthly-breakdown layout)", () => {
  let ids: string[] = [];
  beforeAll(async () => {
    const a = await client('Omoloro Sylvia', '437602', 'OSGF', '473');
    const b = await client('Rafiu Akeem', '168029', 'SALARIES', '333');
    const l1 = await loan(a, 150000, 12, `${ym(3)}-04`, `${ym(2)}-01`);     // sheet row 1 shape: 150,000 loan amount (fee 6,000, principal 150,000)
    const l2 = await loan(b, 200000, 12, `${ym(2)}-12`, `${ym(1)}-01`);     // sheet row 3 shape: 200,000 loan amount, EMI 26,666.67
    ids = [l1.id, l2.id];
    await pay(l1.id, 12500, `${ym(2)}-05`); await pay(l1.id, 12500, `${ym(1)}-05`); await pay(l1.id, 5000, `${ym(1)}-20`);
    await pay(l2.id, 26666.67, `${ym(1)}-03`);
  });

  it('JSON: one row per loan with the calculator columns and one column per month', async () => {
    const r = (await api('get', '/api/reports/loan-book')).body.data;
    const keys = r.columns.map((c: any) => c.label);
    for (const k of ['S/N', 'Clients ID', 'Clients Name', 'IPPIS NO', 'MINISTRY', 'Tenor', 'Payment Date', 'Balance B/Fwd', 'Loan amount', 'Application Fee', 'Principal', 'Interest', 'Gross Loan', 'Monthly repayment (EMI)', 'Start Date', 'End date', 'Status', 'Repayment to date', 'Balance (Gross loan - repayment)']) expect(keys).toContain(k);
    expect(r.columns.filter((c: any) => c.key.startsWith('m_')).length).toBeGreaterThanOrEqual(3);
    const row = r.rows.find((x: any) => x.clientName === 'Omoloro Sylvia');
    expect(row).toMatchObject({ clientId: '473', ippis: '437602', ministry: 'OSGF', tenor: 12, loanAmount: 150000, applicationFee: 6000, principal: 150000, interest: 90000, grossLoan: 240000, emi: 20000, type: 'NEW' });
    expect(row[`m_${ym(2)}`]).toBe(12500); expect(row[`m_${ym(1)}`]).toBe(17500);
    expect(row.repaid).toBe(30000); expect(row.balance).toBe(210000);
    expect(JSON.stringify(r.rows)).not.toContain('_calc');
    expect(r.rows.find((x: any) => x.clientName === 'Rafiu Akeem')).toMatchObject({ grossLoan: 320000, emi: 26666.67, repaid: 26666.67, balance: 293333.33 });
    expect(r.totals.grossLoan).toBe(560000);
  });

  it('Excel: formulas reproduce the engine exactly, and repayment-to-date / balance are live formulas', async () => {
    const res = await api('get', '/api/reports/loan-book?format=xlsx').buffer(true).parse(bin);
    expect(res.headers['content-disposition']).toMatch(/loan-book.*\.xlsx/);
    const { default: ExcelJS } = await import('exceljs');
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(res.body);
    const ws = wb.worksheets[0]!;
    let headRow = 0; ws.eachRow((row, n) => { if (!headRow && row.values && (row.values as any[]).includes('Clients Name')) headRow = n; });
    const heads = (ws.getRow(headRow).values as any[]);
    const col = (label: string) => heads.indexOf(label);
    const letter = (i: number) => ws.getColumn(i).letter;
    const rows = [headRow + 1, headRow + 2];
    const valueAt = (ref: string): number => { const c = ws.getCell(ref).value as any; return typeof c === 'object' && c ? Number(c.result) : Number(c); };
    for (const n of rows) {
      const get = (label: string) => ws.getCell(`${letter(col(label))}${n}`);
      expect(String((get('Application Fee').value as any).formula)).toMatch(/^ROUND\(/);        // =ROUND(I3*4%,2): the fee stands alone
      expect(String((get('Principal').value as any).formula)).not.toContain(letter(col('Application Fee'))); // principal never includes the fee
      expect(String((get('Interest').value as any).formula)).toContain('5%');                    // =ROUND(K3*5%*F3,2)
      for (const label of ['Application Fee', 'Principal', 'Interest', 'Gross Loan', 'Monthly repayment (EMI)', 'Repayment to date', 'Balance (Gross loan - repayment)']) {
        const cell = get(label).value as any;
        expect(cell.formula, label).toBeTruthy();
        expect(evalFormula(cell.formula, valueAt), `${label} row ${n}`).toBeCloseTo(Number(cell.result), 2); // formula output == value the engine computed
      }
    }
    const first = ws.getCell(`${letter(col('Clients Name'))}${rows[0]}`).value;
    expect(['Omoloro Sylvia', 'Rafiu Akeem']).toContain(first);
  });

  it('is available to accountants (reports.export by default) and audited', async () => {
    await User.updateOne({ username: 'accountant' }, { permissions: [] });
    expect((await api('get', '/api/reports/loan-book?format=xlsx', acct)).status).toBe(200);
    await User.updateOne({ username: 'accountant' }, { permissions: ['reports.view'] });
    expect((await api('get', '/api/reports/loan-book?format=xlsx', acct)).status).toBe(403);
    expect((await api('get', '/api/reports/loan-book', acct)).status).toBe(200);
    await User.updateOne({ username: 'accountant' }, { permissions: [] });
  });

  it("a loan's statement Excel has a Monthly breakdown sheet (schedule, paid and remaining per month)", async () => {
    const res = await api('get', `/api/loans/${ids[0]}/statement?format=xlsx`).buffer(true).parse(bin);
    const { default: ExcelJS } = await import('exceljs');
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(res.body);
    expect(wb.worksheets.map((w) => w.name).some((n) => /monthly/.test(n))).toBe(true);
    const ms = wb.worksheets.find((w) => /monthly/.test(w.name))!;
    let n = 0; ms.eachRow((row) => { if (typeof row.getCell(1).value === 'number') n++; });
    expect(n).toBe(12);
    const st = (await api('get', `/api/loans/${ids[0]}/statement`)).body.data.statement.loans[0];
    expect(st.schedule).toHaveLength(12); expect(st.schedule[0]).toMatchObject({ number: 1, emi: 20000 });
    expect(st.loan.monthlyInterest).toBe(7500); // 150,000 x 5%
    expect(st.schedule.reduce((a: number, m: any) => a + m.paid, 0)).toBeCloseTo(30000, 2);
  });
});

describe('deployment config', () => {
  const cfg = JSON.parse(readFileSync(join(process.cwd(), 'vercel.json'), 'utf8'));
  it('runs the API in Paris, next to the Atlas cluster', () => { expect(cfg.regions).toEqual(['cdg1']); });
  it('bundles the PDF library files that Vercel cannot trace', () => { expect(cfg.functions['api/index.js'].includeFiles).toContain('node_modules/pdfkit/js'); });
});
