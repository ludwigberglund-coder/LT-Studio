# Dröjsmålsränta och påminnelser inför Rolands-pilot

Senast verifierad: 2026-09-18.

Detta dokument beskriver den avgränsade automatiska ränteberäkning som får användas i systemet. Det är inte ett generellt juridiskt beslut för alla fordringssituationer.

## Vad systemet får beräkna automatiskt

Automatisk dröjsmålsränta används bara när systemet kan verifiera att:

1. fakturan är utfärdad i den privata fakturamotorn,
2. fakturans arkiverade underlag fortfarande har samma digitala fingeravtryck,
3. fakturan har ett bestämt förfallodatum i det arkiverade underlaget,
4. fakturans reskontrasaldo kan återskapas exakt från godkända betalningar och krediter,
5. hela ränteperioden täcks av uttryckligen verifierade referensränteperioder.

Om något av detta saknas stoppas automatisk ränta. Systemet ska inte gissa.

## Saldohistorik

Räntan beräknas på den skuld som faktiskt var utestående under respektive del av tiden.

Exempel:

- faktura: 1 000 kr,
- förfallodag: 1 september,
- delbetalning 500 kr den 2 september,
- påminnelsedag: 18 september.

Räntan räknas då på 1 000 kr fram till delbetalningen och därefter på 500 kr. Om samma delbetalning sker den 17 september blir räntebeloppet högre eftersom 1 000 kr varit obetalt längre.

Godkända krediter behandlas på motsvarande sätt från kreditens bokföringsdatum.

Följande fall spärras i det automatiska flödet tills särskild hantering finns:

- överbetalningar som gör historiskt saldo negativt,
- okända/manuella reskontrajusteringar som inte kan klassificeras,
- saldohistorik som inte stämmer med aktuellt restbelopp,
- saldoändringar före fakturadatum.

## Referensränta

Konfigurationen anger både start- och slutdatum för varje verifierad referensränteperiod. Den sista kända räntan får inte fortsätta automatiskt in i ett nytt kalenderhalvår.

För närvarande finns verifierade perioder till och med 2026-12-31. Innan automatisk ränta används efter det datumet måste nästa period läggas in och verifieras mot Sveriges Riksbank.

Källor:

- Sveriges Riksbank, Referensräntan enligt räntelagen: https://www.riksbank.se/sv/statistik/rantor-och-valutakurser/referensranta/
- Räntelag (1975:635), särskilt 3, 4, 6 och 9 §§: https://www.riksdagen.se/sv/dokument-och-lagar/dokument/svensk-forfattningssamling/rantelag-1975635_sfs-1975-635/
- Lag (1981:739) om ersättning för inkassokostnader m.m.: https://www.riksdagen.se/sv/dokument-och-lagar/dokument/svensk-forfattningssamling/lag-1981739-om-ersattning-for-inkassokostnader_sfs-1981-739/

## Spårbarhet

Varje sparat ränteunderlag bevarar bland annat:

- kapitalbelopp för varje delperiod,
- periodens start och slut,
- antal dagar,
- använd referensränta,
- giltighetsperiod för referensräntan,
- total årsränta,
- versionsnummer för räntekonfigurationen,
- datum då räntekonfigurationen verifierades,
- digitalt fingeravtryck för fakturaunderlaget som styrker förfallodagen.

Godkända betalningstransaktioner och skapade påminnelseunderlag är append-only i pilotdatabasen: nya poster kan läggas till men gamla poster får inte skrivas om eller raderas genom normal applikationsåtkomst.

## Påminnelsedatum är inte leveransbevis

Applikationen använder ordet **påminnelsedatum**. Den interna äldre databaskolumnen heter fortfarande `sent_at`, men den betyder i detta flöde datumet för det registrerade påminnelseunderlaget.

Det finns ingen ansluten e-postleverantör. En registrerad eller köad påminnelse betyder därför inte att kunden har fått ett e-postmeddelande. API:t rapporterar `not-delivered` tills verklig leverans kan styrkas av en framtida leverantörsintegration.

## Idempotens

När en påminnelse skapas krävs en unik request-id. Ett identiskt återförsök returnerar den redan skapade posten. Samma request-id med ändrat innehåll stoppas som konflikt.

Detta skydd finns på server- och databasnivå och är inte beroende av att knappen råkar vara avstängd i webbläsaren.

## Kvarvarande avgränsning

Detta löser inte alla tänkbara juridiska räntefall. Exempelvis importerade historiska fordringar där ursprungligt avtal, förfallodag eller underrättelse inte kan verifieras ska fortfarande hanteras manuellt tills ett särskilt granskat flöde finns.

Pilotbeslutet är därför fortsatt **NO-GO** tills övriga blockerare i `ROLANDS-PILOT-READINESS-CHECKLIST.md` är stängda.
