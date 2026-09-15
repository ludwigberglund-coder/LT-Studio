# Verifikations- och perioddomän

## Syfte

`packages/accounting/journal.js` är den nya gemensamma kärnan för verifikationer, periodlås och spårbara rättelser. Modulen är fristående från gränssnitt och databas så att samma regler senare kan användas av:

- Projektadmin,
- produktions-API,
- fakturering och reskontra,
- bankimport,
- lager och lön,
- tester och datamigreringar.

Modulen använder två tidigare grundlager:

- `packages/accounting/money.js` för säkra heltal i ören,
- `packages/access-control/authorization.js` för roll- och behörighetskontroll.

## Grundregler

En bokförd verifikation måste:

1. ligga inom valt räkenskapsår,
2. ha minst två konteringsrader,
3. använda fyrsiffriga konton,
4. lagra debet och kredit som heltal i ören,
5. ha exakt lika mycket debet som kredit,
6. ha en personlig skapare och en giltig tidsstämpel,
7. få ett obrutet löpnummer inom serie och år,
8. bokföras i en öppen period.

Alla operationer returnerar ett nytt state. Det inkommande state-objektet ändras inte.

## Skapa en huvudbok

```js
const Journal = require('./packages/accounting/journal.js');

const ledger = Journal.createLedger({
  fiscalYearStart: '2026-01-01',
  fiscalYearEnd: '2026-12-31',
  defaultSeries: 'A'
});
```

Detta skapar en tom huvudbok med:

- räkenskapsår,
- verifikationslista,
- nummerserier,
- periodstatus,
- rättelsekopplingar,
- behandlingshändelser.

## Bokföra en verifikation

```js
const result = Journal.postEntry(ledger, {
  date: '2026-09-15',
  description: 'Inköp av handelsvaror',
  source: {
    type: 'supplier-invoice',
    reference: 'VF-1001'
  },
  rows: [
    {account: '4010', debitOre: 100000, creditOre: 0},
    {account: '2641', debitOre: 12000, creditOre: 0},
    {account: '2440', debitOre: 0, creditOre: 112000}
  ]
}, {
  actor,
  access: accessModel,
  idFactory,
  now: new Date().toISOString()
});
```

Användaren måste ha `accounting.post`. Modulen kontrollerar behörigheten före numrering och bokföring.

## Rättelser

Bokförda poster skrivs aldrig över. `correctEntry` skapar i stället:

1. en ny motverifikation som vänder ursprungspostens debet och kredit,
2. valfritt en ny ersättningsverifikation,
3. en rättelsekoppling mellan original, motpost och ersättningspost,
4. en behandlingshändelse med person, tid och orsak.

```js
const corrected = Journal.correctEntry(ledger, {
  entryId: originalEntryId,
  date: '2026-09-16',
  reason: 'Fel kostnadskonto användes',
  replacement: {
    description: 'Rättat inköp av handelsvaror',
    rows: correctedRows
  }
}, {
  actor,
  access: accessModel,
  idFactory,
  now: new Date().toISOString()
});
```

Användaren måste ha `accounting.correct`. Samma ursprungspost kan inte rättas två gånger genom samma rättelseflöde.

## Periodlås

`lockPeriod` kräver `period.lock`. Efter låsning stoppas nya verifikationer med bokföringsdag i perioden.

```js
const locked = Journal.lockPeriod(ledger, '2026-09', {
  actor,
  access: accessModel,
  reason: 'September är avstämd och klar',
  now: new Date().toISOString()
});
```

Upplåsning kräver:

- `period.unlock`,
- en motiverad orsak,
- en annan person som begär upplåsningen,
- godkänd separationsregel `period-unlock`.

```js
const opened = Journal.unlockPeriod(locked.state, '2026-09', {
  actor: controller,
  access: accessModel,
  requestedBy: accountant.id,
  reason: 'En felkontering behöver rättas',
  now: new Date().toISOString()
});
```

Låsning och upplåsning bevaras i periodens historik.

## Integritetskontroll

`validateLedger` kontrollerar bland annat:

- dubbletter av id och verifikationsnummer,
- ogiltiga datum, konton och belopp,
- obalanserade poster,
- manipulerade totalsummor,
- felaktig koppling mellan nummer, serie och löpnummer,
- nummerserier som ligger efter bokförda poster,
- felaktiga periodposter,
- brutna rättelsekopplingar.

```js
const report = Journal.validateLedger(ledger);
if (!report.ok) console.error(report.errors);
```

`assertLedger` används när ett fel ska stoppa operationen direkt.

## Projektadmin

GitHub Pages-demon innehåller en interaktiv sida under:

`/admin/#/journal`

Där går det att:

- välja en roll,
- bokföra en balanserad manuell verifikation,
- prova behörighetsnekning,
- låsa och låsa upp period,
- skapa en motverifikation,
- se löpnummer och behandlingshändelser.

Demoändringar sparas endast i webbläsarens `localStorage` och kan återställas. Ingen skarp ekonomidata skickas till GitHub.

## Produktionsgräns

Domänreglerna är en teknisk grund, inte en färdig produktionsbokföring. Före skarp drift behövs fortfarande:

- transaktionsdatabas,
- databaslåsning och idempotens mellan flera serverinstanser,
- fullständig och verifierad kontoplan,
- originalunderlag och bilagearkiv,
- permanent och externt förankrad behandlingshistorik,
- verifierade migreringar och återläsningstester,
- riktiga personliga konton och MFA,
- redovisningsmässig granskning av hela flödet.
