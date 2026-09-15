(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.InvoiceModel = api;
})(globalThis, function() {
  const plan = globalThis.RollandsAccountPlan || (typeof require === 'function' ? require('./account-plan.js') : null);
  const basAccounts = plan?.accounts || [];
  const accounts = Object.fromEntries(basAccounts.map(account => [account.code, account.name]));
  Object.assign(accounts, {'3010':'Försäljning varor','3041':'Försäljning tjänster','3051':'Försäljning varor 25 %','3052':'Försäljning varor 12 %','3053':'Försäljning varor 6 %','3054':'Försäljning varor momsfri'});
  const vatAccounts = {25:'2611 Utgående moms 25 %',12:'2621 Utgående moms 12 %',6:'2631 Utgående moms 6 %'};
  const interestText = 'Vid betalning efter förfallodagen debiteras dröjsmålsränta med referensränta + 8 %.';
  const cents = n => Math.round(Number(n)*100);
  function calculate(input, credit = false) {
    if (!Array.isArray(input) || !input.length || input.length > 100) throw Error('Ange mellan 1 och 100 fakturarader.');
    const sign = credit ? -1 : 1;
    const lines = input.map((r, i) => {
      const description = String(r.description || '').trim(), account = String(r.account || '').trim();
      const value = Number(r.amount), vatRate = Number(r.vatRate);
      if (!description || description.length > 1000) throw Error(`Rad ${i+1}: ange fakturatext med högst 1 000 tecken.`);
      if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0 || value > 100000000) throw Error(`Rad ${i+1}: ange ett positivt belopp i hela kronor.`);
      if (!/^3\d{3}$/.test(account)) throw Error(`Rad ${i+1}: välj ett intäktskonto (3000–3999).`);
      if (![0,6,12,25].includes(vatRate)) throw Error(`Rad ${i+1}: välj momssats.`);
      const net = Math.round(value)*100*sign, vat = Math.round(value*vatRate/100)*100*sign;
      return {description,account,vatRate,net:net/100,vat:vat/100,total:(net+vat)/100};
    });
    const net = lines.reduce((n,r)=>n+cents(r.net),0)/100, vat = lines.reduce((n,r)=>n+cents(r.vat),0)/100;
    const total = (cents(net)+cents(vat))/100;
    const posting = (account,value,debit) => ({account,debit:debit?Math.abs(value):0,credit:debit?0:Math.abs(value)});
    const rows = [posting('1510 Kundfordringar',total,!credit)];
    for (const r of lines) rows.push(posting(`${r.account} ${accounts[r.account] || 'Försäljning'}`,r.net,credit));
    const vatSummary = [...new Set(lines.map(r=>r.vatRate))].sort((a,b)=>a-b).map(rate=>({rate,net:lines.filter(r=>r.vatRate===rate).reduce((n,r)=>n+cents(r.net),0)/100,vat:lines.filter(r=>r.vatRate===rate).reduce((n,r)=>n+cents(r.vat),0)/100}));
    for (const v of vatSummary) if(v.vat) rows.push(posting(vatAccounts[v.rate],v.vat,credit));
    return {lines,net,vat,total,vatSummary,rows};
  }
  function dueDate(date, days) {
    const d = new Date(date+'T12:00:00Z');
    if (Number.isNaN(d.valueOf())) return '';
    d.setUTCDate(d.getUTCDate()+Number(days)); return d.toISOString().slice(0,10);
  }
  function ocr(number) {
    return String(number).replace(/\D/g,'').slice(-6).padStart(6,'0');
  }
  return {accounts,calculate,dueDate,ocr,interestText};
});
