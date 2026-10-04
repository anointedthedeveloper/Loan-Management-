import { Customer } from './Customer.js';

let done = false;
/**
 * The phone-uniqueness index used to cover every live customer, so a second customer without a phone number (e.g. one imported
 * from the old loan book) was rejected as a duplicate of the first. It now applies only to customers that have a phone.
 * MongoDB keeps an existing index of the same name unchanged, so older databases need it replaced once.
 */
export async function ensureCustomerIndexes(force = false) {
  if (done && !force) return;
  try {
    const existing = await Customer.collection.indexes();
    const phone = existing.find((i) => i.name === 'uniq_phone');
    if (phone && !(phone.partialFilterExpression as any)?.phone) await Customer.collection.dropIndex('uniq_phone');
    await Customer.createIndexes();
    done = true;
  } catch (e) { console.error('Could not update customer indexes', e); }
}
