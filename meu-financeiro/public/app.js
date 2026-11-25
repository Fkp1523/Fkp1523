const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const money = value => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const localISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const dateForSelectedMonth = () => selectedMonth === currentMonth() ? localISO() : `${selectedMonth}-01`;
const fmtDate = value => value ? new Date(`${String(value).slice(0,10)}T12:00:00`).toLocaleDateString('pt-BR') : '—';
const monthLabel = value => new Date(`${value}-02T12:00:00`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
const icons = { 'Água':'💧', 'Luz':'☼', 'Energia':'☼', 'Internet':'⌁', 'Celular':'▯', 'Moradia':'⌂', 'Transporte':'↗', 'Saúde':'✚', 'Educação':'▤', 'Cartão':'▣' };
let selectedMonth = `${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,'0')}`;
let dashboard = null;
let dashboardRequest = 0;
let modal = null;
let toastTimer;
let needsFirstSetup = false;
let showPaidBills = false;

async function api(url, options = {}) {
  if (window.localFinance?.isLocal) return window.localFinance.dispatch(url, options);
  const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Não foi possível concluir.');
  return body;
}
function showError(message = '') { const banner = $('#errorBanner'); banner.textContent = message; banner.hidden = !message; }
function showToast(message) { const el = $('#toast'); el.textContent = message; el.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2500); }
function empty(message) { return `<div class="empty-state">${esc(message)}</div>`; }
function chooseMonth(month) {
  if (!/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(month)) {
    $('#monthSelect').value = selectedMonth;
    showToast('Escolha um mês válido ou use o formato AAAA-MM.');
    return;
  }
  if (month === selectedMonth) return;
  selectedMonth = month;
  showPaidBills = false;
  return loadDashboard();
}
function shiftedMonth(period, step) {
  const [year, month] = period.split('-').map(Number);
  const date = new Date(year, month - 1 + step, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}
function moveMonth(step) { return chooseMonth(shiftedMonth(selectedMonth, step)); }
function setPage(page) {
  const titles = { inicio: 'Visão geral', contas: 'Contas do mês', parcelas: 'Compras parceladas', dividas: 'Dívidas', historico: 'Histórico' };
  if (!titles[page]) return;
  $$('.page').forEach(el => el.classList.toggle('active', el.id === `page-${page}`));
  $$('[data-page]').forEach(el => el.classList.toggle('active', el.dataset.page === page));
  $('#pageTitle').textContent = titles[page];
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function drawDashboard(data) {
  $('#available').textContent = money(data.available);
  $('#incomeTotal').textContent = money(data.income);
  const paidBills = data.billTotal - data.openBills;
  const totalExpenses = data.billTotal + data.installmentTotal + data.debtPayments;
  const totals = { billTotal: data.billTotal, openBills: data.openBills, paidBills,
    debtTotal: data.debtTotal, debtPayments: data.debtPayments, totalExpenses };
  $$('[data-total-amount]').forEach(element => {
    element.textContent = money(totals[element.dataset.totalAmount]);
  });
  const hint = $('.balance-hint');
  if (data.remainingExpenses != null) {
    hint.textContent = `Já pago ${money(data.paidThisMonth)} · Ainda previsto ${money(data.remainingExpenses)}`;
  }
  const negative = Number(data.available) < 0;
  $('.balance-card').classList.toggle('is-negative', negative);
  $('#balanceStatus').textContent = negative ? 'As despesas passam da renda'
    : Number(data.available) === 0 ? 'A renda cobre as despesas sem sobra' : 'Saldo previsto positivo';
  const items = [
    ['Contas do mês', data.billTotal, '▤', `${money(data.openBills)} em aberto`],
    ['Parcelas do mês', data.installmentTotal, '▦', 'Pagas e ainda previstas'],
    ['Total das dívidas', data.debtTotal, '◉', `${money(data.debtPayments)} em pagamentos deste mês`],
    ['Pago neste mês', data.paidThisMonth, '↗', 'Contas, parcelas e abatimentos']
  ];
  $('#metrics').innerHTML = items.map(([label, value, icon, note]) => `<article class="metric-card"><div class="metric-top"><span>${label}</span><span class="metric-icon">${icon}</span></div><strong class="metric-value">${money(value)}</strong><div class="metric-note">${esc(note)}</div></article>`).join('');
  const debts = data.debts.filter(d => Number(d.balance) > 0).slice(0, 4);
  drawDebtTrend(data.debtTrend);
  $('#debtProgress').innerHTML = debts.length ? debts.map(debtProgressCard).join('') : empty('Cadastre uma dívida para acompanhar quanto falta quitar.');
  const bills = data.bills.filter(bill => !bill.payment_id).slice(0, 5);
  $('#upcomingBills').innerHTML = bills.length ? bills.map(compactBill).join('') : empty('Nenhuma conta em aberto neste mês.');
  $('#recentHistory').innerHTML = data.history.length ? data.history.slice(0, 4).map(compactHistory).join('') : empty('Os pagamentos e abatimentos aparecerão aqui.');
  const paidInstallments = new Set(data.paidInstallmentIds ?? []);
  drawIncomes(data.incomes); drawBills(data.bills); drawInstallments(data.installments, paidInstallments); drawDebts(data.debts); drawHistory(data.history);
  drawReminders(data.bills);
  drawMonthCompletion('#overviewMonthDone', data.month, data.paidThisMonth > 0 && data.remainingExpenses === 0, 'Mês encerrado', 'Todas as despesas previstas para o mês foram pagas.');
  drawMonthCompletion('#billsMonthDone', data.month, paidBills > 0 && data.openBills === 0, 'Contas do mês pagas', 'Os pagamentos ficam no Histórico.');
  drawMonthCompletion('#installmentsMonthDone', data.month, paidInstallments.size > 0 && data.installments.every(item => paidInstallments.has(String(item.id))), 'Parcelas do mês pagas', 'As parcelas seguintes aparecem nos próximos meses.');
}
function drawMonthCompletion(selector, month, completed, title, description) {
  const panel = $(selector);
  const next = shiftedMonth(month, 1);
  panel.hidden = !completed || next.length !== 7;
  if (panel.hidden) return;
  panel.querySelector('strong').textContent = `${title} · ${monthLabel(month)}`;
  panel.querySelector('p').textContent = description;
  panel.querySelector('button').textContent = `Ir para ${monthLabel(next)}`;
}
function currentMonth() { return `${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,'0')}`; }
function isOneTimeBill(bill) { return bill.recurring != null && Number(bill.recurring) === 0; }
function billDueDate(bill) {
  const period = isOneTimeBill(bill) && bill.started_month ? bill.started_month : selectedMonth;
  const [year, month] = period.split('-').map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  return new Date(year, month - 1, Math.min(Number(bill.due_day), lastDay));
}
function billDueLabel(bill) {
  if (!isOneTimeBill(bill)) return `Vence dia ${bill.due_day}`;
  return `Avulsa · vence em ${billDueDate(bill).toLocaleDateString('pt-BR')}`;
}
function dueReminders(bills) {
  const today = new Date(); today.setHours(0,0,0,0);
  if (selectedMonth !== currentMonth()) return [];
  return bills.filter(bill => !bill.payment_id).map(bill => {
    return { bill, days: Math.round((billDueDate(bill) - today) / 86400000) };
  }).filter(item => item.days <= 7).sort((a,b) => a.days - b.days);
}
function drawReminders(bills) {
  const panel = $('#reminderPanel');
  const items = dueReminders(bills || []);
  panel.hidden = items.length === 0;
  const available = 'Notification' in window;
  const permission = available ? Notification.permission : 'unsupported';
  $$('[data-enable-reminders]').forEach(button => {
    if (button.classList.contains('reminder-enable')) button.textContent = permission === 'granted' ? 'Notificações ativadas' : permission === 'denied' ? 'Notificações bloqueadas' : 'Ativar notificações';
    button.title = permission === 'granted' ? 'Notificações ativadas neste aparelho' : permission === 'denied' ? 'Notificações bloqueadas nas configurações do navegador' : 'Ativar notificações de contas próximas';
    button.disabled = permission === 'granted' || permission === 'denied';
  });
  if (!items.length) { $('#reminderList').innerHTML = ''; return; }
  $('#reminderTitle').textContent = items.some(item => item.days < 0) ? 'Você tem contas vencidas ou próximas do vencimento' : 'Contas próximas do vencimento';
  $('#reminderList').innerHTML = items.map(({ bill, days }) => {
    const status = days < 0 ? `Atrasada há ${Math.abs(days)} dia(s)` : days === 0 ? 'Vence hoje' : `Vence em ${days} dia(s)`;
    return `<div class="reminder-item"><span class="reminder-icon">${icons[bill.category] || '•'}</span><div class="reminder-copy"><strong>${esc(bill.name)}</strong><span>${status} · ${money(bill.expected_amount)}</span></div><button class="small-button" data-pay-bill="${bill.id}">Registrar pagamento</button></div>`;
  }).join('');
  if (permission === 'granted') notifyUpcomingBills(items);
}
function notifyUpcomingBills(items) {
  const near = items.filter(item => item.days <= 3);
  for (const { bill, days } of near) {
    const key = `mf-reminder-${selectedMonth}-${bill.id}`;
    try { if (localStorage.getItem(key)) continue; localStorage.setItem(key, '1'); } catch { continue; }
    const when = days < 0 ? `está atrasada há ${Math.abs(days)} dia(s)` : days === 0 ? 'vence hoje' : `vence em ${days} dia(s)`;
    const options = { body: `${bill.name} ${when}. Valor previsto: ${money(bill.expected_amount)}.`, icon: './icon.svg', tag: key };
    if ('serviceWorker' in navigator) navigator.serviceWorker.ready.then(registration => registration.showNotification('Lembrete de conta', options)).catch(() => new Notification('Lembrete de conta', options));
    else new Notification('Lembrete de conta', options);
  }
}
async function enableReminders() {
  if (!('Notification' in window)) { showToast('Este navegador não oferece notificações. Os avisos aparecem dentro do app.'); return; }
  try {
    const permission = await Notification.requestPermission();
    if (permission === 'granted') { showToast('Notificações ativadas neste aparelho.'); if (dashboard) drawReminders(dashboard.bills); }
    else showToast(permission === 'denied' ? 'Notificações bloqueadas nas configurações do navegador.' : 'Notificações não foram ativadas.');
    if (dashboard) drawReminders(dashboard.bills);
  } catch { showToast('Não foi possível ativar notificações neste navegador.'); }
}
function debtProgressCard(d) {
  const orig = Number(d.original_amount), balance = Number(d.balance);
  const pct = orig > 0 ? Math.max(0, Math.min(100, ((orig - balance) / orig) * 100)) : 0;
  return `<div class="debt-progress-item"><div class="debt-row"><span class="debt-name">${esc(d.name)}</span><span class="debt-balance">${money(balance)}</span></div><div class="debt-caption">${esc(d.creditor || 'Saldo restante')} · ${pct.toFixed(0)}% quitado</div><div class="progress-track"><i style="width:${pct}%"></i></div></div>`;
}
function drawDebtTrend(points) {
  const host = $('#debtTrend');
  if (!points?.length || points.every(point => Number(point.balance) === 0)) { host.innerHTML = '<div class="trend-empty">Cadastre uma dívida e registre abatimentos para ver a evolução.</div>'; return; }
  const width = 560, height = 120, left = 12, right = 8, top = 8, bottom = 23;
  const maximum = Math.max(...points.map(point => Number(point.balance)), 1);
  const x = index => left + index * (width - left - right) / Math.max(1, points.length - 1);
  const y = value => top + (maximum - Number(value)) * (height - top - bottom) / maximum;
  const line = points.map((point, index) => `${index ? 'L' : 'M'}${x(index)},${y(point.balance)}`).join(' ');
  const area = `${line} L${x(points.length-1)},${height-bottom} L${x(0)},${height-bottom} Z`;
  const firstLabel = new Date(`${points[0].month}-02T12:00:00`).toLocaleDateString('pt-BR',{month:'short',year:'2-digit'});
  const lastLabel = new Date(`${points.at(-1).month}-02T12:00:00`).toLocaleDateString('pt-BR',{month:'short',year:'2-digit'});
  host.innerHTML = `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="Evolução do saldo das dívidas nos últimos 12 meses"><defs><linearGradient id="trendFade" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#70e2bd" stop-opacity=".22"/><stop offset="1" stop-color="#70e2bd" stop-opacity="0"/></linearGradient></defs><line class="trend-grid" x1="${left}" x2="${width-right}" y1="${top}" y2="${top}"/><line class="trend-grid" x1="${left}" x2="${width-right}" y1="${height-bottom}" y2="${height-bottom}"/><path class="trend-fill" d="${area}"/><path class="trend-line" d="${line}"/>${points.map((point,index)=>`<circle class="trend-dot" cx="${x(index)}" cy="${y(point.balance)}" r="2.5"><title>${esc(monthLabel(point.month))}: ${money(point.balance)}</title></circle>`).join('')}<text class="trend-label" x="${left}" y="${height-4}">${esc(firstLabel)}</text><text class="trend-label" text-anchor="end" x="${width-right}" y="${height-4}">${esc(lastLabel)}</text></svg>`;
}
function compactBill(b) {
  const description = b.name === b.category ? billDueLabel(b) : `${esc(b.category)} · ${billDueLabel(b)}`;
  return `<div class="compact-row"><span class="row-icon">${icons[b.category] || '✦'}</span><div class="row-copy"><div class="row-title">${esc(b.name)}</div><div class="row-sub">${description}</div></div><div class="row-right"><div class="row-amount">${money(b.expected_amount)}</div><div class="row-state ${b.payment_id ? 'paid' : ''}">${b.payment_id ? 'Paga' : 'Em aberto'}</div></div></div>`;
}
function compactHistory(h) {
  const isIncome = h.kind === 'income';
  return `<div class="compact-row"><span class="row-icon">${h.kind === 'debt' ? '◉' : h.kind === 'bill' ? '▤' : h.kind === 'income' ? '＋' : '▦'}</span><div class="row-copy"><div class="row-title">${esc(h.label)}</div><div class="row-sub">${fmtDate(h.happened_on)} · ${kindLabel(h.kind)}</div></div><div class="row-right"><div class="row-amount">${isIncome ? '+' : '−'} ${money(h.amount)}</div></div></div>`;
}
function kindLabel(kind) { return ({ income: 'Renda recebida', bill: 'Conta paga', installment: 'Parcela paga', debt: 'Abatimento de dívida' })[kind] || kind; }
function drawIncomes(rows) {
  $('#incomesList').innerHTML = rows.length ? rows.map(i => `<article class="record-card"><div class="record-main"><span class="record-icon">＋</span><div><div class="record-name">${esc(i.description)}</div><div class="record-detail">Recebido em ${fmtDate(i.received_on)}${i.note ? ` · ${esc(i.note)}` : ''}</div></div></div><div class="record-end"><span class="record-amount">${money(i.amount)}</span><div class="record-actions"><button class="small-button" data-edit-income="${i.id}">Editar</button><button class="small-button" data-delete-income="${i.id}">Excluir</button></div></div></article>`).join('') : empty('Nenhuma renda registrada para este mês.');
}
function drawBills(bills) {
  const toggle = $('[data-toggle-paid-bills]');
  const paidCount = bills.filter(bill => bill.payment_id).length;
  toggle.hidden = paidCount === 0;
  toggle.setAttribute('aria-pressed', String(showPaidBills));
  toggle.textContent = showPaidBills ? 'Ocultar contas pagas' : `Mostrar contas pagas (${paidCount})`;
  const visibleBills = showPaidBills ? bills : bills.filter(bill => !bill.payment_id);
  $('#billsList').innerHTML = visibleBills.length ? visibleBills.map(b => `<article class="record-card"><div class="record-main"><span class="record-icon">${icons[b.category] || '✦'}</span><div><div class="record-name">${esc(b.name)}</div><div class="record-detail">${b.name !== b.category ? `${esc(b.category)} · ` : ''}${billDueLabel(b)}${b.payment_id ? ` · pago em ${fmtDate(b.paid_on)}` : ''}</div></div></div><div class="record-end"><span class="record-amount">${money(b.payment_id ? b.paid_amount : b.expected_amount)}</span><div class="record-actions"><button class="small-button" data-pay-bill="${b.id}" ${b.payment_id ? 'disabled' : ''}>${b.payment_id ? '✓ Paga' : 'Pagar'}</button><button class="small-button" data-edit-bill="${b.id}">Editar</button><button class="small-button" data-delete-bill="${b.id}">Excluir</button></div></div></article>`).join('') : empty('Nenhuma conta em aberto neste mês.');
}
function drawInstallments(rows, paidInstallments) {
  $('#installmentsList').innerHTML = rows.length ? rows.map(i => {
    const left = Number(i.total) - Number(i.paid), totalOwed = Number(i.amount) * left, pct = Number(i.total) ? (Number(i.paid) / Number(i.total)) * 100 : 0;
    const paidThisMonth = paidInstallments.has(String(i.id));
    return `<article class="record-card"><div class="record-main"><span class="record-icon">▦</span><div><div class="record-name">${esc(i.name)}</div><div class="record-detail">${esc(i.store || 'Compra')} · ${i.paid}/${i.total} parcelas pagas · faltam ${left}</div><div class="progress-mini"><i style="width:${pct}%"></i></div></div></div><div class="record-end"><span class="record-amount">${money(totalOwed)}<div class="record-detail">restante da compra</div></span><div class="record-actions"><button class="small-button" data-pay-installment="${i.id}" ${paidThisMonth ? 'disabled' : ''}>${paidThisMonth ? '✓ Paga neste mês' : 'Pagar'}</button><button class="small-button" data-edit-installment="${i.id}">Editar</button><button class="small-button" data-delete-installment="${i.id}">Excluir</button></div></div></article>`;
  }).join('') : empty('Nenhuma compra parcelada pendente neste mês.');
}
function drawDebts(debts) {
  const openDebts = debts.filter(debt => Number(debt.balance) > 0);
  const total = debts.reduce((sum, d) => sum + Number(d.balance), 0);
  const original = debts.reduce((sum, d) => sum + Number(d.original_amount), 0);
  const paid = Math.max(0, original - total);
  const summary = [['Saldo atual', total, '◉'], ['Valor inicial', original, '↗'], ['Já abatido', paid, '✓'], ['Dívidas abertas', openDebts.length, '＋']];
  $('#debtSummary').innerHTML = summary.map(([label, value, icon]) => `<article class="metric-card"><div class="metric-top">${label}<span class="metric-icon">${icon}</span></div><strong class="metric-value">${label === 'Dívidas abertas' ? value : money(value)}</strong><div class="metric-note">${label === 'Já abatido' && original ? `${(100 * paid / original).toFixed(0)}% do valor inicial` : 'Somando seus registros'}</div></article>`).join('');
  $('#debtsList').innerHTML = openDebts.length ? openDebts.map(d => {
    const pct = Number(d.original_amount) ? Math.max(0, Math.min(100, (1 - Number(d.balance) / Number(d.original_amount)) * 100)) : 0;
    const monthly = Number(d.monthly_payment) > 0 ? `${money(d.monthly_payment)} por mês` : 'Pagamentos avulsos';
    return `<article class="record-card"><div class="record-main"><span class="record-icon">◉</span><div><div class="record-name">${esc(d.name)}</div><div class="record-detail">${esc(d.creditor || 'Credor não informado')} · ${pct.toFixed(0)}% quitado · inicial ${money(d.original_amount)}</div><div class="record-detail">${monthly}</div><div class="progress-mini"><i style="width:${pct}%"></i></div></div></div><div class="record-end"><span class="record-amount">${money(d.balance)}<div class="record-detail">saldo restante</div></span><div class="record-actions"><button class="small-button" data-pay-debt="${d.id}">Abater</button><button class="small-button" data-edit-debt="${d.id}">Editar</button><button class="small-button" data-delete-debt="${d.id}">Excluir</button></div></div></article>`;
  }).join('') : empty('Nenhuma dívida em aberto.');
}
function drawHistory(rows) {
  $('#historyList').innerHTML = rows.length ? rows.map(h => `<div class="history-row"><span class="row-icon">${h.kind === 'debt' ? '◉' : h.kind === 'bill' ? '▤' : h.kind === 'income' ? '＋' : '▦'}</span><div class="row-copy"><div class="row-title">${esc(h.label)}</div><div class="row-sub">${fmtDate(h.happened_on)} · ${monthLabel(h.period)}${h.note ? ` · ${esc(h.note)}` : ''}</div></div><div class="row-right"><div class="row-amount">${h.kind === 'income' ? '+' : '−'} ${money(h.amount)}</div>${h.kind === 'debt' ? `<div class="row-sub">restante ${money(h.remaining_after)}</div>` : ''}</div></div>`).join('') : empty('Nenhuma movimentação neste mês.');
}
async function loadDashboard() {
  $('#monthSelect').value = selectedMonth;
  const request = ++dashboardRequest;
  try {
    const data = await api(`/api/dashboard?month=${encodeURIComponent(selectedMonth)}`);
    if (request !== dashboardRequest) return;
    dashboard = data;
    showError('');
    drawDashboard(dashboard);
  } catch (error) {
    if (request !== dashboardRequest) return;
    showError(window.localFinance?.isLocal ? error.message : `${error.message} Confirme se o MySQL está ligado e se o banco foi criado com database/schema.sql.`);
  }
}
function input(name, label, type = 'text', opts = {}) {
  const required = opts.required === false ? '' : 'required';
  const full = opts.full ? ' full' : '';
  const common = `name="${name}" ${required} ${opts.min !== undefined ? `min="${opts.min}"` : ''} ${opts.max !== undefined ? `max="${opts.max}"` : ''} ${opts.step ? `step="${opts.step}"` : ''} value="${esc(opts.value ?? '')}" placeholder="${esc(opts.placeholder || '')}"`;
  if (type === 'select') return `<div class="field${full}"><label for="f-${name}">${label}</label><select id="f-${name}" ${common}>${opts.options.map(option => `<option value="${esc(option)}" ${option === opts.value ? 'selected' : ''}>${esc(option)}</option>`).join('')}</select></div>`;
  if (type === 'textarea') return `<div class="field${full}"><label for="f-${name}">${label}</label><textarea id="f-${name}" name="${name}" placeholder="${esc(opts.placeholder || '')}">${esc(opts.value || '')}</textarea></div>`;
  return `<div class="field${full}"><label for="f-${name}">${label}</label><input id="f-${name}" type="${type}" ${common}></div>`;
}
function openModal(type, record = null) {
  modal = { type, record };
  const title = { income: record ? 'Editar renda' : 'Registrar renda', bill: record ? 'Editar conta' : 'Nova conta', installment: record ? 'Editar compra' : 'Nova compra parcelada', debt: record ? 'Editar dívida' : 'Adicionar dívida', payBill: `Pagar ${record?.name ?? ''}`, payInstallment: `Pagar parcela · ${record?.name ?? ''}`, payDebt: `Abater ${record?.name ?? ''}` }[type];
  const r = record || {};
  $('#modalTitle').textContent = title;
  let fields = '';
  if (type === 'income') fields = input('description','Descrição','text',{value:r.description,placeholder:'Ex.: salário'}) + input('amount','Valor recebido','number',{min:'0.01',step:'0.01',value:r.amount,placeholder:'0,00'}) + input('received_on','Data do recebimento','date',{value:r.received_on || dateForSelectedMonth()}) + input('note','Observação (opcional)','text',{required:false,full:true,value:r.note});
  if (type === 'bill') {
    fields = input('category','Tipo de conta','select',{value:r.category || 'Água',options:['Água','Luz','Internet','Celular','Moradia','Transporte','Saúde','Educação','Cartão','Outros']})
      + input('name','Identificação (opcional)','text',{required:false,value:r.name === r.category ? '' : r.name,placeholder:'Ex.: CPFL, se quiser diferenciar'})
      + input('expected_amount','Valor previsto','number',{min:'0.01',step:'0.01',value:r.expected_amount,placeholder:'0,00'})
      + input('due_day','Dia do vencimento','number',{min:'1',max:'31',value:r.due_day,placeholder:'10'})
      + input('frequency','Frequência','select',{value:isOneTimeBill(r) ? 'Uma vez' : 'Todo mês',options:['Todo mês','Uma vez']})
      + input('started_month','Começa em','month',{required:false,value:record ? r.started_month : selectedMonth,placeholder:'AAAA-MM'})
      + '<p class="form-help full">Uma conta mensal volta no mês seguinte. Uma conta avulsa fica em aberto até ser paga.</p>';
  }
  if (type === 'installment') fields = input('name','Nome da compra','text',{value:r.name,placeholder:'Ex.: Geladeira'}) + input('store','Loja ou cartão (opcional)','text',{required:false,value:r.store}) + input('amount','Valor da parcela','number',{min:'0.01',step:'0.01',value:r.amount,placeholder:'0,00'}) + input('total','Número de parcelas','number',{min:'1',value:r.total,placeholder:'10'}) + input('paid','Parcelas já pagas','number',{min:'0',value:r.paid ?? 0}) + input('started_month','Começa em','month',{value:r.started_month || selectedMonth});
  if (type === 'debt') fields = input('name','Nome da dívida','text',{value:r.name,placeholder:'Ex.: Empréstimo pessoal'}) + input('creditor','Banco ou credor (opcional)','text',{required:false,value:r.creditor}) + input('original_amount','Valor original da dívida','number',{min:'0.01',step:'0.01',value:r.original_amount,placeholder:'30000,00'}) + input('balance','Saldo que falta pagar','number',{min:'0',step:'0.01',value:r.balance,placeholder:'30000,00'}) + `<p class="form-help full">O valor original fica registrado. Cada abatimento reduz o saldo, mesmo que os pagamentos tenham valores diferentes.</p>` + input('monthly_payment','Parcela mensal (opcional)','number',{required:false,min:'0',step:'0.01',value:r.monthly_payment,placeholder:'0,00'}) + input('due_day','Dia de vencimento (opcional)','number',{required:false,min:'1',max:'31',value:r.due_day}) + input('note','Anotação (opcional)','textarea',{required:false,full:true,value:r.note});
  if (type === 'payBill') fields = input('amount','Valor pago','number',{min:'0.01',step:'0.01',value:record.expected_amount}) + input('paid_on','Data do pagamento','date',{value:dateForSelectedMonth()}) + input('note','Observação (opcional)','text',{required:false,full:true});
  if (type === 'payInstallment') fields = input('paid_on','Data do pagamento','date',{value:dateForSelectedMonth()}) + input('note','Observação (opcional)','text',{required:false,full:true});
  if (type === 'payDebt') fields = input('amount','Valor deste pagamento','number',{min:'0.01',max:record.balance,step:'0.01',placeholder:`Até ${money(record.balance)}`}) + `<div class="payment-preview full" id="debtPaymentPreview">Saldo restante após pagar <strong>${money(record.balance)}</strong></div>` + input('paid_on','Data do pagamento','date',{value:dateForSelectedMonth()}) + input('note','Observação (opcional)','text',{required:false,full:true});
  $('#formFields').innerHTML = fields;
  $('#modalBackdrop').hidden = false;
  if (type === 'debt') {
    const original = $('#f-original_amount'), balance = $('#f-balance');
    original.addEventListener('input', () => { if (!balance.dataset.touched) balance.value = original.value; });
    balance.addEventListener('input', () => { balance.dataset.touched = '1'; });
  }
  if (type === 'payDebt') {
    const amount = $('#f-amount'), preview = $('#debtPaymentPreview');
    const updatePreview = () => { const remaining = Math.max(0, Number(record.balance) - Math.max(0, Number(amount.value || 0))); preview.innerHTML = `Saldo restante após pagar <strong>${money(remaining)}</strong>`; };
    amount.addEventListener('input', updatePreview);
  }
  $('#f-' + ({ income:'description', bill:'category', installment:'name', debt:'name', payBill:'amount', payInstallment:'paid_on', payDebt:'amount' })[type])?.focus();
}
function closeModal() { $('#modalBackdrop').hidden = true; modal = null; $('#recordForm').reset(); }
async function submitRecord(values) {
  const body = Object.fromEntries(values.entries());
  const numberFields = ['amount','expected_amount','total','paid','due_day','original_amount','balance','monthly_payment'];
  numberFields.forEach(name => { if (body[name] !== undefined && body[name] !== '') body[name] = Number(body[name]); });
  const { type, record } = modal;
  if (type === 'income') return api(record ? `/api/incomes/${record.id}` : '/api/incomes', { method:record ? 'PATCH' : 'POST', body:JSON.stringify(body) });
  if (type === 'bill') {
    body.name = String(body.name || '').trim() || body.category;
    body.recurring = body.frequency === 'Uma vez' ? 0 : 1;
    delete body.frequency;
    return api(record ? `/api/bills/${record.id}` : '/api/bills', { method:record ? 'PATCH' : 'POST', body:JSON.stringify(body) });
  }
  if (type === 'installment') return api(record ? `/api/installments/${record.id}` : '/api/installments', { method:record ? 'PATCH' : 'POST', body:JSON.stringify(body) });
  if (type === 'debt') return api(record ? `/api/debts/${record.id}` : '/api/debts', { method:record ? 'PATCH' : 'POST', body:JSON.stringify(body) });
  if (type === 'payBill') return api(`/api/bills/${record.id}/payments`, { method:'POST', body:JSON.stringify(body) });
  if (type === 'payInstallment') return api(`/api/installments/${record.id}/payments`, { method:'POST', body:JSON.stringify(body) });
  if (type === 'payDebt') return api(`/api/debts/${record.id}/payments`, { method:'POST', body:JSON.stringify(body) });
}

document.addEventListener('click', event => {
  const logout = event.target.closest('[data-logout]');
  if (logout) return logoutUser();
  const monthControl = event.target.closest('[data-month-step]');
  if (monthControl) return moveMonth(Number(monthControl.dataset.monthStep));
  if (event.target.closest('[data-toggle-paid-bills]') && dashboard) {
    showPaidBills = !showPaidBills;
    return drawBills(dashboard.bills);
  }
  const nav = event.target.closest('[data-page]'); if (nav) return setPage(nav.dataset.page);
  const open = event.target.closest('[data-open]'); if (open) return openModal(open.dataset.open);
  const reminderButton = event.target.closest('[data-enable-reminders]'); if (reminderButton) return enableReminders();
  const payBill = event.target.closest('[data-pay-bill]'); if (payBill) return openModal('payBill', dashboard.bills.find(b => String(b.id) === payBill.dataset.payBill));
  const payInst = event.target.closest('[data-pay-installment]'); if (payInst) return openModal('payInstallment', dashboard.installments.find(i => String(i.id) === payInst.dataset.payInstallment));
  const payDebt = event.target.closest('[data-pay-debt]'); if (payDebt) return openModal('payDebt', dashboard.debts.find(d => String(d.id) === payDebt.dataset.payDebt));
  const editIncome = event.target.closest('[data-edit-income]'); if (editIncome) return openModal('income', dashboard.incomes.find(i => String(i.id) === editIncome.dataset.editIncome));
  const editBill = event.target.closest('[data-edit-bill]'); if (editBill) return openModal('bill', dashboard.bills.find(b => String(b.id) === editBill.dataset.editBill));
  const editInstallment = event.target.closest('[data-edit-installment]'); if (editInstallment) return openModal('installment', dashboard.installments.find(i => String(i.id) === editInstallment.dataset.editInstallment));
  const editDebt = event.target.closest('[data-edit-debt]'); if (editDebt) return openModal('debt', dashboard.debts.find(d => String(d.id) === editDebt.dataset.editDebt));
  const deleteButton = event.target.closest('[data-delete-income],[data-delete-bill],[data-delete-installment],[data-delete-debt]');
  if (deleteButton) {
    const map = [['data-delete-income','incomes','renda'],['data-delete-bill','bills','conta'],['data-delete-installment','installments','compra parcelada'],['data-delete-debt','debts','dívida']];
    const [attribute, collection, label] = map.find(([attr]) => deleteButton.hasAttribute(attr));
    return deleteRecord(`/api/${collection}/${deleteButton.getAttribute(attribute)}`, label);
  }
  const backup = event.target.closest('[data-backup]'); if (backup) return downloadBackup();
  const restore = event.target.closest('[data-restore]'); if (restore) return $('#restoreFile').click();
  if (event.target.id === 'closeModal' || event.target.id === 'cancelModal' || event.target.id === 'modalBackdrop') closeModal();
});
async function deleteRecord(url, label) {
  if (!window.confirm(`Excluir esta ${label}? Os pagamentos já registrados serão mantidos no histórico.`)) return;
  try { await api(url, { method:'DELETE' }); showToast('Registro excluído.'); await loadDashboard(); }
  catch (error) { showError(error.message); }
}
async function downloadBackup() {
  try {
    const data = await api('/api/backup');
    const filename = `meu-financeiro-backup-${localISO()}.json`;
    const json = JSON.stringify(data, null, 2);
    if (window.localFinance?.isLocal && window.AndroidFinance?.saveBackup) {
      window.AndroidFinance.saveBackup(filename, json);
      return;
    }
    const file = new File([json], filename, { type: 'application/json' });
    if (window.localFinance?.isLocal && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ title: 'Backup do Meu Financeiro', files: [file] });
        return;
      } catch (error) {
        if (error.name === 'AbortError') return;
      }
    }
    const link = document.createElement('a');
    link.href = URL.createObjectURL(file);
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 30000);
    showToast('Backup baixado.');
  } catch (error) { showError(error.message); }
}
window.addEventListener('android-backup-result', event => {
  if (event.detail?.status === 'saved') showToast('Backup salvo.');
  if (event.detail?.status === 'error') showError('Não foi possível salvar o backup.');
});
$('#restoreFile').addEventListener('change', async event => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const backup = JSON.parse(await file.text());
    if (!window.confirm('Restaurar este backup? Os registros atuais serão substituídos pelos dados do arquivo.')) return;
    await api('/api/backup/restore', { method:'POST', body:JSON.stringify(backup) });
    showToast('Backup restaurado.'); await loadDashboard();
  } catch (error) { showError(error.message || 'Não foi possível ler o arquivo de backup.'); }
  finally { event.target.value = ''; }
});
$('#recordForm').addEventListener('submit', async event => {
  event.preventDefault();
  const submit = event.currentTarget.querySelector('button[type=submit]');
  if (submit.disabled) return;
  submit.disabled = true;
  try { await submitRecord(new FormData(event.currentTarget)); closeModal(); showToast('Registro salvo com sucesso.'); await loadDashboard(); }
  catch (error) { showError(error.message); }
  finally { submit.disabled = false; }
});
$('#monthSelect').addEventListener('change', event => chooseMonth(event.target.value));
window.setInterval(() => { if (!document.hidden) loadDashboard(); }, 30 * 60 * 1000);
$('#todayLabel').textContent = new Date().toLocaleDateString('pt-BR', { weekday:'long', day:'numeric', month:'long' }).toUpperCase();
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('./sw.js').catch(() => {});
function showAuth(setup) {
  needsFirstSetup = setup;
  $('#appShell').hidden = true;
  $('#authGate').hidden = false;
  $('#authTitle').textContent = setup ? 'Criar acesso' : 'Entrar';
  $('#authMessage').textContent = setup ? 'Crie um usuário e uma senha forte para proteger seus registros.' : 'Acesse seus registros financeiros com segurança.';
  $('#authSubmit').innerHTML = setup ? 'Criar acesso <span>→</span>' : 'Entrar <span>→</span>';
  $('#authSubmit').disabled = false;
  $('#authError').hidden = true;
  $('#authFields').innerHTML = input('username','Usuário','text',{placeholder:'Seu usuário'}) + input('password','Senha','password',{placeholder:setup ? 'Pelo menos 12 caracteres' : 'Sua senha'}) + (setup ? input('passwordConfirm','Confirmar senha','password',{placeholder:'Digite a senha novamente'}) : '');
}
async function initializeApp() {
  if (window.localFinance?.isLocal) {
    $('#authGate').hidden = true;
    $('#appShell').hidden = false;
    $('[data-logout]').hidden = true;
    $('[data-backup]').textContent = 'Exportar backup';
    $('[data-restore]').textContent = 'Importar backup';
    $('.backup-note').textContent = 'Seus registros ficam no aparelho. Para transferir ao computador, exporte o backup. Importar substitui os registros atuais.';
    $('#balanceStatus').textContent = 'Carregando dados do aparelho…';
    await loadDashboard(); return;
  }
  try {
    const status = await api('/api/auth/status');
    if (status.authenticated) { $('#authGate').hidden = true; $('#appShell').hidden = false; await loadDashboard(); }
    else showAuth(status.setupRequired);
  } catch (error) {
    showAuth(false);
    $('#authTitle').textContent = 'Banco não conectado';
    $('#authMessage').textContent = 'Configure a conexão com o MySQL para iniciar o app.';
    $('#authError').textContent = error.message;
    $('#authError').hidden = false;
    $('#authSubmit').disabled = true;
  }
}
$('#authForm').addEventListener('submit', async event => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(event.currentTarget));
  const error = $('#authError');
  error.hidden = true;
  if (needsFirstSetup && values.password !== values.passwordConfirm) { error.textContent = 'As senhas não coincidem.'; error.hidden = false; return; }
  const endpoint = needsFirstSetup ? '/api/auth/setup' : '/api/auth/login';
  try {
    await api(endpoint, { method:'POST', body:JSON.stringify({ username:values.username, password:values.password }) });
    $('#authGate').hidden = true; $('#appShell').hidden = false;
    await loadDashboard();
  } catch (failure) { error.textContent = failure.message; error.hidden = false; }
});
async function logoutUser() {
  try { await api('/api/auth/logout', { method:'POST', body:'{}' }); showAuth(false); }
  catch (error) { showError(error.message); }
}
initializeApp();


