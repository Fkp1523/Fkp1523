(() => {
  const DB_NAME = 'meu-financeiro-local';
  const STORE = 'data';
  const KEY = 'main';
  const collections = ['incomes', 'bills', 'installments', 'debts'];
  const backupTables = {
    incomes: 'incomes',
    bills: 'bills',
    billPayments: 'bill_payments',
    installments: 'installments',
    debts: 'debts',
    transactions: 'transactions'
  };
  const tables = Object.values(backupTables);
  const paymentKinds = ['bill', 'installment', 'debt'];
  const currencyMax = 9999999999.99;

  const empty = () => ({
    ...Object.fromEntries(tables.map(table => [table, []])),
    counters: Object.fromEntries(tables.map(table => [table, 1]))
  });
  const now = () => {
    const date = new Date();
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 19).replace('T', ' ');
  };
  const round = number => Math.round(Number(number) * 100) / 100;
  const sum = (rows, key) => round(rows.reduce((total, row) => total + Number(row[key]), 0));
  const monthOK = value => typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
  const active = rows => rows.filter(row => row.active !== 0 && row.active !== false);
  const recentFirst = key => (a, b) => String(b[key]).localeCompare(String(a[key])) || b.id - a.id;

  function openDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function withData(write, operation) {
    const db = await openDB();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, write ? 'readwrite' : 'readonly');
        const store = tx.objectStore(STORE);
        const request = store.get(KEY);
        let result;
        let failure;
        tx.oncomplete = () => resolve(result);
        tx.onabort = () => reject(failure || tx.error || new Error('Não foi possível acessar os dados deste aparelho.'));
        request.onsuccess = () => {
          try {
            const data = request.result || empty();
            result = operation(data);
            if (write) store.put(data, KEY);
          } catch (error) {
            failure = error;
            tx.abort();
          }
        };
      });
    } finally {
      db.close();
    }
  }

  function amount(value, min = 0.01) {
    const number = round(value);
    if (value == null || value === '' || !Number.isFinite(number) || number < min || number > currencyMax) {
      throw new Error('Informe um valor válido.');
    }
    return number;
  }

  function integer(value, min, max) {
    const number = Number(value);
    if (value == null || value === '' || !Number.isSafeInteger(number) || number < min || number > max) {
      throw new Error('Informe uma quantidade ou dia válido.');
    }
    return number;
  }

  function field(value, max, required = false) {
    if (typeof value !== 'string' && value != null) throw new Error('Informe um texto válido.');
    const text = value?.trim() || '';
    if (text.length > max || (required && !text)) throw new Error('Confira os campos de texto.');
    return text || null;
  }

  function day(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new Error('Informe uma data válida.');
    }
    const date = new Date(value + 'T12:00:00Z');
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
      throw new Error('Informe uma data válida.');
    }
    return value;
  }

  function month(value) {
    if (!monthOK(value)) throw new Error('Informe um mês válido.');
    return value;
  }

  function add(data, table, details) {
    const row = { id: data.counters[table]++, created_at: now(), ...details };
    if (table !== 'bill_payments') row.active = 1;
    data[table].push(row);
    return row;
  }

  function findActive(data, table, id) {
    const item = active(data[table]).find(row => String(row.id) === id);
    if (!item) throw new Error('Registro não encontrado.');
    return item;
  }

  function log(data, kind, itemId, label, value, date, note, remaining = null) {
    return add(data, 'transactions', {
      kind, item_id: itemId, label, amount: value, happened_on: date,
      period: date.slice(0, 7), note, remaining_after: remaining
    });
  }

  const fields = {
    incomes: body => ({
      description: field(body.description, 120, true), amount: amount(body.amount),
      received_on: day(body.received_on), note: field(body.note, 500)
    }),
    bills: body => ({
      name: field(body.name, 120, true), category: field(body.category, 40) || 'Outros',
      expected_amount: amount(body.expected_amount), due_day: integer(body.due_day, 1, 31),
      started_month: body.started_month == null || body.started_month === '' ? null : month(body.started_month)
    }),
    installments: body => {
      const total = integer(body.total, 1, 65535);
      return {
        name: field(body.name, 120, true), store: field(body.store, 120),
        amount: amount(body.amount), total, paid: integer(body.paid ?? 0, 0, total),
        started_month: month(body.started_month)
      };
    },
    debts: body => {
      const original = amount(body.original_amount);
      const balance = amount(body.balance ?? original, 0);
      if (balance > original) throw new Error('O saldo não pode ultrapassar o valor original da dívida.');
      return {
        name: field(body.name, 120, true), creditor: field(body.creditor, 120),
        original_amount: original, balance, monthly_payment: amount(body.monthly_payment || 0, 0),
        due_day: body.due_day ? integer(body.due_day, 1, 31) : null, note: field(body.note, 500)
      };
    },
    bill_payments: body => {
      const date = day(body.paid_on);
      if (body.period !== date.slice(0, 7)) throw new Error('Mês do pagamento inválido.');
      return {
        bill_id: integer(body.bill_id, 1, Number.MAX_SAFE_INTEGER), amount: amount(body.amount),
        period: body.period, paid_on: date, note: field(body.note, 500)
      };
    },
    transactions: body => {
      const date = day(body.happened_on);
      if (!['income', ...paymentKinds].includes(body.kind) || body.period !== date.slice(0, 7)) {
        throw new Error('Movimentação inválida.');
      }
      return {
        kind: body.kind, item_id: body.item_id == null ? null : integer(body.item_id, 1, Number.MAX_SAFE_INTEGER),
        label: field(body.label, 180, true), amount: amount(body.amount), happened_on: date,
        period: body.period, note: field(body.note, 500),
        remaining_after: body.remaining_after == null ? null : amount(body.remaining_after, 0)
      };
    }
  };

  function restoreBackup(body) {
    if (body?.version !== 1 || !body.data || typeof body.data !== 'object') {
      throw new Error('Arquivo de backup inválido.');
    }
    const restored = empty();
    try {
      for (const [name, table] of Object.entries(backupTables)) {
        const rows = body.data[name];
        if (!Array.isArray(rows) || rows.length > 20000) throw new Error();
        const ids = new Set();
        for (const source of rows) {
          if (!source || typeof source !== 'object' || Array.isArray(source)) throw new Error();
          const id = integer(source.id, 1, Number.MAX_SAFE_INTEGER - 1);
          if (ids.has(id)) throw new Error();
          ids.add(id);
          const createdAt = source.created_at == null ? defaultCreatedAt(source) : normalizeTimestamp(source.created_at);
          const row = { id, ...fields[table](source), created_at: createdAt };
          if (table !== 'bill_payments') {
            row.active = source.active == null ? 1 : integer(Number(source.active), 0, 1);
          }
          if (table === 'debts') row.starting_balance = amount(source.starting_balance ?? row.balance, 0);
          restored[table].push(row);
          restored.counters[table] = Math.max(restored.counters[table], id + 1);
        }
      }
      const billIds = new Set(restored.bills.map(row => row.id));
      const paidPeriods = new Set();
      for (const payment of restored.bill_payments) {
        const key = payment.bill_id + ':' + payment.period;
        if (!billIds.has(payment.bill_id) || paidPeriods.has(key)) throw new Error();
        paidPeriods.add(key);
      }
    } catch {
      throw new Error('Arquivo de backup inválido ou com registros incompatíveis.');
    }
    return restored;
  }

  function normalizeTimestamp(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z)?$/.test(value)) {
      throw new Error('Data de criação inválida.');
    }
    day(value.slice(0, 10));
    const time = value.slice(11, 19);
    if (time.slice(0, 2) > '23' || time.slice(3, 5) > '59' || time.slice(6, 8) > '59') {
      throw new Error('Data de criação inválida.');
    }
    return value.slice(0, 10) + ' ' + time;
  }

  function defaultCreatedAt(row) {
    const knownDate = row.created_on || row.received_on || row.paid_on || row.happened_on;
    return knownDate ? day(knownDate) + ' 12:00:00' : now();
  }

  function exportBackup(data) {
    const backup = Object.fromEntries(Object.entries(backupTables).map(([name, table]) => [
      name, data[table].map(row => ({
        ...row,
        created_at: row.created_at || defaultCreatedAt(row),
        ...(table === 'debts' ? { monthly_payment: Number(row.monthly_payment || 0) } : {}),
        ...(table === 'bills' ? { started_month: row.started_month ?? null } : {})
      }))
    ]));
    return { version: 1, exportedAt: new Date().toISOString(), data: backup };
  }

  function save(data, collection, body, id) {
    const item = id ? findActive(data, collection, id) : null;
    const values = fields[collection](body);
    if (collection === 'bills' && item && body.started_month === undefined) {
      values.started_month = item.started_month ?? null;
    }
    if (collection === 'debts') {
      const historicalPaid = item ? sum(active(data.transactions).filter(row => (
        row.kind === 'debt' && String(row.item_id) === id
      )), 'amount') : 0;
      values.starting_balance = amount(round(values.balance + historicalPaid), 0);
    }
    const saved = item ? Object.assign(item, values) : add(data, collection, values);
    if (collection === 'incomes') {
      const entry = active(data.transactions).find(row => row.kind === 'income' && row.item_id === saved.id);
      if (entry) {
        Object.assign(entry, {
          label: saved.description, amount: saved.amount, happened_on: saved.received_on,
          period: saved.received_on.slice(0, 7), note: saved.note
        });
      } else {
        log(data, 'income', saved.id, saved.description, saved.amount, saved.received_on, saved.note);
      }
    }
    return { id: saved.id, ok: true };
  }

  function pay(data, collection, id, body) {
    const item = findActive(data, collection, id);
    const date = day(body.paid_on || now().slice(0, 10));
    const note = field(body.note, 500);
    if (collection === 'bills') {
      const value = amount(body.amount);
      const period = date.slice(0, 7);
      if (data.bill_payments.some(row => row.bill_id === item.id && row.period === period)) {
        throw new Error('Esta conta já foi paga neste mês.');
      }
      add(data, 'bill_payments', { bill_id: item.id, period, amount: value, paid_on: date, note });
      log(data, 'bill', item.id, item.name, value, date, note);
      return { ok: true };
    }
    if (collection === 'installments') {
      if (item.paid >= item.total) throw new Error('Todas as parcelas já foram pagas.');
      item.paid += 1;
      item.active = item.paid < item.total ? 1 : 0;
      log(data, 'installment', item.id, item.name + ' — parcela ' + item.paid + '/' + item.total,
        item.amount, date, note);
      return { paid: item.paid, total: item.total };
    }
    if (collection === 'debts') {
      const value = amount(body.amount);
      if (value > item.balance) throw new Error('O abatimento não pode passar do saldo atual.');
      item.balance = round(item.balance - value);
      log(data, 'debt', item.id, item.name, value, date, note, item.balance);
      return { remaining: item.balance };
    }
    throw new Error('Este registro não aceita pagamentos.');
  }

  function debtTrend(debts, history, selectedMonth) {
    const debtPayments = new Map();
    for (const record of history) {
      if (record.kind !== 'debt') continue;
      const id = String(record.item_id);
      if (!debtPayments.has(id)) debtPayments.set(id, []);
      debtPayments.get(id).push(record);
    }
    const end = new Date(selectedMonth + '-01T12:00:00Z');
    return Array.from({ length: 12 }, (_, index) => {
      const date = new Date(end);
      date.setUTCMonth(date.getUTCMonth() - 11 + index);
      const period = date.toISOString().slice(0, 7);
      const balance = debts.reduce((total, debt) => {
        const createdMonth = (debt.created_at || debt.created_on || now()).slice(0, 7);
        if (createdMonth > period) return total;
        const payments = debtPayments.get(String(debt.id)) || [];
        const paid = sum(payments.filter(payment => payment.period <= period), 'amount');
        return total + Math.max(0, Number(debt.starting_balance ?? debt.balance) - paid);
      }, 0);
      return { month: period, balance: round(balance) };
    });
  }

  function dashboard(data, period) {
    const incomes = active(data.incomes).filter(row => row.received_on.slice(0, 7) === period).sort(recentFirst('received_on'));
    const paid = new Map(data.bill_payments.filter(row => row.period === period).map(row => [String(row.bill_id), row]));
    const bills = active(data.bills)
      .filter(bill => bill.started_month == null || bill.started_month <= period)
      .map(bill => {
        const payment = paid.get(String(bill.id));
        return {
          ...bill, started_month: bill.started_month ?? null,
          payment_id: payment?.id ?? null, paid_amount: payment?.amount ?? null, paid_on: payment?.paid_on ?? null
        };
      })
      .sort((a, b) => a.due_day - b.due_day || a.name.localeCompare(b.name));
    const installments = active(data.installments).filter(row => (
      row.paid < row.total && row.started_month <= period
    )).sort((a, b) => a.name.localeCompare(b.name));
    const debts = active(data.debts).sort((a, b) => b.balance - a.balance || a.name.localeCompare(b.name));
    const allHistory = active(data.transactions);
    const monthlyHistory = allHistory.filter(row => row.period === period).sort(recentFirst('happened_on'));
    const income = sum(incomes, 'amount');
    const billTotal = sum(bills, 'expected_amount');
    const installmentTotal = sum(installments, 'amount');
    const debtPayments = sum(debts.filter(debt => debt.balance > 0), 'monthly_payment');
    return {
      month: period, income, openBills: sum(bills.filter(bill => bill.payment_id === null), 'expected_amount'),
      installmentTotal, debtPayments, debtTotal: sum(debts, 'balance'), billTotal,
      available: round(income - billTotal - installmentTotal - debtPayments),
      paidThisMonth: sum(monthlyHistory.filter(row => paymentKinds.includes(row.kind)), 'amount'),
      debtTrend: debtTrend(debts, allHistory, period), bills, incomes, installments, debts,
      history: monthlyHistory.slice(0, 100)
    };
  }

  async function dispatch(url, options = {}) {
    const parsed = new URL(url, location.href);
    const method = (options.method || 'GET').toUpperCase();
    const [, collection, id, action] = parsed.pathname.split('/').filter(Boolean);
    const body = options.body ? JSON.parse(options.body) : {};
    const period = parsed.searchParams.get('month');

    if (method === 'GET') {
      if (collection === 'auth' && id === 'status') return { setupRequired: false, authenticated: true, username: 'Neste aparelho' };
      if (collection === 'health') return withData(false, () => ({ ok: true, database: 'local-device' }));
      if (collection === 'dashboard') return withData(false, data => dashboard(data, month(period || now().slice(0, 7))));
      if (collection === 'backup') return withData(false, exportBackup);
      if (collection === 'transactions') return withData(false, data => active(data.transactions)
        .filter(row => !period || row.period === month(period)).sort(recentFirst('happened_on')).slice(0, 500));
      if (collections.includes(collection)) return withData(false, data => active(data[collection]));
    }

    if (method === 'POST' && collection === 'auth' && id === 'logout') return { ok: true };
    if (method === 'POST' && collection === 'backup' && id === 'restore') {
      const restored = restoreBackup(body);
      return withData(true, data => {
        Object.assign(data, restored);
        return { ok: true };
      });
    }

    if (collections.includes(collection)) {
      if (method === 'POST' && id && action === 'payments') return withData(true, data => pay(data, collection, id, body));
      if ((method === 'POST' && !id) || (method === 'PATCH' && id && !action)) {
        return withData(true, data => save(data, collection, body, id));
      }
      if (method === 'DELETE' && id && !action) {
        return withData(true, data => {
          const row = findActive(data, collection, id);
          row.active = 0;
          if (collection === 'incomes') {
            for (const entry of data.transactions) {
              if (entry.kind === 'income' && String(entry.item_id) === id) entry.active = 0;
            }
          }
          return { ok: true };
        });
      }
    }

    throw new Error('Ação não disponível no modo local.');
  }

  window.localFinance = { dispatch, isLocal: document.documentElement.dataset.storage === 'local' };
})();
