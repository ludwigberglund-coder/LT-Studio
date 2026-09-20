# Exakt PDF-arkiv för kundfakturor

Detta dokument beskriver den avgränsade arkivkontrollen som införs i PR 91. Den ersätter inte en fullständig långtidsarkiv- eller driftpolicy.

## Vad som nu sparas

När en kundfaktura eller helkredit utfärdas i den privata backendmiljön sparas två separata underlag:

1. Det strukturerade fakturaunderlaget i JSON-format, med eget SHA-256-fingeravtryck.
2. De exakta PDF-bytes som fakturamotorn genererade vid utfärdandet, med eget SHA-256-fingeravtryck och byteantal.

Den senare filen är den PDF som systemet därefter visar för en redan utfärdad faktura. Portalen genererar alltså inte om en historisk faktura varje gång användaren öppnar den.

## Varför nummerreservation används

PDF-genereringen är asynkron medan bokföringen ska vara atomisk. Systemet gör därför arbetet i följande ordning:

1. Validera företag, kund, datum, moms och bokföringsperiod.
2. Reservera ett fakturanummer för request-ID:t.
3. Generera PDF med det reserverade numret.
4. I en slutlig databastransaktion skapa fakturan, verifikationen, JSON-underlaget, det exakta PDF-arkivet, request-kopplingen och revisionshändelsen.
5. Markera nummerreservationen som utfärdad.

Om PDF-genereringen eller sluttransaktionen misslyckas lämnas ingen halvfärdig bokförd faktura. Reservationen finns kvar så samma oförändrade request kan återupptas med samma fakturanummer. Samma request-ID med annat innehåll nekas som konflikt.

## Integritetskontroller

Vid läsning av en arkiverad PDF kontrolleras:

- rätt företag,
- att filen finns,
- att storleken stämmer,
- att innehållet börjar med PDF-signaturen,
- att SHA-256-fingeravtrycket fortfarande stämmer.

Vanliga applikationsoperationer kan inte skriva om eller radera en färdig PDF-arkivrad.

## Kreditfakturor

Helkreditering av en obetald kundfaktura använder samma modell. Kreditfakturan får:

- ett eget reserverat löpnummer,
- ett eget strukturerat underlag,
- en egen exakt PDF,
- en egen verifikation,
- koppling till ursprungsfakturan,
- revisionsspår.

Kreditering stoppas om den ursprungliga fakturans nödvändiga underlag, bokföring eller exakta PDF-arkiv inte kan verifieras.

## Vad detta INTE löser

Detta är ett lokalt, privat SQLite-arkiv för pilotplattformen. Följande återstår före slutligt pilotgodkännande:

- krypterad extern/offsite-arkiv- och backupdestination,
- definierad retention över hela lagstadgade bevarandetiden,
- verifierad arkivexport,
- verifierad återläsning efter flera versions-/driftbyten,
- behörighets- och incidentrutiner hos faktisk driftleverantör,
- dokumenterad katastrofåterställning av hela arkivet.

En SHA-256-kontroll är ett integritetsbevis, inte en ersättning för säker lagring, backup eller långtidsarkivering.
