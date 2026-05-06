// All amounts are integer halalas. UI shows SAR with 2 decimals.

export function toHalalas(input) {
  if (input == null || input === '') return 0;
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw { status: 400, message: 'invalid amount' };
    return Math.round(input * 100);
  }
  const s = String(input).trim().replace(/,/g, '');
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) throw { status: 400, message: 'invalid amount' };
  const [whole, frac = ''] = s.split('.');
  const sign = whole.startsWith('-') ? -1 : 1;
  const w = whole.replace('-', '');
  const padded = (frac + '00').slice(0, 2);
  return sign * (parseInt(w, 10) * 100 + parseInt(padded || '0', 10));
}

export function formatSAR(halalas) {
  if (halalas == null) return '0.00';
  const sign = halalas < 0 ? '-' : '';
  const abs = Math.abs(Number(halalas));
  const whole = Math.floor(abs / 100);
  const frac = (abs % 100).toString().padStart(2, '0');
  return `${sign}${whole}.${frac}`;
}

export function computeClosing(input, openingBalanceHalalas, appsEnabled = true) {
  const total = toHalalas(input.foodics_total ?? input.total_sales);
  const network = toHalalas(input.network_total ?? input.network_sales);
  const cashInSafe = toHalalas(input.cash_in_safe);
  const custodyInHand = toHalalas(input.custody_in_hand || 0);
  const custodyExpense = toHalalas(input.custody_expense || 0);

  const keeta = appsEnabled ? toHalalas(input.keeta || 0) : 0;
  const hungerstation = appsEnabled ? toHalalas(input.hungerstation || 0) : 0;
  const jahez = appsEnabled ? toHalalas(input.jahez || 0) : 0;
  const ninja = appsEnabled ? toHalalas(input.ninja || 0) : 0;
  const apps = keeta + hungerstation + jahez + ninja;

  if ([total, network, apps, cashInSafe, custodyInHand, custodyExpense, keeta, hungerstation, jahez, ninja].some((v) => v < 0)) {
    throw { status: 400, message: 'amounts must be non-negative' };
  }

  const cashSales = total - network - apps;
  if (cashSales < 0) {
    throw { status: 400, message: 'كاش الشفت سالب — تأكد أن إجمالي فودكس ≥ الشبكة + التطبيقات' };
  }

  const opening = Number(openingBalanceHalalas);
  const expected = opening + cashSales;
  const variance = cashInSafe - expected;

  return {
    total_sales_halalas: total,
    network_sales_halalas: network,
    apps_sales_halalas: apps,
    keeta_halalas: keeta,
    hungerstation_halalas: hungerstation,
    jahez_halalas: jahez,
    ninja_halalas: ninja,
    cash_sales_halalas: cashSales,
    cash_in_safe_halalas: cashInSafe,
    custody_in_hand_halalas: custodyInHand,
    custody_expense_halalas: custodyExpense,
    opening_balance_halalas: opening,
    expected_cash_halalas: expected,
    variance_halalas: variance,
  };
}
