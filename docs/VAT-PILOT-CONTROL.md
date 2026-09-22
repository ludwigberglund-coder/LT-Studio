# Moms – pilotkontroll för referenskunden

Senast verifierad: 2026-09-21.

Detta dokument beskriver den tekniska momsavstämningen inför referenskunden pilot. Det är inte ett intyg om att systemet kan skapa eller lämna en fullständig svensk momsdeklaration.

## Primära källor

- Skatteverket – Momssatser och undantag från moms:
  https://www.skatteverket.se/foretag/moms/saljavarorochtjanster/momssatspavarorochtjanster.4.58d555751259e4d66168000409.html
- Skatteverket – Momslagens regler om fakturering:
  https://www.skatteverket.se/foretagochorganisationer/moms/saljavarorochtjanster/fakturering.4.58d555751259e4d66168000403.html
- Mervärdesskattelag (2023:200):
  https://www.riksdagen.se/sv/dokument-och-lagar/dokument/svensk-forfattningssamling/mervardesskattelag-2023200_sfs-2023-200/

## Regler som direkt påverkar referenskunden

Från och med 1 april 2026 är momsen normalt 6 procent på livsmedel. Fram till och med 31 mars 2026 var den normalt 12 procent. Restaurang- och cateringtjänster är fortsatt 12 procent. Normalskattesatsen är 25 procent.

Det betyder att systemet inte får anta att all mat alltid har samma momssats. Klassificeringen beror både på vad som säljs och, för livsmedel, relevant tidpunkt.

En fullständig faktura ska bland annat kunna visa beskattningsunderlag för varje momssats, tillämpad momssats och momsbelopp.

## Vad momsrapporten kontrollerar efter denna ändring

Momsöversiktens huvudbelopp hämtas från den faktiskt bokförda huvudboken, inte från fakturaregistrens summeringsfält.

För nuvarande inhemska normalflöden klassificeras:
- 2611 som utgående moms 25 procent
- 2621 som utgående moms 12 procent
- 2631 som utgående moms 6 procent
- 2641 som ingående moms

För kund- och leverantörsfakturor som har en källanknuten verifikation jämför systemet fakturans sparade momsbelopp med momsbeloppet i den faktiska verifikationen. En differens flaggas uttryckligen.

Andra aktiva 26xx-konton än de uttryckligen stödda kontona klassificeras inte automatiskt. De visas som ej klassificerade och gör kontrollen ofullständig.

## Vad kontrollen inte gör ännu

Rapporten är fortsatt markerad som inte deklarationsklar. Följande behöver verifieras eller avgränsas innan pilotens momsperiod kan betraktas som komplett:

1. Företagets faktiska redovisningsmetod och momsperiod.
2. Datum- och verksamhetsstyrd klassificering mellan livsmedel 6 procent, restaurangtjänst 12 procent och andra varor/tjänster.
3. Delkrediter och andra ändringsfakturor utöver den nu verifierade helkrediteringen. Helkreditering av en livsmedelsfaktura från före 1 april 2026 är verifierad att återföra originalets 12-procentiga moms även när kreditfakturan utfärdas efter att den nya 6-procentiga satsen börjat gälla.
4. EU-handel, import, omvänd betalningsskyldighet och andra särskilda momskoder. Dessa är fortsatt inte automatiskt klassificerade; kända ej stödda 26xx-konton gör momsavstämningen fail-closed och perioden markeras inte som deklarationsklar.
5. Periodisering/tidpunkt för leverantörsfakturor enligt vald redovisningsmetod.
6. Avstämning av eventuella ingående balanser och konto 2650 när momsperioden avslutas.

Pilotprincipen är fail closed: ett okänt momsfall ska granskas manuellt och får inte automatiskt klassificeras som om det vore ett vanligt svenskt 25/12/6-procentsfall.


## Kundfakturans momsbehandling

I det privata kundfakturaflödet väljer användaren nu vilken typ av försäljning raden avser. Systemet härleder momssatsen från den verifierade regeln och fakturadatumet i stället för att låta användaren skriva eller välja en fristående momssats.

För den nu verifierade pilotavgränsningen finns:
- `se-food`: livsmedel, 12 procent till och med 2026-03-31 och 6 procent från 2026-04-01.
- `se-restaurant-12`: restaurang-/cateringtjänst, 12 procent.
- `se-standard-25`: övrig vara/tjänst inom normal 25-procentsmoms.

Backend kräver klassificeringen när en verklig kundfaktura utfärdas. Om den angivna momssatsen motsäger klassificeringen, eller intäktskontot inte passar den härledda momssatsen, stoppas bokföringen.

Reglerna i programmet är verifierade till och med 2027-12-31. Livsmedel använder 6 procent under resten av 2026 och hela 2027 enligt den verifierade regelperioden. Fakturor från 2028-01-01 blockeras tills regelverket har kontrollerats på nytt. Det är striktare än att gissa att en tillfällig eller ändrad regel fortfarande gäller.

Detta täcker inte momsfri omsättning, EU-handel, export, import, omvänd betalningsskyldighet eller andra specialfall. Sådana fall ska fortfarande hanteras utanför det automatiska pilotflödet tills de uttryckligen stöds och testas.


## Verifiering 21 september 2026

Automatiska regressionstester verifierar nu följande gränsfall:

- en livsmedelsfaktura den 31 mars 2026 använder 12 procent,
- en helkredit den 2 april 2026 återför samma 12-procentiga moms och samma ursprungliga momskonto i stället för att räknas om till 6 procent,
- en ny livsmedelsfaktura den 3 april 2026 använder 6 procent,
- aprilperioden kan samtidigt innehålla negativ 12-procentig utgående moms från krediten och positiv 6-procentig utgående moms från ny försäljning,
- källavstämningen kräver att kreditfakturans negativa momsbelopp exakt stämmer med den bokförda återföringen,
- aktivitet på konto 2650 gör kontrollen fail-closed, eftersom rapporten ännu inte kan skilja transaktionsmoms från en genomförd momsavräkning utan särskild periodavslutslogik,
- konton för ännu ej stödda specialfall, exempelvis 2614 och 2645, klassificeras inte som vanlig svensk 25/12/6-procentsmoms utan gör kontrollen ofullständig.

Detta innebär inte att EU-handel, import eller omvänd betalningsskyldighet är implementerade för automatisk momsdeklaration. Tvärtom är verifieringen till för att bevisa att systemet inte gissar i dessa fall.


## Leverantörsfakturans momsbehandling

Det privata leverantörsfakturaflödet är nu fail-closed för moms.

Den automatiska pilotvägen accepterar endast den uttryckliga klassningen `se-domestic-full-input-vat`, vilket betyder en svensk leverantörsfaktura i SEK där hela det angivna positiva momsbeloppet bedöms vara avdragsgillt i det här verifierade normalflödet.

Klassningen:

- väljs uttryckligen i registreringsvyn,
- valideras igen i API:t,
- sparas på leverantörsfakturan,
- sparas i registreringens auditdetaljer,
- visas i leverantörsfakturans arbetsyta,
- krävs igen innan leverantörsskulden får bokföras genom det privata API:t.

Saknad eller annan klassning, noll moms, EU-fall, import, omvänd betalningsskyldighet, momsfritt och begränsad avdragsrätt stoppas innan automatisk registrering/bokföring. Dessa fall ska hanteras utanför pilotens automatiska leverantörsflöde tills separata regler och tester finns.

Detta är en säkerhetsavgränsning, inte ett påstående om att alla svenska leverantörsfakturor har full avdragsrätt.
