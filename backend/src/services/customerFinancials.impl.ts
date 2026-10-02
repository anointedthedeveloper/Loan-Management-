import type { Types } from 'mongoose';
import { Loan } from '../models/Loan.js';
import { Transaction } from '../models/Transaction.js';
import { fromKobo, toKobo } from '../utils/money.js';
import { setCustomerFinancialProvider, type CustomerFinancialProvider } from './customerFinancials.service.js';
import { listTransactions } from './transaction.service.js';
import { listLoans } from './loan.service.js';

/** Real provider: every figure is derived from loans and the ledger — nothing is stored twice. */
const provider: CustomerFinancialProvider = {
  async hasFinancialHistory(id: Types.ObjectId) {
    return !!(await Loan.exists({ customer: id })) || !!(await Transaction.exists({ customer: id }));
  },
  async getSummary(id: Types.ObjectId) {
    if (!(await this.hasFinancialHistory(id))) return null;
    const [tx] = await Transaction.aggregate([
      { $match: { customer: id, reversedAt: { $exists: false }, type: { $in: ['disbursement', 'topup', 'repayment'] }, isCash: true } },
      { $group: { _id: null, borrowed: { $sum: { $cond: [{ $in: ['$type', ['disbursement', 'topup']] }, '$amount', 0] } }, repaid: { $sum: { $cond: [{ $eq: ['$type', 'repayment'] }, '$amount', 0] } } } },
    ]);
    const loans = await Loan.find({ customer: id }).select('status outstandingBalance');
    const live = loans.filter((l) => ['active', 'overdue', 'defaulted'].includes(l.status));
    return {
      totalBorrowed: tx?.borrowed ?? 0, totalRepaid: tx?.repaid ?? 0,
      outstandingBalance: fromKobo(live.reduce((s, l) => s + toKobo(l.outstandingBalance), 0)),
      activeLoans: live.length, completedLoans: loans.filter((l) => l.status === 'completed').length, overdueLoans: loans.filter((l) => l.status === 'overdue').length,
    };
  },
  async listLoans(id, skip, limit) { const r = await listLoans({ customer: id, page: Math.floor(skip / limit) + 1, limit, sort: 'createdAt', order: 'desc' }); return { items: r.items, total: r.total }; },
  async listRepayments(id, skip, limit) { const r = await listTransactions({ customer: id, type: 'repayment', page: Math.floor(skip / limit) + 1, limit, sort: 'date', order: 'desc' }); return r; },
  async listTransactions(id, skip, limit) { const r = await listTransactions({ customer: id, page: Math.floor(skip / limit) + 1, limit, sort: 'date', order: 'desc' }); return r; },
};

export const registerCustomerFinancials = () => setCustomerFinancialProvider(provider);
