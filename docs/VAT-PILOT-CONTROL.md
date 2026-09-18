# Moms – pilotkontroll för Rolands

Senast verifierad: 2026-09-18.

Detta dokument beskriver den tekniska momsavstämningen inför Rolands pilot. Det är inte ett intyg om att systemet kan skapa eller lämna en fullständig svensk momsdeklaration.

## Primära källor

- Skatteverket – Momssatser och undantag från moms:
  https://www.skatteverket.se/foretag/moms/saljavarorochtjanster/momssatspavarorochtjanster.4.58d555751259e4d66168000409.html
- Skatteverket – Momslagens regler om fakturering:
  https://www.skatteverket.se/foretagochorganisationer/moms/saljavarorochtjanster/fakturering.4.58d555751259e4d66168000403.html
- Mervärdesskattelag (2023:200):
  https://www.riksdagen.se/sv/dokument-och-lagar/dokument/svensk-forfattningssamling/mervardesskattelag-2023200_sfs-2023-200/

## Regler som direkt påverkar Rolands

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
3. Kreditfakturor över en momssatsändring.
4. EU-handel, import, omvänd betalningsskyldighet och andra särskilda momskoder.
5. Periodisering/tidpunkt för leverantörsfakturor enligt vald redovisningsmetod.
6. Avstämning av eventuella ingående balanser och konto 2650 när momsperioden avslutas.

Pilotprincipen är fail closed: ett okänt momsfall ska granskas manuellt och får inte automatiskt klassificeras som om det vore ett vanligt svenskt 25/12/6-procentsfall.
