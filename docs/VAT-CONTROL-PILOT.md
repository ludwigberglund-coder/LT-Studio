# Momsavstämning inför Rolands-pilot

Datum: 2026-09-18. Detta dokument beskriver det tekniska kontrollagret för moms. Det är inte ett beslut om Rolands momsperiod och inte ett intyg om att en momsdeklaration är färdig att lämna.

## Varför ändringen behövs

Den äldre momsöversikten summerade registrerade kund- och leverantörsfakturor. Det kunde ge ett belopp även om en leverantörsfaktura ännu inte var bokförd, och det gick inte att bevisa vilken momskod som låg bakom en rad på 2611, 2621, 2631 eller 2641.

För pilotdata ska momsavstämningen i stället utgå från **bokförda verifikationer**. Varje ny automatisk momsverifikation i de stödda inrikesflödena får därför ett separat, append-only momsbevis som beskriver:

- vilken verifikation beviset tillhör
- intern momskod
- momssats när den är känd
- beskattningsunderlag
- momsbelopp
- momskonto
- relevant ruta i momsdeklarationen

Momsbeviset lagras inte som en ändringsbar etikett på verifikationen. Det är en separat historikpost kopplad till den redan förseglade verifikationen.

## Stödd första omfattning

### Svensk kundfaktura

För vanlig momspliktig svensk försäljning kan systemet skapa bevis för:

- ruta 05 – momspliktig försäljning exklusive moms
- ruta 10 – utgående moms 25 % / konto 2611
- ruta 11 – utgående moms 12 % / konto 2621
- ruta 12 – utgående moms 6 % / konto 2631

Blandade 25/12/6-procentsrader på samma faktura kan avstämmas var för sig.

### Svensk leverantörsfaktura

För en vanlig svensk leverantörsfaktura där fakturan innehåller avdragsgill ingående moms registreras momsbevis mot:

- konto 2641
- ruta 48 – ingående moms att dra av

Leverantörens exakta momssats gissas inte från totalbeloppet. Pilotflödet vet i denna version att ett angivet momsbelopp har bokförts som vanlig ingående moms; mer komplicerad avdragsrätt kräver separat stöd och granskning.

## Avstämning mot huvudboken

Rapporten summerar momsbevisen och jämför dem med faktisk bokförd nettomoms på 2611, 2621, 2631 och 2641 för vald period.

Om exempelvis 2641 innehåller 2 500 kr men spårbara momsbevis bara förklarar 2 000 kr visas en avvikelse på 500 kr. Rapporten får då inte användas som deklarationsunderlag innan avvikelsen är utredd.

En manuell verifikation med momskonto men utan momsbevis är alltså inte dold. Den markeras som en oförklarad differens.

## Medvetna spärrar

Generisk 0-procentsförsäljning får inte bokföras automatiskt genom kundfakturaflödet i piloten. En nollprocentsrad kan bero på flera helt olika regler och deklarationsrutor. Utan särskild momskod och rättslig grund skulle systemet behöva gissa.

Denna etapp gör **inte** automatiska skattebedömningar för:

- momsfri försäljning och rätt undantagsgrund
- omvänd betalningsskyldighet
- EU-handel eller import
- vinstmarginalbeskattning
- uttag
- frivillig beskattning av hyra
- begränsad avdragsrätt, exempelvis vissa representations- eller personbilskostnader
- kundförlust och andra särskilda justeringar

Sådana fall ska stoppas, hanteras utanför automatiseringen eller få ett separat verifierat flöde innan de ingår i pilotomfånget.

## Aktuella svenska regler som påverkar implementationen

Skatteverket beskriver ruta 05 som momspliktig försäljning som inte hör till ruta 06–08 och rutorna 10, 11 och 12 som utgående moms med 25, 12 respektive 6 procent. Ruta 48 avser avdragsgill ingående moms.

Från 1 april 2026 är skattesatsen för livsmedel normalt 6 procent, medan restaurang- och cateringtjänster fortsatt är 12 procent. Systemet får därför inte byta momssats enbart efter datum; det krävs även korrekt klassificering av det som säljs.

Primärkällor kontrollerade 2026-09-18:

- Skatteverket, Fylla i momsdeklarationen: https://www.skatteverket.se/foretag/moms/deklareramoms/fyllaimomsdeklarationen.4.3a2a542410ab40a421c80004214.html
- Skatteverket, Momssatser och undantag från moms: https://www.skatteverket.se/foretag/moms/saljavarorochtjanster/momssatspavarorochtjanster.4.58d555751259e4d66168000409.html
- Skatteverket, Livsmedelsmomsen sänks till 6 procent: https://www.skatteverket.se/omoss/pressochmedia/nyheter/2026/nyheter/livsmedelsmomsensankstill6procent.5.70685bee19c85dd5dd0a3f.html

## Vad rapportens status betyder

`ledgerReconciled: true` betyder bara att de momskonton som denna kontroll omfattar kan förklaras av de sparade momsbevisen för perioden.

`declarationReady` är fortsatt `false`. Full deklarationsberedskap kräver att Rolands verkliga transaktionstyper, momsperiod, rättelser, krediter, eventuella specialfall och samtliga relevanta deklarationsrutor har verifierats.
