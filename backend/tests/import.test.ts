import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { app, as, setupDb, teardownDb, ceoToken, accountantToken, customerPayload } from './helpers.js';
import { Customer } from '../src/models/Customer.js';

let ceo = ''; let acct = '';
beforeAll(async () => { await setupDb(); ceo = await ceoToken(); acct = await accountantToken(); });
afterAll(teardownDb);

const HEAD = ['Clients ID', 'Clients Name', 'IPPIS NO', 'MINISTRY', 'phone no', 'Address', 'NIN', 'BVN', 'DATE OF BIRTH', 'MARITAL STATUS', 'NEXT OF KIN PHONE NO'];
async function sheet(rows: unknown[][]) {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Sheet1'); ws.addRow(HEAD); rows.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}
const post = (buf: Buffer, qs = '', t = ceo) => request(app).post(`/api/customers/import${qs}`).set(as(t)).set('Content-Type', 'application/octet-stream').send(buf);

describe('customer import', () => {
  it('imports the client sheet: client numbers become customer IDs, IPPIS decides the worker type, profiles are incomplete', async () => {
    const buf = await sheet([
      [640, 'AINA DAVID', null, 'PHIS'],                       // no IPPIS: non-government, MINISTRY is the organisation
      [633, 'OGUNBUFUNMI ILEMOBAYO', 437618, '0SGF'],         // typo in the ministry is fixed
      [632, 'AMOS CHRISTIANA HASSANA', 316805, 'CCB'],
      [632, 'CHRISTOPHER ANGWU IMA ', 86768, 'OSGF'],         // duplicate number, free slot below -> 631
      [630, 'ANIDU AISHA QUEEN', 407624, 'LABOUR'],
      [null, 'ISAAC ROSE', 760, 'SPORT'],                      // no number: gets the next one after the highest
      [201, 'AYENIKO YEMISI VALENTINA', 59623, 'OSGF', '0803 555 0101', '4 Main St', '12345678901', '10987654321', '12/05/1985', 'Married', '08099990001'],
    ]);
    const dry = await post(buf, '?dryRun=true');
    expect(dry.body.data.report).toMatchObject({ dryRun: true, total: 7, created: 7 });
    expect(await Customer.countDocuments()).toBe(0); // dry run saves nothing

    const r = (await post(buf)).body.data.report;
    expect(r).toMatchObject({ created: 7, updated: 0, skipped: [] });
    expect(r.idChanges.map((c: any) => [c.name, c.to])).toEqual([['Christopher Angwu Ima', 'PTC-000631'], ['Isaac Rose', 'PTC-000641']]);
    const by = (id: string) => Customer.findOne({ customerId: id }).lean() as any;
    expect((await by('PTC-000640'))).toMatchObject({ fullName: 'Aina David', employment: { sector: 'non_government', ministry: 'PHIS' } });
    expect((await by('PTC-000633')).employment).toMatchObject({ sector: 'government', ippisNumber: '437618', ministry: 'OSGF' });
    expect((await by('PTC-000760'))).toBeNull();
    const full = await by('PTC-000201');
    expect(full).toMatchObject({ phone: '08035550101', nin: '12345678901', bvn: '10987654321', maritalStatus: 'married', address: '4 Main St' });
    expect(full.emergencyContact.phone).toBe('08099990001');
    expect(full.dateOfBirth.toISOString().slice(0, 10)).toBe('1985-05-12');

    // incomplete profiles are flagged with what is missing; complete-enough ones less so
    const aina = (await request(app).get(`/api/customers/${(await Customer.findOne({ customerId: 'PTC-000640' }))!._id}`).set(as(ceo))).body.data.customer;
    expect(aina.profile.complete).toBe(false);
    expect(aina.profile.missing).toEqual(expect.arrayContaining(['Phone number', 'NIN', 'BVN', 'Address', 'Next of kin phone']));
    expect(aina.profile.missing).not.toContain('IPPIS number'); // not needed for non-government workers
    const list = (await request(app).get('/api/customers?profile=incomplete&limit=50').set(as(ceo))).body;
    expect(list.pagination.total).toBe(7);

    // re-running is safe and never overwrites
    const again = (await post(buf)).body.data.report;
    expect(again).toMatchObject({ created: 0, updated: 0, unchanged: 7 });
    // new customers continue after the old numbers
    const created = await request(app).post('/api/customers').set(as(ceo)).send(customerPayload());
    expect(created.body.data.customer.customerId).toBe('PTC-000642');
  });

  it('IPPIS numbers stay unique, staff fill missing details later, and only permitted users can import', async () => {
    const c = (await Customer.findOne({ customerId: 'PTC-000640' }))!;
    const patch = (body: object, t = ceo) => request(app).patch(`/api/customers/${c._id}`).set(as(t)).send(body);
    const r = await patch({ phone: '0803 111 2222', nin: '11122233344' }); // partial update: the rest stays blank
    expect(r.status).toBe(200);
    expect(r.body.data.customer.profile.missing).not.toContain('NIN');
    expect(r.body.data.customer.profile.missing).toContain('BVN');
    const dup = await request(app).patch(`/api/customers/${(await Customer.findOne({ customerId: 'PTC-000633' }))!._id}`).set(as(ceo)).send({ employment: { ippisNumber: '316805' } });
    expect(dup.status).toBe(409);
    expect((await post(await sheet([[900, 'X Y', 1, 'A']]), '', acct)).status).toBe(403);
    expect((await request(app).post('/api/customers/import').set(as(ceo)).set('Content-Type', 'application/octet-stream').send(Buffer.from('not excel'))).body.code).toBe('IMPORT_BAD_FILE');
  });
});

describe('older databases', () => {
  it('imports many customers without phone numbers even when the old phone index exists', async () => {
    await Customer.deleteMany({});
    const { ensureCustomerIndexes } = await import('../src/models/customerIndexes.js');
    // recreate the old index definition (unique on every live customer, no phone filter)
    await Customer.collection.dropIndex('uniq_phone').catch(() => undefined);
    await Customer.collection.createIndex({ phone: 1 }, { unique: true, partialFilterExpression: { isArchived: false }, name: 'uniq_phone' });
    void ensureCustomerIndexes;
    const buf = await sheet([[700, 'A ONE', 111, 'OSGF'], [701, 'B TWO', 222, 'CCB'], [702, 'C THREE', 333, 'NCC']]);
    const r = (await post(buf)).body.data.report;
    expect(r).toMatchObject({ created: 3, skipped: [] });
  });
});
