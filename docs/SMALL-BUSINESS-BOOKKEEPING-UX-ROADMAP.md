# LT Studio – enklare bokföring för småföretagare

Datum: 2026-10-12 · status: produktplan och första avgränsade UAT-etapp.
Övergripande ärende: [#727](https://github.com/ludwigberglund-coder/LT-Studio/issues/727).
Parallellt dokument-/PDF-spår: [#728](https://github.com/ludwigberglund-coder/LT-Studio/issues/728).

## Vision

LT Studio ska kännas som en ekonomisk assistent. Företagaren ska förstå *vad som behöver göras*, *varför* och *vilka följder en åtgärd får* utan krav på kunskaper om debet/kredit. De riktiga konteringarna, underlagen, buntarna och kontrollspåren måste fortsatt finnas kvar för granskning. Målet att 90–95 % av återkommande vardagsmoment ska kunna hanteras utan kontoplanskunskap är **en ambition som ska mätas i användartest**, inte en produktutfästelse.

Repo och kod är sanningskälla för implementation; Supabase är sanningskälla för företagens affärsdata. GitHub är **publikt**, så ingen riktig kunddata, faktura, kvitto, hemlighet eller autentiseringsuppgift får hamna där. UAT är endast för syntetiska uppgifter och är inte godkänd för skarp bokföring.

## Åtta förbättringar och prioritering

| Ordning | Förbättring | Första konkreta leverans | Skyddsregel |
| --- | --- | --- | --- |
| 1 | Smart start med tydlig dagslista | En prioriterad första uppgift och korrekta köantal; ofullständiga läsningar får aldrig betyda "klart" | Läsning, ingen automatisk ekonomisk mutation |
| 2 | PDF-kvitto-/underlagsinkorg | Befintliga PDF-underlag visas begripligt och kopplas rätt; senare säkra förslag | **Endast passiv PDF** enligt `AGENTS.md`; bild/OCR kräver separat beslut |
| 3 | Konteringsassistent som utgår från granskade historiska val | Förklarade, frivilliga förslag för återkommande leverantörer | Ingen tyst bokföring; fel moms och avdrag ska förhindras |
| 4 | Smartare bankmatchning | Visa matchningsskäl, rätt faktura och säkert omval för omatchad betalning | Arbeta med aktiva betalnings-PR:er; idempotens och buntgodkännande bevaras |
| 5 | Guide för att stänga månaden | Checklista för underlag, bank, fakturor och periodstatus | Inget nytt direktskrivande periodlås |
| 6 | Bokföring med vardagliga ord | Handlingsspråk, återkoppling och valfri fördjupning till BAS-konto | Bokföringsmässig transparens och revisionsspår bevaras |
| 7 | Kassaflöde i klarspråk | Utstående fakturor, planerade betalningar, framtida behov | Prognos tydligt skild från bokfört saldo och fastställda skatter |
| 8 | Kontrollera fel innan de bokförs | Flagga dubbletter, saknade underlag, avvikelser och periodspärrar | Mänsklig kontroll och inga destruktiva genvägar |

## Implementation – första leveransen

`apps/portal/dashboard.js`, `dashboard.css` samt dashboard-tester är **Chat A:s avgränsade filer**.

- Visa rekommenderad första handling i existerande arbetslista; skicka användaren vidare till befintlig modul.
- Räkna öppna ärenden från de befintliga köerna i stället för att kalla antalet visade kort för antal saker.
- Om någon kö inte går att läsa: visa att översikten är ofullständig. Tysta fel ska aldrig ge grönt "allt klart".
- Uppgifterna är läsbaserade. Att öppna en arbetslista skapar ingen verifikation.
- Bevara upp till sex kort, befintlig navigering, demo/privat/Supabase-läge, ljust/mörkt läge och mobil.
- Verifiera med Node-unit, dashboard-browser-smoke, full CI, CodeQL och Supabase clean rebuild.

## Nästa skarpa utvecklingsetapp (efter grön och mergad dashboard-PR)

1. Förbättra tydliga slutförandestatusar i verkliga flöden för betalningar, fakturor och buntar – först efter att befintliga öppna PR:er är färdiga.
2. Mät 3–5 typiska syntetiska arbetsflöden (kundfaktura → inbetalning → matchning → godkänd bunt → rapport) och dokumentera antal klick och tveksamheter.
3. Ta ställning till vilka förslag som kan göras utan nya tredjepartskostnader eller breda databasändringar.
4. Prioritera säkerhet och produktionskrav enligt [#630](https://github.com/ludwigberglund-coder/LT-Studio/issues/630) före verkliga ekonomidata.

## Parallellt spår – separat Chat B

Se [#728](https://github.com/ludwigberglund-coder/LT-Studio/issues/728). Agent B äger inventering och första UX-förbättringar av den säkra **PDF-underlagsinkorgen**, inte dashboarden. Arbeta i separata branches från senaste `main`. Samordna innan gemensamma filer ändras. Inga JPG/PNG, fotokvitto, OCR eller AI-baserad autobokföring i första etappen. Följ befintliga `AGENTS.md`, företagsspärrar, PDF-säkerhetskontroll och all CI.

## Klart-kriterier

- Ingen falsk "allt klart"-signal vid läsfel.
- Första rekommenderade handlingen öppnar rätt befintlig arbetsmodul.
- Köantalet mäter öppna ärenden, inte antal visade kategorier.
- Inga ändringar av ekonomiska skrivflöden, migrations eller kunddata i denna PR.
- Grön Quality, CodeQL och Supabase clean rebuild på rätt PR-commit, efterföljt av merge och UAT-visuell kontroll.
