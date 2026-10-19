# LT Studio – releasegrind för serververifierat PDF-arkiv

**Spårning:** Issue #843 · PR #845 (staplad ovanpå PR #841)  
**Status:** kod under granskning; **inte** driftsatt i UAT/produktion. GitHub `main` är sanningskällan.

## Säkerhetsmodell

Kundportalen får inte skapa färdiga original direkt i Supabase. `apps/portal/documents.js` skickar en multipart-PDF till `archive-document-upload` med personlig JWT. Edge-funktionen verifierar JWT via Supabase Auth, AAL2/MFA och aktuell roll `admin`/`accountant` i exakt företag. Därefter använder den **samma** `_shared/passive-pdf.ts` som befintlig kundfakturaverifiering: PDF-only, max 10 MiB, header, EOF, förbjuden aktiv eller krypterad PDF och djup kontroll genom pdf-lib.

Servern väljer dokument-ID och objektväg; den accepterar inte sökväg från webbläsaren. Endast efter innehållskontroll och uppladdningskvot skrivs filen till privat Storage; filen läses tillbaka och SHA-256 verifieras innan ett färdigt original registreras med service-rollens **serverhemlighet**. Företagsmedlemskap kontrolleras på nytt före metadata. Klienten har aldrig tillgång till serverhemligheten.

Migrationen spärrar `authenticated INSERT` direkt i `public.documents` och inför en **restriktiv** Storage-policy mot browserinsättning i `<company>/documents/`. Fakturans befintliga separat verifierade stagingmappar `customer-invoices` och `customer-credit-notes` behålls. Databaskvoten är atomisk per företag: max 4 per minut och 40 per dag per användare, max 12 per minut och 100 per dag per företag (alla tidsfönster beräknas av databasen). Ingen service-role-nyckel får nå webbläsaren.

Samma användar- och företagsbundna `requestId` ger samma dokument-ID. Om en tidigare version finns jämförs all metadata och den säkrade hash-summan innan servern kan bekräfta en lyckad retry. En ny `requestId` med identisk SHA-256 nekas för att minska risk för dubbla original. Om en skrivning inte kan bekräftas undersöks registrerat original före eventuell orphan-städning; servern får aldrig radera en bekräftat arkiverad PDF för att en nätverksrespons gick förlorad.

**Kvarvarande försiktighetskrav:** privata Storage-RLS-policyer och serverauktorisering är obligatoriska även om klienten visar ett korrekt företag. Äldre original kan ha laddats upp via den gamla klientvägen; dessa är **inte retroaktivt säkerhetsverifierade** av PR:n och måste inventeras med faktisk filkontroll före bred release. En möjlig kvarvarande orphan i Storage vid en oklar/förlorad uppladdningsrespons får inte automatiskt betraktas som säkert raderad.

## Mergeordning och deploy

1. Få **oberoende granskning** av #841 och merga den först. Läs därefter nyaste GitHub `main` och verifiera diff och konfliktfrihet för #845. Håll #842:s separata CSS visuellt kompatibel.
2. För #845 krävs alla tre gröna kontroller på **aktuell HEAD**: Quality (inklusive autentiska syntetiska multipart-anrop), CodeQL och Supabase clean rebuild med pgTAP RLS-/kvottester. Granska även att befintlig kundfaktura-Edge fortfarande använder samma oförändrade PDF-kontroll.
3. I **staging** (syntetisk data, inga riktiga kundfiler), deploya Edge-funktionen och den befintliga uppdaterade `verify-customer-invoice-document`, följt av migration/Storage-policy och frontend. Säkerställ att `[functions.archive-document-upload] verify_jwt=true` verkligen gäller i hostad miljö.
4. Testa två skilda företag med personliga MFA-inloggningar: normal passiv/skannad PDF, manipulerad header/EOF, PDF med `/JavaScript`, `/OpenAction` och indirekt objekt, HTML/ZIP/Office, 10 MiB-gräns, rollen viewer, token-/företagsbyte mitt under laddning, ovanlig svensk filnamn, multiline-kommentar, dubbelklick/identisk retry och metadata-konflikt.
5. Verifiera på den **hostade** staging-API:n att browser-rollen får nekad direkt `INSERT` i `public.documents` och direkt `Storage POST` i `documents/`, men att befintligt fakturaflöde fortfarande fungerar med verifieringsbiljett. Testa kvot (429) och server-side Storage read-back/cleanup utan att röra skarpa objekt.
6. Inventera äldre arkivobjekt och deras metadata/hashar före kundrelease. Separera osäkra/okända PDF:er för manuell undersökning, men ändra/radera aldrig ekonomiska original utan separat lagrings-/retentionsplan.
7. Produktionssätt upp först efter formellt säkerhetsgodkännande och releasebeslut. Synkronisera Edge, SQL-policy och klient inom ett kontrollerat releasefönster; en partiell release får hellre **neka uppladdning** än återöppna osäker direktinsättning. Kontrollera reala releaseflaggor och loggar utan att publicera hemligheter.

## Övervakning och återhämtning

Följ endast aggregat per kod (`INVALID_PDF_STRUCTURE`, `ACTIVE_PDF_CONTENT_NOT_ALLOWED`, `ACCESS_DENIED`, `UPLOAD_RATE_LIMITED`, `STORAGE_READBACK_FAILED`, `ARCHIVE_INSERT_UNCONFIRMED`, `ARCHIVE_CLEANUP_UNCONFIRMED`). Logga inte filbytes, personidentifierare, JWT, servernyckel, interna objektvägar eller fakturainnehåll.

Om ett framtida uppladdningsfel är tvetydigt: kontrollera dokumentarkivet med samma förfrågnings-ID innan nytt försök. Inga automatiska raderingar av bekräftade original. Vid problem med utrullning: inaktivera **uppladdningsvägen** tillfälligt och behåll spärren mot direkt client storage; återinför aldrig den gamla browser-uppladdningen som snabbfix.

## Avgränsning

Ingen riktig AI-provider, automatisk verifikation, betalning, momsändring eller produktionsaktivering ingår i PR #845. Detta är en säkerhetsförutsättning för kommande AI-bokföring, inte bevis att fullständig automatisk bokföring redan är klar.
