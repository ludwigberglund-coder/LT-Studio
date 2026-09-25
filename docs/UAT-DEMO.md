# Sammanhängande UAT-demo

Den här filen beskriver hur den öppna GitHub Pages-demon hänger ihop. All demodata är fiktiv och sparas endast lokalt i användarens webbläsare.

## Syfte

Demon ska kunna granskas som ett enda småföretagssystem i stället för som fristående exempelsidor. Centrala poster använder därför samma interna id, fakturanummer, belopp och leverantör genom flera moduler.

`apps/portal/demo-scenario.js` är källan för den gemensamma demodatan. `apps/portal/demo-workflows.js` innehåller testbara demoflöden som ändrar flera delar av scenariot på ett kontrollerat sätt.

## Kundinbetalning

Huvudscenariot för kundinbetalning är:

1. Kundfaktura/avi `310002` till **Nordic Office Göteborg AB** har `3 925,00 kr` kvar att betala.
2. Bankhändelsen med referens `310002` är också `3 925,00 kr`.
3. Bankmatchningen föreslår att inbetalningen kopplas till faktura/avi `310002`.
4. Automationskön visar åtgärden i klartext och visar föreslagen kontering:
   - Debet `1930 Företagskonto / bank` 3 925,00 kr.
   - Kredit `1510 Kundfordringar` 3 925,00 kr.
5. Konton kan ändras före godkännande. Ett godkännande i Automationskön är fortfarande inte samma sak som bokföring.

## Leverantörsfaktura och utbetalning

Huvudscenariot för leverantörsfakturor innehåller bland annat:

- `KE-2088`, **Kustens Emballage AB**, 589,00 kr: används för att granska och ändra konteringsförslag.
- `BKS-771`, **Demo Kyla & Service AB**, 4 375,00 kr: attesterad faktura som kan gå vidare till betalningsflödet.
- `GF-8821`, **Göteborg Fruktlager AB**, 846,00 kr: redan betald faktura med dokument- och bokföringsspår.

För `BKS-771` är den avsedda kedjan:

1. fakturan är attesterad,
2. betalningen förbereds,
3. en separat användare kan frisläppa den,
4. betalningen blir inte bokförd förrän bankbekräftelse registreras,
5. bankbekräftelsen markerar fakturan betald och skapar en balanserad verifikation:
   - Debet `2440 Leverantörsskulder`,
   - Kredit `1930 Företagskonto / bank`.

Demon påstår aldrig att pengar verkligen skickats till en bank.

## Leverantörsregister

Leverantörsregistret använder samma leverantörer som leverantörsfakturorna. Ändringar av betalningsuppgifter går till en separat godkännandekö. Först efter godkännande ändras den aktiva demomasterdatan.

## Dokument

Dokument använder samma interna affärs-id som övriga moduler. Exempelvis pekar originalet för `GF-8821` på samma leverantörsfakturapost som Leverantörsfakturor använder. Dokumentets SHA-256 i demon är exempeldata; inga riktiga företagsfiler publiceras på GitHub Pages.

## Bokföring

Bokföringssidan läser samma `accountingEntries` som betalningsflödet skriver till. Motverifikationer, periodlås och demo-upplåsningar sparas också i den gemensamma demostaten.

Originalverifikationer redigeras inte. En rättelse skapar en ny post med omvänd debet/kredit.

## Återställning och UAT

`/portal/uat.html?demo=1` är startpunkten för manuell UAT. Där kan varje steg markeras som:

- Ej testad,
- Godkänd,
- Fel / behöver rättas,
- Önskad ändring.

Anteckningar och UAT-status lagras lokalt i webbläsaren. **Återställ demoscenario** återställer den gemensamma fiktiva datan och UAT-markeringarna.

## CI-kontroller

`test/demo-scenario.test.js` kontrollerar bland annat att:

- kundfaktura och bankbetalning har samma matchningsbelopp,
- automationsförslag pekar på rätt affärsobjekt,
- dokumentlänkar pekar på befintliga leverantörsfakturor,
- demoverifikationer balanserar,
- leverantörsbetalning inte kan bankbekräftas före frisläppning,
- ett fullföljt leverantörsbetalningsflöde uppdaterar faktura, betalning och bokföring konsekvent.

Dessa tester gäller demots sammanhang och ersätter inte produktionsintegration, bankavtal eller verklig redovisningskontroll.

## En aktuell version i UAT

Varje publicering byggs rent från en enda `main`-commit. HTML-sidor, JavaScript,
CSS och lokala JSON-resurser versionsmärks med samma fullständiga commit-id.
Testguiden visar versionen och sparar bedömningar per publicering. Tidigare
bedömningar visas inte som godkännanden för en ny version; demots affärsdata raderas inte.

Ersatta referensverktyg tas bort ur navigationen. Den äldre demon publiceras inte;
dess gamla ingång omdirigerar till motsvarande aktuell portalmodul. Den separata
verifikationsdemon omdirigerar till Bokföring. Projektinformation och öreskalkylator,
som inte är äldre kopior av portalmoduler, finns kvar.

Alla publicerade sidor kontrollerar `build-info.json` utan cache vid öppning,
återgång till fliken och var 30:e sekund. Om en ny publicering upptäcks spärrar en
dialog fortsatt testning tills den senaste versionen laddats. Omladdning kräver ett
klick så att användaren ser att osparad inmatning kan försvinna. Nätverksfel kan
fördröja versionskontrollen; en lyckad Pages-publicering krävs innan ny kod är tillgänglig.
