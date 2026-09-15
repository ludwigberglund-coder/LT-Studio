# Fakturor, påminnelser och dröjsmålsränta

Detta dokument beskriver de regler som den nuvarande implementeringen bygger på. Det är en teknisk kontrollista, inte juridisk rådgivning. Regler och referensräntor ska verifieras före skarp användning och när lagstiftning eller myndighetsuppgifter ändras.

## Fullständig faktura – uppgifter vi ska bära i systemet

Den nya PDF-mallen har stöd för bland annat:

- fakturadatum,
- unikt fakturanummer,
- säljarens namn och adress,
- säljarens momsregistreringsnummer,
- säljarens organisationsnummer,
- köparens namn och adress,
- köparens momsregistreringsnummer när det behövs,
- leverans- eller tjänstedatum,
- tydlig benämning av varan eller tjänsten,
- kvantitet och enhet,
- enhetspris exklusive moms,
- rabatt när den inte redan ingår i priset,
- beskattningsunderlag uppdelat per momssats,
- momssats,
- momsbelopp,
- valuta,
- totalbelopp,
- betalningskonto,
- OCR/betalningsreferens,
- förfallodatum och betalningsvillkor,
- köparens och säljarens referenser,
- kontaktuppgifter,
- särskild text vid omvänd betalningsskyldighet eller momsfrihet när det är aktuellt.

Vissa av uppgifterna ovan är obligatoriska enligt momsreglerna i tillämpliga situationer. Andra, exempelvis betalningskonto och förfallodatum, är praktiskt nödvändiga för vårt fakturaflöde även när de inte är en del av momsreglernas kärnlista.

## Kreditfaktura

En ändrings- eller kreditfaktura ska kunna hänvisa tydligt till den ursprungliga fakturan och beskriva vad som ändras.

Den nya PDF-mallen kan visa:

- att dokumentet är en kreditfaktura,
- ursprungsfakturans nummer,
- orsak till krediteringen,
- negativa belopp.

### Produktionsspärr

Den äldre fakturavägen samlar ännu inte alltid in `originalInvoiceNumber`. Därför får vi inte påstå att alla äldre kreditfakturor automatiskt uppfyller detta krav. Den nya fakturautgivningen ska före produktionssättning göra hänvisningen obligatorisk när en kreditfaktura skapas.

## Dröjsmålsränta

Systemet har en separat ränteberäkning i ören.

Standardregeln i den implementerade räntelagsmodellen är:

```text
Riksbankens referensränta + 8 procentenheter
```

När ett bestämt förfallodatum gäller kan ränta enligt huvudregeln räknas från förfallodagen. När det inte finns ett sådant avtalat förfallodatum gäller andra regler och krav på betalningskrav/faktura. Därför ska fakturans avtals- och kundtyp kunna styra det framtida arbetsflödet.

För perioden 1 juli–31 december 2026 är referensräntan konfigurerad till 2,00 procent. Det ger 10,00 procent per år enligt standardregeln ovan när den är tillämplig.

Räntan räknas:

- på utestående fakturakapital inklusive moms,
- dag för dag,
- med 365 dagar för vanligt år och 366 för skottår,
- i ören,
- uppdelat om referensränta eller kalenderår ändras under ränteperioden.

Systemet lägger inte dröjsmålsränta på redan beräknad dröjsmålsränta i denna standardmodell.

## Referensräntan är konfiguration, inte hårdkodad affärslogik

`config/legal-rates.json` innehåller verifierade halvårsperioder.

Riksbanken fastställer referensräntan för varje kalenderhalvår. Innan systemet beräknar ränta för ett nytt halvår i skarp drift måste konfigurationen uppdateras och kontrolleras mot Riksbankens publicerade ränta.

Om ränta saknas för den efterfrågade perioden ska systemet stoppa beräkningen i stället för att gissa.

## Påminnelseavgift

Systemet har stöd för 60 kronor i påminnelseavgift men tillåter den endast när kundposten visar att avgiften avtalades senast när skulden uppkom.

Den är därför **inte** automatiskt ikryssad för alla kunder.

Påminnelseavgiften ingår inte i kapitalet som den implementerade dröjsmålsräntan beräknas på.

## Förseningsersättning mellan företag

Systemet har stöd för 450 kronor i förseningsersättning i B2B-/offentligt arbetsflöde när reglerna är tillämpliga.

Konsumentkund blockeras från den funktionen.

Systemet blockerar dessutom att 450-kronorsersättningen och 60-kronors påminnelseavgift läggs ovanpå varandra i samma standardflöde. Sådana kostnader ska hanteras enligt de begränsningar som gäller för indrivningskostnader, inte som ett sätt att automatiskt stapla avgifter.

## Vad betyder “skicka påminnelse” i nuvarande version?

Backend kan nu:

1. kontrollera att fakturan är förfallen och fortfarande obetald,
2. beräkna ränta,
3. kontrollera om påminnelseavgift får användas,
4. skapa ett spårbart påminnelseunderlag,
5. registrera vem som skapade det och när,
6. visa senaste påminnelsedatum i kundreskontran.

Den nuvarande servern markerar leveransstatus som:

```text
awaiting-mail-integration
```

Det betyder att själva e-postleveransen **inte är inkopplad ännu**. Vi registrerar inte en påminnelse som “skickad via e-post” utan en verklig leveransintegration.

Nästa steg för verklig leverans är en e-post-/Microsoft 365-integration med:

- kö/outbox,
- mottagaradress,
- den genererade PDF:n eller påminnelsedokumentet,
- leverans-id från e-posttjänsten,
- tidpunkt,
- leveransstatus,
- felhantering och nytt försök,
- revisionsspår.

## Varför vi inte automatiserar juridiska avgifter blint

Det kan finnas särskilda avtal, kundtyper eller omständigheter som gör att standardregeln inte passar.

Därför ska systemet göra så här:

```text
beräkna ett kontrollerat förslag
→ visa grunden
→ låt behörig person godkänna
→ registrera exakt vad som skickades
```

När vi senare automatiserar mer ska samma bevis och spårbarhet finnas kvar.
