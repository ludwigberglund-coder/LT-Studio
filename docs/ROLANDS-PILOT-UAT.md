# Rolands Pilot UAT

Detta dokument är en manuell kontrollista inför en kontrollerad första pilot hos Rolands. Den ska kunna följas av en person utan kodkunskap.

## Förutsättningar

- Använd endast test- eller pilotdata tills ansvarig har godkänt produktionsstart.
- Kör `npm run pilot:check` innan UAT påbörjas.
- Använd separata användare för moment där fyrögonprincip krävs.
- Spara testdatum, användare och eventuella avvikelser i ett separat UAT-protokoll.
- En avvikelse i bokföring, reskontra, behörighet eller backup/restore är blockerande tills den är utredd.

## Scenario A – leverantörsfaktura

1. Skapa eller välj en leverantör.
2. Registrera en leverantörsfaktura med belopp, moms, datum och PDF-underlag.
3. Kontrollera att fakturabelopp och moms stämmer mot underlaget.
4. Kontera fakturan och spara konteringen.
5. Attestera med en annan behörig användare där fyrögonprincip gäller.
6. Bokför leverantörsskulden.
7. Kontrollera att verifikationen är balanserad och att 2440 krediterats med hela fakturabeloppet.
8. Kontrollera leverantörsreskontran: öppet belopp ska motsvara fakturans obetalda belopp.
9. Förbered betalningen.
10. Frisläpp betalningen med korrekt behörighet.
11. Registrera bankbekräftelse och bokför betalningen.
12. Kontrollera att betalningsverifikationen debiterar 2440 och krediterar valt bankkonto, normalt 1930.
13. Kontrollera att öppet reskontrabelopp är 0 efter full betalning.
14. Kontrollera att den sammanlagda påverkan på 2440 för faktura + betalning är 0.
15. Kontrollera huvudbok och relevanta rapporter mot samma verifikationer.

**Godkänt när:** exakt en fakturaverifikation och exakt en betalningsverifikation finns, båda är balanserade, reskontran är korrekt och originalhistoriken finns kvar.

## Scenario B – kundfaktura

1. Skapa eller välj en kund.
2. Skapa en kundfaktura och kontrollera fakturadatum, förfallodatum, moms och total.
3. Bokför/utfärda fakturan enligt det befintliga kundflödet.
4. Kontrollera att kundfordran på 1510 motsvarar öppet fakturabelopp.
5. Registrera en betalning eller bankmatchning mot fakturan.
6. Kontrollera att kundreskontrans öppna belopp minskar med betalningen.
7. Vid full betalning: kontrollera att öppet belopp är 0.
8. Kontrollera huvudbok och relevant rapport mot samma bokföringsposter.

**Godkänt när:** kundreskontra, 1510 och huvudbok visar samma ekonomiska verklighet och inga dubbla verifikationer skapas.

## Scenario C – felrättning

1. Välj en redan bokförd testpost.
2. Skapa en kontrollerad rättelse/motverifikation genom systemets befintliga rättelseflöde.
3. Kontrollera att originalverifikationen fortfarande finns kvar och inte har skrivits över.
4. Kontrollera att motverifikationen tydligt refererar till rättelsen.
5. Kontrollera revisionshistoriken.

**Godkänt när:** originalet är oförändrat, rättelsen är spårbar och summan av original + rättelse är begriplig i huvudboken.

## Scenario D – periodlås

1. Lås en testperiod.
2. Försök bokföra en ekonomisk post i den låsta perioden.
3. Verifiera att bokföringen stoppas och att ingen halvfärdig data har skapats.
4. Begär upplåsning enligt befintlig process.
5. Godkänn upplåsningen med en annan behörig person där fyrögonprincip krävs.
6. Kontrollera historiken över låsning och upplåsning.
7. Bokför därefter den avsedda testposten.

**Godkänt när:** låst period verkligen blockerar bokföring och upplåsningen är spårbar.

## Scenario E – dubbeltryck/idempotens

1. Välj en ekonomisk operation som skapar en verifikation, till exempel bokföring av leverantörsfaktura eller betalning.
2. Skicka samma operation två gånger så nära varandra som praktiskt möjligt, exempelvis genom dubbelklick eller direkt återförsök.
3. Kontrollera verifikationslistan.
4. Kontrollera reskontran.
5. Kontrollera audit/revisionshändelser.

**Godkänt när:** exakt en ekonomisk bokföringsoperation har skapats och saldon inte påverkas dubbelt.

## Scenario F – backup och restore

Det automatiska backup/restore-testet ingår i `npm run pilot:check`.

Manuell pilotkontroll:
1. Skapa en säkerhetskopia enligt driftinstruktionen för den verkliga pilotmiljön.
2. Återställ kopian till en separat testdatabas, aldrig ovanpå produktionsdatabasen.
3. Starta en separat testinstans mot den återställda databasen.
4. Kontrollera ett urval kunder, leverantörer, reskontraposter och verifikationer.
5. Kontrollera att journalnummer och saldon är oförändrade.

**Godkänt när:** återställd databas kan öppnas och centrala ekonomiska poster är oförändrade.

## Scenario G – företagsskydd

1. Logga in som användare kopplad till ett testföretag.
2. Försök inte manipulera URL:er i normal UAT. Den automatiska testsviten gör detta programmässigt.
3. Verifiera att `npm run pilot:check` har passerat company-isolation-testet.

**Godkänt när:** testet visar att ett företag inte kan läsa kund-, leverantörs-, faktura-, bokförings- eller dokumentdata från ett annat företag.

## Slutlig pilotbedömning

Markera inte piloten som klar enbart för att denna checklista är genomförd. Följande ska samtidigt vara uppfyllt:

- `npm run pilot:check` är grön.
- Inga kända blockerande fel finns i bokföring, behörighet, backup/restore eller företagsisolering.
- GitHub Pages innehåller endast demo/testdata.
- Verkliga secrets och verklig Rolands-data ligger utanför GitHub.
- Driftmiljön har separat backupmål och dokumenterad återställningsrutin.

Resultat ska anges som antingen **NOT READY** eller **READY FOR CONTROLLED ROLANDS PILOT**.
