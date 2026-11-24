function calculateMonthlyBudget({ month, income, bills, installments, debts, payments }) {
  const cents = amount => Math.round(Number(amount || 0) * 100);
  const sumCents = (rows, field) => rows.reduce((total, row) => total + cents(row[field]), 0);
  const paid = { bill: 0, installment: 0, debt: 0 };
  const installmentPayments = new Set();
  const debtPaymentsById = new Map();

  for (const payment of payments) {
    const { kind, item_id: id } = payment;
    if (kind !== 'bill' && kind !== 'installment' && kind !== 'debt') continue;
    const amount = cents(payment.amount);
    paid[kind] += amount;
    if (kind === 'installment') installmentPayments.add(String(id));
    if (kind === 'debt') {
      const key = String(id);
      debtPaymentsById.set(key, (debtPaymentsById.get(key) || 0) + amount);
    }
  }

  const openBills = sumCents(bills.filter(bill => !bill.payment_id), 'expected_amount');
  const installmentPending = sumCents(
    installments.filter(installment => !installmentPayments.has(String(installment.id))),
    'amount'
  );
  const debtPending = debts.reduce((total, debt) => {
    const createdMonth = String(debt.created_at || '').slice(0, 7);
    if (createdMonth && createdMonth > month) return total;
    const paidOnDebt = debtPaymentsById.get(String(debt.id)) || 0;
    const expected = Math.max(0, cents(debt.monthly_payment) - paidOnDebt);
    return total + Math.min(Math.max(0, cents(debt.balance)), expected);
  }, 0);
  const paidThisMonth = paid.bill + paid.installment + paid.debt;
  const remainingExpenses = openBills + installmentPending + debtPending;

  return {
    openBills: openBills / 100,
    installmentTotal: (paid.installment + installmentPending) / 100,
    debtPayments: (paid.debt + debtPending) / 100,
    debtTotal: sumCents(debts, 'balance') / 100,
    billTotal: (paid.bill + openBills) / 100,
    available: (cents(income) - paidThisMonth - remainingExpenses) / 100,
    paidThisMonth: paidThisMonth / 100,
    remainingExpenses: remainingExpenses / 100
  };
}

if (typeof module === 'object' && module.exports) module.exports = calculateMonthlyBudget;
