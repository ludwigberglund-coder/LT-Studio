# Bokslut #745 — P1C: underlagskontroll före bank-/reskontraavstämning

## Ägarskap och konfliktskydd
Granskade öppna PR:er per 2026-10-12: inga aktiva bank-/boksluts-PR:er; öppna #715 (design), #719–720 (dependencies). Aktuella issues #741 (månadsavstämning), #728 (dokumentinkorg), #749 (navigation) har andra ägare. P1C ändrar bara separata bokslutsfiler, egen migration och egna tester. Ingen gemensam navigation, faktura-/betalningsflöden, månadsavstämning eller dokumentinkorg ändras.

## Kontrollens faktiska innebörd
`book_close_evidence_preflight` är en *skrivskyddad* SQL-funktion, med personlig session, AAL2, medlemskap, RLS och företagsskopning. En enda statement-snapshot räknar alla relevanta poster på servern (utan 1 000-radersbegränsning). Den rapporterar:
- Bankhändelser i vald kalenderårsperiod, omatchade eller med väntande förslag, saknad status, annan valuta, noll-/saknat belopp, upprepade externa ID och odaterade bankposter i hela företaget.
- Kundfakturor med bokföringsdatum under perioden, saknad PDF-referens eller beloppsuppgift, samt fakturor med fakturadatum i perioden men utan bokföringsdatum.
- Leverantörsfakturor med bokföringsdatum under perioden, saknad PDF-referens, skuldverifikationsreferens, beloppsuppgift eller avvikande valuta och odaterade bokföringsposter.

**Att en PDF-referens finns betyder inte att själva dokumentfilen har verifierats.** Saknad referens är en underlagsindikator, inte bevis på att underlaget juridiskt saknas.

## Viktiga spärrar
- Ingen historisk restbeloppsberäkning. `remaining_ore` är dagens tillstånd, inte en fordran/skuld per bokslutsdag. Det ska inte jämföras med huvudbokssaldot för ett tidigare räkenskapsår.
- Externt banksaldo saknas. Ingen bankmatchning eller kontroll av 1930/1940 kan markeras godkänd.
- 1510/2440, inklusive historiska betalningar och krediter, saknar verifierad as-of-avstämning.
- Status är alltid `not_reconciled`. Tomt utfall kan inte ge grön slutstatus. Fel, nekad åtkomst och ändrad session gör resultatet okänt.
- Kontrollen gäller kalenderår i nuvarande UI och är inte ett fullständigt verifierat räkenskapsår.
- Ingen ändring, attest eller låsning av ekonomidata, ingen betalning eller kostnadsökning.

## Nästa steg innan riktig avstämning
1. Säkra källbevis för externa bankutdrag och kontoändsaldo daterat på bokslutsdagen.
2. Bygg revisionsbara historiska fordrings-/skuldsaldon från fakturor, krediter och bokförda betalningshändelser, med källa och datum.
3. Beräkna IB/UB med historik, inte enbart kalenderårets rörelse.
4. När dessa bevis finns: jämför differenser i samma serverbaserade snapshot och visa att varje konto är styrkt, med mänsklig granskning.

Migrering måste versionsstyras i GitHub innan installation i Supabase. Efter merge ska staging-UAT med två syntetiska företag och inloggad MFA genomföras.