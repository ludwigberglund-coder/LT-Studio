# Dröjsmålsränta och betalningspåminnelser

Senast verifierad: 2026-09-18.

Detta dokument beskriver den avgränsade implementationen inför Rolands pilot. Det är inte juridisk rådgivning och ersätter inte redovisnings- eller inkassobedömning i ett enskilt ärende.

## Verifierade källor

- Sveriges Riksbank – referensräntan: https://www.riksbank.se/sv/statistik/rantor-och-valutakurser/referensranta/
- Räntelag (1975:635): https://www.riksdagen.se/sv/dokument-och-lagar/dokument/svensk-forfattningssamling/rantelag-1975635_sfs-1975-635/
- Lag (1981:739) om ersättning för inkassokostnader m.m.: https://www.riksdagen.se/sv/dokument-och-lagar/dokument/svensk-forfattningssamling/lag-1981739-om-ersattning-for-inkassokostnader_sfs-1981-739/

Riksbankens verifierade referensränta för 1 juli–31 december 2026 är 2,00 procent. Räntelagens normalregel i 6 § använder vid varje tid gällande referensränta plus åtta procentenheter.

## Vad systemet gör efter denna ändring

1. Ränteberäkning utgår från fakturans ursprungliga kapital och den sparade betalningshistoriken.
2. En delbetalning delar ränteperioden på betalningsdagen. Kapitalet minskar först från den dagen.
3. En betalning före eller på förfallodagen minskar kapitalet innan dröjsmålsräntan börjar räknas.
4. Fakturans sparade restbelopp måste stämma med den verifierbara betalningshistoriken. Vid avvikelse stoppas ränteberäkningen.
5. Krediter och andra saldoförändringar som ännu saknar en säker källanknuten historik stoppas i stället för att systemet gissar.
6. Varje referensränta gäller endast sitt kalenderhalvår. Nästa halvår blockeras tills en ny ränta har verifierats och lagts in.
7. Påminnelseunderlaget sparar vilken konfigurationsversion och vilket verifieringsdatum som användes samt varje räntesegment och kapitalbelopp.
8. Att ett påminnelseunderlag skapas betyder inte att ett e-postmeddelande är skickat. Leveransstatus finns i notification_outbox och blir skickad först efter leverantörsbekräftelse.

## Kvarvarande pilotspärr

Systemet har ännu inte ett komplett källanknutet flöde för kreditfakturor och andra efterhandsjusteringar i räntehistoriken. Sådana ärenden blockeras från automatisk ränteberäkning.

Den rättsliga startpunkten för dröjsmålsränta måste dessutom kopplas till dokumenterade betalningsvillkor för respektive kund-/avtalstyp. Den nuvarande påminnelsevägen använder fakturans förfallodag och får inte betraktas som ett generellt bevis för att ränta alltid får tas ut från just den dagen i alla situationer.

## Driftregel

När ett nytt kalenderhalvår närmar sig ska konfigurationen i `config/legal-rates.json` uppdateras från Riksbankens publicerade beslut och versionsnumret höjas. Systemet ska fortsatt neka beräkning för en period som inte finns uttryckligen i den verifierade tabellen.
