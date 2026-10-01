import { Schema, model } from 'mongoose';

const counterSchema = new Schema({ _id: String, seq: { type: Number, default: 0 } }, { versionKey: false });
const Counter = model('Counter', counterSchema);

/** Atomic, duplicate-proof sequence generator (single findOneAndUpdate with $inc). */
export async function nextSequence(name: string): Promise<number> {
  const c = await Counter.findOneAndUpdate({ _id: name }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after' });
  return c!.seq;
}
