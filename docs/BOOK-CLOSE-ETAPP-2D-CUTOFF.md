# Bokslut #745 – etapp P1D: bokförda rörelser och preliminärt värde vid periodslut

## Ägarskap
Utgångspunkt GitHub `main` `0a24e551e5bfdebf5f6df4b8de9fff79fcc6ac77` (12 oktober 2026). Vid start fanns endast Dependabot-PR #719 och #720 öppna. Tidigare #754 för månadsavstämning är redan mergad. Denna etapp ändrar enbart bokslutsmodulens HTML/CSS, nya egna filer/test och en egen versionerad migration; inga bank-/faktura-/månadsflöden ändras.

## Vad implementeras
Den läsbaserade `public.book_close_ledger_cutoff(company, start, end)` räknar över **alla** åtkomliga bokföringsverifikationer före det valda kalenderårets exklusiva slutdatum i **en SQL-statement-snapshot**. Sex BAS-konton visas:
1510 kundfordringar, 1630 skattekonto, 1930 och 1940 bank, 2440 leverantörsskulder och 2650 moms.

För varje konto visas:
1. Summan debet minus kredit före vald period – **ackumulerade bokförda rörelser före året**, inte verifierad ingående balans.
2. Summa debet minus kredit inom vald period.
3. Deras summa – **ackumulerat värde enligt tillgänglig huvudbok före periodens slut**, inte garanterat saldo från företagets verkliga start.

Alla pengar summeras på servern i `numeric` som heltalsören, transporteras som strängar och valideras/visas med `BigInt`, utan flyttalsavrundning eller 1 000-radersbegränsning. Periodfilter har exklusivt slutdatum. Kontrollen visar antal äldre och aktuella verifikationer, första kända bokföringsdatum och antal poster utan datum/med fel på aktuella kontorader.

## Säkerhet
- `SECURITY INVOKER`, befintlig RLS, personlig `auth.uid()`, AAL2-sessionskontroll och företagsmedlemskap. `EXECUTE` endast för `authenticated`, inte `anon`.
- Ingen databasmutation, buntgodkännande, attest, skattemässig klassificering eller extern anslutning.
- En bortfallen session, saknat konto, ändrad tenant, falska tal eller motsägande summeringar leder till **ingen verifierad data** i UI.
- Resultatet är alltid `not_reconciled` och får inte markeras grönt även om belopp blir noll.
- Eftersom historik före systemstart, verifierad IB, utomstående kontoutdrag och historiska faktura-/betalningsbalanser inte finns som fullständiga bevis i denna etapp är saldona **preliminära**.

## Nästa steg
Externa bankutdrag med kontonummer, bokslutsdatum, källa och bekräftad slutsumma; historiska kund-/leverantörsreskontror med korrigerings- och betalningshistorik; kontroll av importerad IB och kontoplan; bokslutsperioder utifrån juridiskt räkenskapsår (även brutna år); reproducerbar snapshotsignering och mänsklig attest.

## Leveranskontroll
GitHub `main` är enda permanenta kodkälla. PR kräver Quality, CodeQL, Supabase clean rebuild och browser-smoke innan merge. Därefter versionsstyrd migration till staging och UAT med verifierad behörighet; två inloggade syntetiska företag är en särskild återstående UAT-kontroll. GitHub Pages-publicering av frontend ensam bevisar inte Supabase-paritet.
