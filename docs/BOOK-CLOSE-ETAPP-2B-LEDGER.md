# Bokslut P1B – serverbaserad huvudbokskontroll (första del)

Huvudärende: #745. Utgångspunkt: GitHub main efter PR #748. Den här etappen är en **läsbaserad integritetskontroll** – inte ett färdigställt bokslut.

## Vad som faktiskt kontrolleras

En enda PostgreSQL-fråga i `public.book_close_ledger_integrity(company, start, end)` sammanställer **alla** verifikationer och tillhörande kontorader i den valda perioden (inklusive >1 000 rader). Den skickar tillbaka aggregerad information, inte ett urval av verifikationer eller alla privata rader.

- Antal verifikationer och tillhörande kontorader i perioden.
- Antal verifikationer med färre än två rader.
- Antal verifikationer där debet och kredit inte balanserar.
- Antal kontorader med saknat/ogiltigt 4-siffrigt kontonummer, negativt belopp, två debet/kredit samtidigt, noll på båda sidor eller saknat belopp.
- Antal grupper med dubbelt verifikationsnummer inom serien och perioden (indikation som behöver utredas).
- Antal kontorader utan motsvarande verifikation inom företaget **över alla datum**, eftersom årsavgränsning annars inte kan härledas från en föräldralös rad.
- Summerat debet och kredit för perioden samt nettorrörelser för 1510, 1630, 1930, 1940, 2440 och 2650.

Pengar aggregeras som PostgreSQL `numeric` i heltalsören och returneras som text. Webbläsaren använder `BigInt` för presentation, så belopp rundas inte av i JavaScript.

## Säkerhet och bevisvärde

- `SECURITY INVOKER` bevarar befintliga RLS-policier; anropet har dessutom uttryckligt krav på personlig auth-session, AAL2/MFA och medlemskap i det angivna företaget.
- Public/anon saknar EXECUTE. Ingen ny tabell, filbehörighet eller ekonomisk skrivning skapas.
- Perioden måste ha giltiga datum och omfatta högst 18 månader.
- Alla beräkningar i funktionen sker i **en SQL-statement-snapshot**. Det är **inte** en signerad, låst eller oföränderlig arkiverad ögonblicksbild. En ny körning kan visa andra värden när bokföringen förändras.
- Servern returnerar `NULL` utan aktiv behörighet; frontenden visar då **kontrollen kunde inte verifieras**, aldrig godkänd status.
- Status `not-yet-reconciled` betyder enbart att den tekniska kontrollen inte hittade dessa fel. Den betyder inte att siffrorna är korrekta eller att bokslutet är klart.
- Kontobelo­ppen är periodens **rörelse**, inte utgående balanser inklusive tidigare år, och får därför inte presenteras som avstämda värden.

## Fortfarande kvar i etapp P1B

1. **Verkligt räkenskapsår**, inklusive brutna år och rätt regelversion, i stället för kalenderårets kontrollformulär.
2. Kontinuitet för IB/UB och företagets kända datahistorik vid systembyte.
3. Matchning av huvudbokskonto 1930/1940 mot **daterat externt kontoutdrag**; 1510/2440 mot fakturor/krediter och betalningar; 2650/1630 mot momshistorik och skattekonto.
4. Periodlås, väntande buntar och dokumentkällbevis som är tidsskopade och beslutade för hela året.
5. Hållbar snapshot med hash och regelversion, audit och attest för nästa etapp. Ingen myndighetsinlämning eller årslås automatiseras här.

## Test och driftsättning

Test: `test/book-close-ledger.test.js` samt befintliga browser-smoke-tester. Obligatoriska Quality, CodeQL och Supabase clean rebuild på PR. Efter merge måste migrationen tillämpas enligt det etablerade GitHub ↔ Supabase-paritetsflödet och därefter verifieras med två **syntetiska** separata inloggade företag i staging. GitHub Pages-publikationen ensam installerar inte en databas-RPC; tills den är installerad visar UI ett säkert felmeddelande.

Ingen verklig kunddata får läggas i GitHub, testloggar eller PR.