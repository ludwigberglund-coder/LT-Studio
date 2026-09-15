(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RollandsAccountPlan = api;
})(globalThis, function() {
  const sections = [
    { code: '1', title: 'Tillgångar', accounts: [
      ['1000','Immateriella anläggningstillgångar','B1'], ['1009','Årets avskrivningar på immateriella anläggningstillgångar','B1'],
      ['1110','Byggnader','B2'], ['1119','Ackumulerade avskrivningar på byggnader','B2'], ['1130','Mark','B3'],
      ['1150','Markanläggningar','B2'], ['1159','Ackumulerade avskrivningar på markanläggningar','B2'],
      ['1180','Pågående nyanläggningar och förskott för byggnader och mark','B3'],
      ['1220','Maskiner och inventarier','B4'], ['1221','Årets nyanskaffning av maskiner och inventarier','B4'],
      ['1222','Årets ersättning för maskiner och inventarier','B4'], ['1229','Årets avskrivningar på maskiner och inventarier','B4'],
      ['1230','Byggnads- och markinventarier','B4'], ['1231','Årets nyanskaffning av byggnads- och markinventarier','B4'],
      ['1232','Årets ersättning för byggnads- och markinventarier','B4'], ['1239','Årets avskrivningar på byggnads- och markinventarier','B4'],
      ['1240','Bilar och andra transportmedel','B4'], ['1241','Årets nyanskaffning av bilar och andra transportmedel','B4'],
      ['1242','Årets ersättning för bilar och andra transportmedel','B4'], ['1249','Årets avskrivningar på bilar och andra transportmedel','B4'],
      ['1300','Andelar','B5'], ['1400','Lager','B6'], ['1500','Kundfordringar','B7'], ['1600','Övriga fordringar','B8'],
      ['1650','Momsfordran','B8'], ['1700','Förskott till leverantörer','B8'], ['1910','Kassa','B9'], ['1920','PlusGiro','B9'],
      ['1930','Företagskonto/checkkonto/affärskonto','B9'], ['1940','Övriga bankkonton','B9'], ['1970','Särskilda bankkonton','B9']
    ]},
    { code: '2', title: 'Eget kapital och skulder', accounts: [
      ['2010','Eget kapital, delägare 1','B10'], ['2011','Egna varuuttag','B10'], ['2012','Avräkning för skatter och avgifter (skattekonto)','B10'],
      ['2013','Övriga egna uttag','B10'], ['2014','Uttag förmåner','B10'], ['2017','Egna insättningar','B10'],
      ['2019','Årets resultat, delägare 1','B10'], ['2020','Eget kapital, delägare 2','B10'], ['2030','Eget kapital, delägare 3','B10'],
      ['2040','Eget kapital, delägare 4','B10'], ['2050','Avsättning till expansionsfond','U2'], ['2060','Ersättningsfond','U3'],
      ['2070','Insatsemissioner, avbetalningsplan på skog, skogskonto','U4'], ['2080','Periodiseringsfonder','U1'],
      ['2083','Periodiseringsfond vid 2012 års taxering','U1'], ['2084','Periodiseringsfond vid 2013 års taxering','U1'],
      ['2085','Periodiseringsfond 2013','U1'], ['2086','Periodiseringsfond 2014','U1'], ['2087','Periodiseringsfond 2015','U1'],
      ['2088','Periodiseringsfond 2016','U1'], ['2089','Periodiseringsfond 2017','U1'], ['2090','Utjämningskonto, upplysningar 1–4',''],
      ['2330','Checkräkningskredit','B13'], ['2350','Skulder till kreditinstitut','B13'], ['2390','Övriga låneskulder','B13'],
      ['2440','Leverantörsskulder','B15'], ['2610','Utgående moms, 25 %','B14'], ['2611','Utgående moms på försäljning inom Sverige, 25 %','B14'],
      ['2612','Utgående moms på egna uttag, 25 %','B14'], ['2613','Utgående moms för uthyrning, 25 %','B14'],
      ['2614','Utgående moms omvänd skattskyldighet, 25 %','B14'], ['2615','Utgående moms import av varor, 25 %','B14'], ['2618','Vilande utgående moms, 25 %','B14'],
      ['2620','Utgående moms, 12 %','B14'], ['2621','Utgående moms på försäljning inom Sverige, 12 %','B14'],
      ['2622','Utgående moms på egna uttag, 12 %','B14'], ['2623','Utgående moms för uthyrning, 12 %','B14'],
      ['2624','Utgående moms omvänd skattskyldighet, 12 %','B14'], ['2625','Utgående moms import av varor, 12 %','B14'], ['2628','Vilande utgående moms, 12 %','B14'],
      ['2630','Utgående moms, 6 %','B14'], ['2631','Utgående moms på försäljning inom Sverige, 6 %','B14'],
      ['2632','Utgående moms på egna uttag, 6 %','B14'], ['2633','Utgående moms för uthyrning, 6 %','B14'],
      ['2634','Utgående moms omvänd skattskyldighet, 6 %','B14'], ['2635','Utgående moms import av varor, 6 %','B14'], ['2638','Vilande utgående moms, 6 %','B14'],
      ['2640','Ingående moms','B14'], ['2641','Debiterad ingående moms','B14'], ['2642','Debiterad ingående moms i anslutning till frivillig skattskyldighet','B14'],
      ['2645','Beräknad ingående moms på förvärv från utlandet','B14'], ['2646','Ingående moms på uthyrning','B14'], ['2648','Vilande ingående moms','B14'],
      ['2649','Ingående moms, blandad verksamhet','B14'], ['2650','Redovisningskonto för moms','B14'], ['2660','Särskilda punktskatter','B14'],
      ['2710','Personalskatt','B14'], ['2730','Lagstadgade/avtalade sociala avgifter och särskild löneskatt','B14'], ['2900','Övriga skulder','B16']
    ]},
    { code: '3', title: 'Rörelsens inkomster/intäkter', accounts: [
      ['3000','Försäljning och utfört arbete samt övriga momspliktiga intäkter','R1'], ['3100','Momsfria intäkter','R2'],
      ['3200','Bil- och bostadsförmån m.m.','R3'], ['3500','Fakturerade kostnader','R1'], ['3700','Lämnade rabatter, bonus etc.','R1/R2'],
      ['3900','Övriga rörelseintäkter','R1/R2'], ['3970','Vinst vid avyttring av immateriella och materiella anläggningstillgångar','R2'], ['3980','Erhållna bidrag','R2']
    ]},
    { code: '4', title: 'Utgifter/kostnader för varor, material och vissa köpta tjänster', accounts: [
      ['4000','Varor','R5'], ['4600','Legoarbeten och underentreprenader','R5'], ['4700','Erhållna rabatter, bonus etc.','R6'], ['4900','Förändring av lager','R5']
    ]},
    { code: '5–6', title: 'Övriga externa rörelseutgifter/kostnader', accounts: [
      ['5000','Lokalkostnader','R6'], ['5100','Fastighetskostnader','R6'], ['5200','Hyra av anläggningstillgångar','R6'],
      ['5400','Förbrukningsinventarier och förbrukningsmaterial','R6'], ['5500','Reparation och underhåll','R6'], ['5600','Kostnader för transportmedel','R6'],
      ['5610','Personbilskostnader','R6'], ['5611','Drivmedel för personbilar','R6'], ['5612','Försäkring och skatt för personbilar','R6'],
      ['5613','Reparation och underhåll av personbilar','R6'], ['5615','Leasing av personbilar','R6'], ['5618','Schablonmässig milkostnad, privat personbil','R6'], ['5619','Övriga personbilskostnader','R6'],
      ['5620','Lastbilskostnader','R6'], ['5700','Frakter och transporter','R6'], ['5800','Resekostnader','R6'], ['5900','Reklam och PR','R6'],
      ['6000','Övriga försäljningskostnader','R6'], ['6070','Representation','R6'], ['6071','Representation, avdragsgill','R6'], ['6072','Representation, ej avdragsgill','R6'],
      ['6100','Kontorsmateriel och trycksaker','R6'], ['6200','Tele och post','R6'], ['6300','Företagsförsäkringar och övriga riskkostnader','R6'],
      ['6310','Företagsförsäkringar','R6'], ['6500','Övriga externa tjänster','R6'], ['6800','Inhyrd personal','R6'], ['6900','Övriga kostnader','R6'], ['6980','Föreningsavgifter','R6']
    ]},
    { code: '7', title: 'Utgifter/kostnader för personal, avskrivningar', accounts: [
      ['7000','Löner till anställda','R7'], ['7300','Kostnadsersättningar och förmåner','R7'], ['7400','Pensionskostnader','R7'],
      ['7500','Sociala och andra avgifter enligt lag och avtal','R7'], ['7600','Övriga personalkostnader','R7'], ['7631','Personalrepresentation, avdragsgill','R7'],
      ['7632','Personalrepresentation, ej avdragsgill','R7'], ['7700','Nedskrivningar','R9/R10'], ['7810','Avskrivningar på immateriella anläggningstillgångar','R10'],
      ['7820','Avskrivningar på byggnader och markanläggningar','R9'], ['7830','Avskrivningar på maskiner och inventarier','R10'],
      ['7970','Förlust vid avyttring av immateriella och materiella anläggningstillgångar','R6'], ['7980','Ersättningsfonder','R9/R10']
    ]},
    { code: '8–9', title: 'Finansiella och andra inkomster/intäkter och utgifter/kostnader', accounts: [
      ['8310','Ränteintäkter och utdelningar','R4'], ['8314','Skattefria ränteintäkter','R4'], ['8330','Valutakursdifferenser på fordringar och placeringar','R4'],
      ['8410','Räntekostnader för skulder','R8'], ['8430','Valutakursdifferenser på skulder','R8'], ['8990','Resultat','R11'], ['8999','Årets resultat','R11']
    ]}
  ];
  const accounts = sections.flatMap(section => section.accounts.map(([code, name, row]) => ({ code, name, row, section: section.title })));
  const byCode = Object.fromEntries(accounts.map(account => [account.code, account]));
  function search(query = '') {
    const term = String(query).trim().toLocaleLowerCase('sv');
    return term ? accounts.filter(account => `${account.code} ${account.name} ${account.section}`.toLocaleLowerCase('sv').includes(term)) : accounts;
  }
  return { version: 'BAS Förenklat årsbokslut (K1) – Kontoplan 2018', sections, accounts, byCode, search };
});
