require('dotenv').config();
const express = require('express');
const calculateMonthlyBudget = require('./public/monthly-budget');
const mysql = require('mysql2/promise');
const path = require('node:path');
const { randomBytes, createHash, scrypt: scryptCallback, timingSafeEqual } = require('node:crypto');
const { promisify } = require('node:util');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '10mb' }));
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'meu_financeiro',
  waitForConnections: true,
  connectionLimit: 8,
  decimalNumbers: true,
  dateStrings: true
});

const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const monthOK = value => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value || ''));
const billMonthOK = value => value == null || value === '' || (typeof value === 'string' && monthOK(value));
const billFrequencyOK = value => value === undefined || [0, 1, '0', '1', false, true].includes(value);
const positive = value => Number.isFinite(Number(value)) && Number(value) > 0;
const dateOK = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
const scrypt = promisify(scryptCallback);
const cookieName = 'mf_session';
const sessionDurationMs = 7 * 24 * 60 * 60 * 1000;
const loginAttempts = new Map();
const hashToken = token => createHash('sha256').update(token).digest('hex');

let billSchemaReady;
function ensureBillSchema() {
  if (!billSchemaReady) {
    billSchemaReady = (async () => {
      const [columns] = await pool.query("SHOW COLUMNS FROM bills WHERE Field IN ('started_month', 'recurring')");
      const additions = [
        ['started_month', 'ALTER TABLE bills ADD COLUMN started_month CHAR(7) NULL DEFAULT NULL'],
        ['recurring', 'ALTER TABLE bills ADD COLUMN recurring TINYINT UNSIGNED NOT NULL DEFAULT 1']
      ];
      for (const [name, sql] of additions) {
        if (columns.some(column => column.Field === name)) continue;
        try {
          await pool.query(sql);
        } catch (error) {
          // Another instance may have updated the schema after the column check.
          if (error.code !== 'ER_DUP_FIELDNAME') throw error;
        }
      }
    })().catch(error => {
      billSchemaReady = undefined;
      throw error;
    });
  }
  return billSchemaReady;
}

function readCookie(req, name) {
  const cookie = (req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith(`${name}=`));
  return cookie ? decodeURIComponent(cookie.slice(name.length + 1)) : '';
}
function issueCookie(res, token) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${cookieName}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${sessionDurationMs / 1000}${secure}`);
}
function clearCookie(res) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${cookieName}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`);
}
async function createSession(userId, res) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + sessionDurationMs);
  await pool.query('INSERT INTO app_sessions (token_hash,user_id,expires_at) VALUES (?,?,?)', [hashToken(token), userId, expiresAt]);
  issueCookie(res, token);
}

app.get('/api/auth/status', asyncRoute(async (req, res) => {
  const [[users], [sessions]] = await Promise.all([
    pool.query('SELECT COUNT(*) AS total FROM app_users'),
    pool.query(`SELECT u.id,u.username FROM app_sessions s JOIN app_users u ON u.id=s.user_id
      WHERE s.token_hash=? AND s.expires_at>NOW() LIMIT 1`, [hashToken(readCookie(req, cookieName))])
  ]);
  res.json({ setupRequired: Number(users[0].total) === 0, authenticated: sessions.length > 0, username: sessions[0]?.username || null });
}));

app.post('/api/auth/setup', asyncRoute(async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  if (username.length < 3 || username.length > 80 || password.length < 12 || password.length > 200) return res.status(400).json({ error: 'Use um usuário com 3 a 80 caracteres e uma senha com pelo menos 12 caracteres.' });
  const [[rows]] = await Promise.all([pool.query('SELECT COUNT(*) AS total FROM app_users')]);
  if (Number(rows[0].total) > 0) return res.status(409).json({ error: 'A configuração inicial já foi concluída. Entre com seu usuário.' });
  const salt = randomBytes(16);
  const passwordHash = await scrypt(password, salt, 64);
  const [result] = await pool.query('INSERT INTO app_users (username,password_salt,password_hash) VALUES (?,?,?)', [username, salt, passwordHash]);
  await createSession(result.insertId, res);
  res.status(201).json({ ok: true });
}));

app.post('/api/auth/login', asyncRoute(async (req, res) => {
  const key = req.ip || 'local';
  const attempts = loginAttempts.get(key) || { count: 0, first: Date.now() };
  if (Date.now() - attempts.first > 15 * 60 * 1000) { attempts.count = 0; attempts.first = Date.now(); }
  if (attempts.count >= 8) return res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' });
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const [users] = await pool.query('SELECT * FROM app_users WHERE username=? LIMIT 1', [username]);
  let valid = false;
  if (users.length && password.length <= 200) {
    const candidate = await scrypt(password, users[0].password_salt, 64);
    valid = timingSafeEqual(candidate, users[0].password_hash);
  }
  if (!valid) {
    attempts.count++;
    loginAttempts.set(key, attempts);
    return res.status(401).json({ error: 'Usuário ou senha incorretos.' });
  }
  loginAttempts.delete(key);
  await createSession(users[0].id, res);
  res.json({ ok: true });
}));

app.post('/api/auth/logout', asyncRoute(async (req, res) => {
  const token = readCookie(req, cookieName);
  if (token) await pool.query('DELETE FROM app_sessions WHERE token_hash=?', [hashToken(token)]);
  clearCookie(res);
  res.json({ ok: true });
}));

app.use('/api', asyncRoute(async (req, res, next) => {
  if (req.path === '/health' || req.path.startsWith('/auth/')) return next();
  const token = readCookie(req, cookieName);
  if (!token) return res.status(401).json({ error: 'Entre para acessar seus dados.' });
  const [sessions] = await pool.query(`SELECT u.id,u.username FROM app_sessions s JOIN app_users u ON u.id=s.user_id
    WHERE s.token_hash=? AND s.expires_at>NOW() LIMIT 1`, [hashToken(token)]);
  if (!sessions.length) { clearCookie(res); return res.status(401).json({ error: 'Sua sessão expirou. Entre novamente.' }); }
  await ensureBillSchema();
  req.user = sessions[0];
  next();
}));

app.get('/api/health', asyncRoute(async (_req, res) => {
  await pool.query('SELECT 1');
  await ensureBillSchema();
  res.json({ ok: true, database: 'connected', monthlyBudget: true });
}));

app.get('/api/dashboard', asyncRoute(async (req, res) => {
  const month = req.query.month || new Date().toISOString().slice(0, 7);
  if (!monthOK(month)) return res.status(400).json({ error: 'Mês inválido. Use AAAA-MM.' });
  const lastDay = new Date(Number(month.slice(0,4)), Number(month.slice(5,7)), 0).toISOString().slice(0,10);
  const [[incomeRows], [billRows], [installmentRows], [debtRows], [paymentRows], [historyRows], [debtOrigins], [debtEvents]] = await Promise.all([
    pool.query('SELECT COALESCE(SUM(amount),0) AS total FROM incomes WHERE active=1 AND DATE_FORMAT(received_on, "%Y-%m") = ?', [month]),
    pool.query(`SELECT b.*, bp.id AS payment_id, bp.amount AS paid_amount, bp.paid_on
      FROM bills b LEFT JOIN bill_payments bp ON bp.bill_id=b.id AND bp.period=?
      WHERE b.active=1 AND (b.started_month IS NULL OR b.started_month<=?)
        AND (b.recurring=1 OR NOT EXISTS (
          SELECT 1 FROM bill_payments previous
          WHERE previous.bill_id=b.id AND previous.period<?
        ))
      ORDER BY b.due_day, b.name`, [month, month, month]),
    pool.query(`SELECT * FROM installments WHERE active=1 AND paid<total AND started_month<=? ORDER BY name`, [month]),
    pool.query('SELECT * FROM debts WHERE active=1 ORDER BY balance DESC, name'),
    pool.query(`SELECT kind,item_id,SUM(amount) AS amount FROM transactions
      WHERE active=1 AND period=? AND kind IN ('bill','installment','debt') GROUP BY kind,item_id`, [month]),
    pool.query('SELECT * FROM transactions WHERE active=1 AND period=? ORDER BY happened_on DESC, id DESC LIMIT 100', [month]),
    pool.query('SELECT id,starting_balance,DATE(created_at) AS created_on FROM debts WHERE active=1'),
    pool.query('SELECT item_id,amount,remaining_after,happened_on FROM transactions WHERE active=1 AND kind=\'debt\' AND happened_on<=? ORDER BY happened_on,id', [lastDay])
  ]);
  const [incomes] = await pool.query('SELECT * FROM incomes WHERE active=1 AND DATE_FORMAT(received_on, "%Y-%m")=? ORDER BY received_on DESC, id DESC', [month]);
  const income = Number(incomeRows[0].total);
  const budget = calculateMonthlyBudget({
    month, income, bills: billRows, installments: installmentRows, debts: debtRows, payments: paymentRows
  });
  const trendMonths = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(`${month}-01T12:00:00`); d.setMonth(d.getMonth() - i);
    trendMonths.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`);
  }
  const debtTrend = trendMonths.map(period => {
    const cutoff = new Date(Number(period.slice(0,4)), Number(period.slice(5,7)), 0).toISOString().slice(0,10);
    let total = 0;
    for (const debt of debtOrigins) {
      if (String(debt.created_on).slice(0,10) > cutoff) continue;
      let remaining = Number(debt.starting_balance);
      for (const payment of debtEvents) {
        if (String(payment.item_id) !== String(debt.id) || String(payment.happened_on).slice(0,10) > cutoff) continue;
        remaining = payment.remaining_after === null ? remaining - Number(payment.amount) : Number(payment.remaining_after);
      }
      total += Math.max(0, remaining);
    }
    return { month: period, balance: Number(total.toFixed(2)) };
  });
  res.json({ month, income, ...budget, debtTrend, bills: billRows,
    incomes, installments: installmentRows, debts: debtRows, history: historyRows });
}));

app.get('/api/incomes', asyncRoute(async (_req, res) => {
  const [rows] = await pool.query('SELECT * FROM incomes WHERE active=1 ORDER BY received_on DESC, id DESC');
  res.json(rows);
}));
app.post('/api/incomes', asyncRoute(async (req, res) => {
  const { description, amount, received_on, note = null } = req.body;
  if (!String(description || '').trim() || !positive(amount) || !dateOK(received_on)) return res.status(400).json({ error: 'Informe descrição, valor positivo e data válida.' });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.query('INSERT INTO incomes (description, amount, received_on, note) VALUES (?,?,?,?)', [String(description).trim(), amount, received_on, note]);
    await conn.query('INSERT INTO transactions (kind,item_id,label,amount,happened_on,period,note) VALUES (\'income\',?,?,?,?,?,?)', [result.insertId, String(description).trim(), amount, received_on, received_on.slice(0, 7), note]);
    await conn.commit();
    res.status(201).json({ id: result.insertId });
  } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
}));

app.patch('/api/incomes/:id', asyncRoute(async (req, res) => {
  const { description, amount, received_on, note = null } = req.body;
  if (!String(description || '').trim() || !positive(amount) || !dateOK(received_on)) return res.status(400).json({ error: 'Informe descrição, valor positivo e data válida.' });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.query('UPDATE incomes SET description=?,amount=?,received_on=?,note=? WHERE id=? AND active=1', [String(description).trim(), amount, received_on, note, req.params.id]);
    if (!result.affectedRows) { await conn.rollback(); return res.status(404).json({ error: 'Renda não encontrada.' }); }
    await conn.query('UPDATE transactions SET label=?,amount=?,happened_on=?,period=?,note=? WHERE kind=\'income\' AND item_id=? AND active=1', [String(description).trim(), amount, received_on, received_on.slice(0,7), note, req.params.id]);
    await conn.commit(); res.json({ ok: true });
  } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
}));

app.delete('/api/incomes/:id', asyncRoute(async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.query('UPDATE incomes SET active=0 WHERE id=? AND active=1', [req.params.id]);
    if (!result.affectedRows) { await conn.rollback(); return res.status(404).json({ error: 'Renda não encontrada.' }); }
    await conn.query('UPDATE transactions SET active=0 WHERE kind=\'income\' AND item_id=?', [req.params.id]);
    await conn.commit(); res.json({ ok: true });
  } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
}));

app.post('/api/bills', asyncRoute(async (req, res) => {
  const { name, category = 'Outros', expected_amount, due_day, started_month, recurring = 1 } = req.body;
  if (!String(name || '').trim() || !positive(expected_amount) || !Number.isInteger(Number(due_day)) || due_day < 1 || due_day > 31) return res.status(400).json({ error: 'Confira o nome, valor e dia de vencimento.' });
  if (!billMonthOK(started_month)) return res.status(400).json({ error: 'Mês de início inválido. Use AAAA-MM.' });
  if (!billFrequencyOK(recurring)) return res.status(400).json({ error: 'Escolha se a conta é mensal ou avulsa.' });
  const [result] = await pool.query('INSERT INTO bills (name, category, expected_amount, due_day, started_month, recurring) VALUES (?,?,?,?,?,?)',
    [String(name).trim(), category, expected_amount, due_day, started_month || null, Number(recurring)]);
  res.status(201).json({ id: result.insertId });
}));

async function hasBillPayment(connection, billId) {
  const [payments] = await connection.query('SELECT id FROM bill_payments WHERE bill_id=? LIMIT 1 FOR UPDATE', [billId]);
  return payments.length > 0;
}

app.patch('/api/bills/:id', asyncRoute(async (req, res) => {
  const { name, category = 'Outros', expected_amount, due_day, started_month, recurring } = req.body;
  if (!String(name || '').trim() || !positive(expected_amount) || !Number.isInteger(Number(due_day)) || due_day < 1 || due_day > 31) return res.status(400).json({ error: 'Confira o nome, valor e dia de vencimento.' });
  if (!billMonthOK(started_month)) return res.status(400).json({ error: 'Mês de início inválido. Use AAAA-MM.' });
  if (!billFrequencyOK(recurring)) return res.status(400).json({ error: 'Escolha se a conta é mensal ou avulsa.' });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[bill]] = await connection.query('SELECT id,recurring FROM bills WHERE id=? AND active=1 FOR UPDATE', [req.params.id]);
    if (!bill) {
      await connection.rollback();
      return res.status(404).json({ error: 'Conta não encontrada.' });
    }
    const currentFrequency = Number(bill.recurring);
    const nextFrequency = recurring === undefined ? currentFrequency : Number(recurring);
    if (nextFrequency !== currentFrequency && await hasBillPayment(connection, bill.id)) {
      await connection.rollback();
      return res.status(409).json({ error: 'A frequência de uma conta com pagamentos registrados não pode ser alterada.' });
    }
    await connection.query(`UPDATE bills SET name=?,category=?,expected_amount=?,due_day=?,
      started_month=IF(?, ?, started_month),recurring=? WHERE id=?`,
      [String(name).trim(), category, expected_amount, due_day, started_month !== undefined, started_month || null, nextFrequency, bill.id]);
    await connection.commit();
    res.json({ ok: true });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}));

app.delete('/api/bills/:id', asyncRoute(async (req, res) => {
  const [result] = await pool.query('UPDATE bills SET active=0 WHERE id=? AND active=1', [req.params.id]);
  if (!result.affectedRows) return res.status(404).json({ error: 'Conta não encontrada.' });
  res.json({ ok: true });
}));

app.post('/api/bills/:id/payments', asyncRoute(async (req, res) => {
  const { amount, paid_on, note = null } = req.body;
  const period = String(paid_on || '').slice(0, 7);
  if (!positive(amount) || !dateOK(paid_on) || !monthOK(period)) return res.status(400).json({ error: 'Informe valor e data válidos.' });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[bill]] = await connection.query('SELECT id,name,recurring FROM bills WHERE id=? AND active=1 FOR UPDATE', [req.params.id]);
    if (!bill) {
      await connection.rollback();
      return res.status(404).json({ error: 'Conta não encontrada.' });
    }
    if (Number(bill.recurring) === 0 && await hasBillPayment(connection, bill.id)) {
      await connection.rollback();
      return res.status(409).json({ error: 'Esta conta avulsa já foi quitada.' });
    }
    await connection.query('INSERT INTO bill_payments (bill_id,period,amount,paid_on,note) VALUES (?,?,?,?,?)', [bill.id, period, amount, paid_on, note]);
    await connection.query('INSERT INTO transactions (kind,item_id,label,amount,happened_on,period,note) VALUES (\'bill\',?,?,?,?,?,?)', [bill.id, bill.name, amount, paid_on, period, note]);
    await connection.commit();
    res.status(201).json({ ok: true });
  } catch (error) {
    await connection.rollback();
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Esta conta já foi paga neste mês.' });
    throw error;
  } finally {
    connection.release();
  }
}));

app.post('/api/installments', asyncRoute(async (req, res) => {
  const { name, store = null, amount, total, paid = 0, started_month } = req.body;
  if (!String(name || '').trim() || !positive(amount) || !Number.isInteger(Number(total)) || total < 1 || !Number.isInteger(Number(paid)) || paid < 0 || paid > total || !monthOK(started_month)) return res.status(400).json({ error: 'Confira compra, valor, quantidade de parcelas e mês inicial.' });
  const [result] = await pool.query('INSERT INTO installments (name,store,amount,total,paid,started_month) VALUES (?,?,?,?,?,?)', [String(name).trim(), store, amount, total, paid, started_month]);
  res.status(201).json({ id: result.insertId });
}));

app.patch('/api/installments/:id', asyncRoute(async (req, res) => {
  const { name, store = null, amount, total, paid, started_month } = req.body;
  if (!String(name || '').trim() || !positive(amount) || !Number.isInteger(Number(total)) || total < 1 || !Number.isInteger(Number(paid)) || paid < 0 || paid > total || !monthOK(started_month)) return res.status(400).json({ error: 'Confira compra, valor, quantidade de parcelas e mês inicial.' });
  const [result] = await pool.query('UPDATE installments SET name=?,store=?,amount=?,total=?,paid=?,started_month=?,active=? WHERE id=?', [String(name).trim(), store, amount, total, paid, started_month, paid < total, req.params.id]);
  if (!result.affectedRows) return res.status(404).json({ error: 'Compra não encontrada.' });
  res.json({ ok: true });
}));

app.delete('/api/installments/:id', asyncRoute(async (req, res) => {
  const [result] = await pool.query('UPDATE installments SET active=0 WHERE id=? AND active=1', [req.params.id]);
  if (!result.affectedRows) return res.status(404).json({ error: 'Compra parcelada não encontrada ou já quitada.' });
  res.json({ ok: true });
}));

app.post('/api/installments/:id/payments', asyncRoute(async (req, res) => {
  const { paid_on = new Date().toISOString().slice(0, 10), note = null } = req.body;
  if (!dateOK(paid_on)) return res.status(400).json({ error: 'Data inválida.' });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query('SELECT * FROM installments WHERE id=? FOR UPDATE', [req.params.id]);
    if (!rows.length) { await conn.rollback(); return res.status(404).json({ error: 'Compra não encontrada.' }); }
    const item = rows[0];
    if (item.paid >= item.total) { await conn.rollback(); return res.status(409).json({ error: 'Todas as parcelas já foram pagas.' }); }
    const nextPaid = Number(item.paid) + 1;
    const period = paid_on.slice(0, 7);
    await conn.query('UPDATE installments SET paid=?, active=? WHERE id=?', [nextPaid, nextPaid < item.total, item.id]);
    await conn.query('INSERT INTO transactions (kind,item_id,label,amount,happened_on,period,note) VALUES (\'installment\',?,?,?,?,?,?)', [item.id, `${item.name} — parcela ${nextPaid}/${item.total}`, item.amount, paid_on, period, note]);
    await conn.commit();
    res.status(201).json({ paid: nextPaid, total: Number(item.total) });
  } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
}));

function debtValues(body) {
  const { creditor = null, note = null } = body;
  const name = String(body.name || '').trim();
  const original = Number(body.original_amount);
  const balance = body.balance === '' || body.balance == null ? original : Number(body.balance);
  const monthly = Number(body.monthly_payment ?? 0);
  const dueDay = body.due_day === '' || body.due_day == null ? null : Number(body.due_day);
  if (!name || !positive(original) || !Number.isFinite(balance) || balance < 0 || balance > original ||
      !Number.isFinite(monthly) || monthly < 0 ||
      (dueDay !== null && (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31))) return null;
  return { name, creditor, original, balance, monthly, dueDay, note };
}

app.post('/api/debts', asyncRoute(async (req, res) => {
  const debt = debtValues(req.body);
  if (!debt) return res.status(400).json({ error: 'Confira o nome, os valores e o dia de vencimento da dívida.' });
  const { name, creditor, original, balance, monthly, dueDay, note } = debt;
  const [result] = await pool.query('INSERT INTO debts (name,creditor,original_amount,starting_balance,balance,monthly_payment,due_day,note) VALUES (?,?,?,?,?,?,?,?)', [name, creditor, original, balance, balance, monthly, dueDay, note]);
  res.status(201).json({ id: result.insertId });
}));

app.patch('/api/debts/:id', asyncRoute(async (req, res) => {
  const debt = debtValues(req.body);
  if (!debt) return res.status(400).json({ error: 'Confira o nome, os valores e o dia de vencimento da dívida.' });
  const { name, creditor, original, balance, monthly, dueDay, note } = debt;
  const [result] = await pool.query('UPDATE debts SET name=?,creditor=?,original_amount=?,balance=?,monthly_payment=?,due_day=?,note=? WHERE id=? AND active=1', [name, creditor, original, balance, monthly, dueDay, note, req.params.id]);
  if (!result.affectedRows) return res.status(404).json({ error: 'Dívida não encontrada.' });
  res.json({ ok: true });
}));

app.delete('/api/debts/:id', asyncRoute(async (req, res) => {
  const [result] = await pool.query('UPDATE debts SET active=0 WHERE id=? AND active=1', [req.params.id]);
  if (!result.affectedRows) return res.status(404).json({ error: 'Dívida não encontrada.' });
  res.json({ ok: true });
}));

app.post('/api/debts/:id/payments', asyncRoute(async (req, res) => {
  const { amount, paid_on = new Date().toISOString().slice(0, 10), note = null } = req.body;
  if (!positive(amount) || !dateOK(paid_on)) return res.status(400).json({ error: 'Informe valor e data válidos.' });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query('SELECT * FROM debts WHERE id=? FOR UPDATE', [req.params.id]);
    if (!rows.length) { await conn.rollback(); return res.status(404).json({ error: 'Dívida não encontrada.' }); }
    const debt = rows[0];
    if (Number(amount) > Number(debt.balance)) { await conn.rollback(); return res.status(400).json({ error: 'O abatimento não pode passar do saldo atual.' }); }
    const remaining = Number((Number(debt.balance) - Number(amount)).toFixed(2));
    const period = paid_on.slice(0, 7);
    await conn.query('UPDATE debts SET balance=? WHERE id=?', [remaining, debt.id]);
    await conn.query('INSERT INTO transactions (kind,item_id,label,amount,happened_on,period,note,remaining_after) VALUES (\'debt\',?,?,?,?,?,?,?)', [debt.id, debt.name, amount, paid_on, period, note, remaining]);
    await conn.commit();
    res.status(201).json({ remaining });
  } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
}));

app.get('/api/transactions', asyncRoute(async (req, res) => {
  const period = req.query.month;
  if (period && !monthOK(period)) return res.status(400).json({ error: 'Mês inválido. Use AAAA-MM.' });
  const [rows] = await pool.query(`SELECT * FROM transactions WHERE active=1 ${period ? 'AND period=?' : ''} ORDER BY happened_on DESC, id DESC LIMIT 500`, period ? [period] : []);
  res.json(rows);
}));

app.get('/api/backup', asyncRoute(async (_req, res) => {
  const [incomes, bills, billPayments, installments, debts, transactions] = await Promise.all([
    pool.query('SELECT * FROM incomes ORDER BY id'),
    pool.query('SELECT * FROM bills ORDER BY id'),
    pool.query('SELECT * FROM bill_payments ORDER BY id'),
    pool.query('SELECT * FROM installments ORDER BY id'),
    pool.query('SELECT * FROM debts ORDER BY id'),
    pool.query('SELECT * FROM transactions ORDER BY id')
  ]);
  res.json({ version: 1, exportedAt: new Date().toISOString(), data: {
    incomes: incomes[0], bills: bills[0], billPayments: billPayments[0],
    installments: installments[0], debts: debts[0], transactions: transactions[0]
  }});
}));

app.post('/api/backup/restore', asyncRoute(async (req, res) => {
  const data = req.body?.data;
  const requiredCollections = ['incomes','bills','billPayments','installments','debts','transactions'];
  if (req.body?.version !== 1 || !data || requiredCollections.some(key => !Array.isArray(data[key])) || requiredCollections.some(key => data[key].length > 20000)) {
    return res.status(400).json({ error: 'Arquivo de backup inválido ou grande demais.' });
  }
  if (data.bills.some(bill => !bill || typeof bill !== 'object' || !billMonthOK(bill.started_month))) {
    return res.status(400).json({ error: 'O backup contém uma conta com mês de início inválido.' });
  }
  if (data.bills.some(bill => !billFrequencyOK(bill.recurring))) {
    return res.status(400).json({ error: 'O backup contém uma conta com frequência inválida.' });
  }
  const bills = data.bills.map(bill => ({
    ...bill, started_month: bill.started_month || null, recurring: Number(bill.recurring ?? 1)
  }));
  const oneTimeBillIds = new Set(bills.filter(bill => bill.recurring === 0).map(bill => String(bill.id)));
  const paidOneTimeBillIds = new Set();
  for (const payment of data.billPayments) {
    const billId = String(payment?.bill_id);
    if (!oneTimeBillIds.has(billId)) continue;
    if (paidOneTimeBillIds.has(billId)) {
      return res.status(400).json({ error: 'O backup contém mais de um pagamento para uma conta avulsa.' });
    }
    paidOneTimeBillIds.add(billId);
  }
  const connection = await pool.getConnection();
  const insertRows = async (table, columns, rows) => {
    const sql = `INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`;
    for (const row of rows) await connection.query(sql, columns.map(column => row[column] ?? null));
  };
  try {
    await connection.beginTransaction();
    await connection.query('DELETE FROM transactions');
    await connection.query('DELETE FROM bill_payments');
    await connection.query('DELETE FROM incomes');
    await connection.query('DELETE FROM installments');
    await connection.query('DELETE FROM debts');
    await connection.query('DELETE FROM bills');
    await insertRows('incomes',['id','description','amount','received_on','note','active','created_at'],data.incomes);
    await insertRows('bills',['id','name','category','expected_amount','due_day','started_month','recurring','active','created_at'],bills);
    await insertRows('bill_payments',['id','bill_id','period','amount','paid_on','note','created_at'],data.billPayments);
    await insertRows('installments',['id','name','store','amount','total','paid','started_month','active','created_at'],data.installments);
    await insertRows('debts',['id','name','creditor','original_amount','starting_balance','balance','monthly_payment','due_day','note','active','created_at'],data.debts);
    await insertRows('transactions',['id','kind','item_id','label','amount','happened_on','period','note','remaining_after','active','created_at'],data.transactions);
    await connection.commit();
    res.json({ ok: true });
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}));

app.use('/api', (err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Não foi possível concluir a operação. Confira a conexão com o MySQL.' });
});

const port = Number(process.env.PORT || 3000);
app.listen(port, '127.0.0.1', () => console.log(`Meu Financeiro disponível em http://localhost:${port}`));
