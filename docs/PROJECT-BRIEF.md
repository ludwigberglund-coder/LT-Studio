# Projektbrief – komplett småföretagsplattform med Rolands som referenskund

## Huvudmål

Projektet ska utveckla en komplett, säker och lättanvänd företagsplattform för saluhallar, småbutiker, mindre restauranger, caféer och närliggande småföretag.

Plattformen ska kombinera:

- en publik företagshemsida,
- säker personlig inloggning,
- en privat admin- och företagsportal,
- ekonomi, fakturering, bank, lager, dokument, rapporter och andra verksamhetsmoduler.

Rolands Frukt o Grönt Aktiebolag är den första kompletta referenskunden. Vi bygger ett verkligt slutresultat för Rolands, men den gemensamma kärnan ska kunna användas av andra företag utan att kopieras eller byggas om från början.

Den fullständiga produktvisionen finns i [PRODUCT-VISION.md](PRODUCT-VISION.md). En enkel förklaring av nuläge, arkitektur och plan finns i [SYSTEM-OVERVIEW.md](SYSTEM-OVERVIEW.md).

## Grundmodell

Systemet delas i fyra tydliga lager:

1. **Publik hemsida** – öppen information för kunder och besökare.
2. **Login och säkerhetsgräns** – personliga konton, sessioner, MFA och serverkontroll.
3. **Företagsportal** – privata arbetsytor och samma moduler för alla företagsmedlemmar.
4. **Gemensam plattformskärna** – ekonomi-, säkerhets-, data- och integrationsregler som återanvänds av alla företag.

## Företagsanpassning

Varje företag ska få en egen företagsmiljö med:

- namn, organisationsnummer och kontaktuppgifter,
- logotyp, färger, webbtexter och domän,
- bokförings- och momsinställningar,
- aktiverade moduler,
- personliga användare och företagsmedlemskap,
- egna integrationer,
- strikt avskild affärsdata och dokumentlagring.

Företagsskillnader ska i första hand lösas med konfiguration, tema och valbara moduler – inte genom en ny kodbas per kund.

## Första verksamhetsomfattningen

### Publik webb

- startsida,
- sortiment och tjänster,
- erbjudanden,
- öppettider,
- kontakt och hitta hit,
- anpassade beställnings- eller cateringflöden där verksamheten behöver det.

### Privat portal

- dashboard, sökning, uppgifter och aviseringar,
- kunder och leverantörer,
- kund- och leverantörsfakturor,
- reskontra, krediter, delbetalningar och attest,
- bokföring, perioder, momsunderlag och rapporter,
- bankimport, matchning och avstämning,
- artiklar, lager, inventering och svinn,
- dokumentinkorg och originalunderlag,
- webbplatsadministration,
- personal- och löneunderlag,
- inställningar, personliga användare, företagsmedlemskap och integrationer.

## Säkerhetsprinciper

- Privat data får aldrig skyddas enbart genom en dold webbadress.
- Backend kontrollerar varje skyddad åtgärd.
- Åtkomst nekas som standard och ges genom namngivna behörigheter.
- Alla personliga användare ska använda MFA.
- Kritiska flöden ska kunna kräva två olika personer.
- Bokförda poster skrivs inte över utan rättas spårbart.
- Osäkra automatiska förslag ska gå till manuell granskning.
- Hemligheter och skarp företagsdata får aldrig ligga i publikt GitHub-repo eller GitHub Pages.

## Dataprincip

GitHub är sanningskälla för:

- kod,
- dokumentation,
- tester,
- gemensamma mallar och exempelkonfiguration,
- release- och ändringshistorik,
- demo och förhandsgranskning.

Produktionsdatabasen och dokumentlagringen är sanningskälla för:

- bokföring,
- fakturor och betalningar,
- kund-, leverantörs- och personuppgifter,
- bankinformation,
- löneuppgifter,
- originaldokument och andra privata underlag.

## Nuvarande tekniska grund

Följande har byggts som separata, återanvändbara delar:

- innehållsdriven publik webbplats,
- projektadmin och GitHub Pages-demo,
- exakt penningmodell i ören,
- moms- och fakturaradsberäkning,
- central behörighetsmotor,
- rollmatris och fyrögonprincip,
- verifikations- och periodmotor,
- mot- och ersättningsverifikationer,
- automatiska tester och publiceringsflöde,
- äldre system som funktionsreferens under migreringen.

Detta är en utvecklingsgrund, inte färdig produktionsdrift.

## Rekommenderad byggordning

1. Företagsneutral modell och test med en andra företagskonfiguration.
2. Backend, PostgreSQL, personlig login, MFA, sessioner och företagsisolering.
3. Ny kund- och leverantörsreskontra.
4. Bankimport och bankavstämning.
5. Lager, inventering och svinn.
6. Rapporter, moms, SIE och bokslutsnära kontroller.
7. Personal- och löneintegration.
8. Webbplats-CMS, dokumentflöden, uppgifter och branschmoduler.
9. Säkerhets-, drift- och redovisningsgranskning före skarp Rolands-miljö.
10. Standardiserat införandeflöde för nästa kund.

## Godkännandekriterium för plattformen

Lösningen är bevisat återanvändbar när vi kan skapa en andra testkund och utan större ändringar i programkärnan:

- byta namn, varumärke och webbdesign,
- välja andra moduler,
- skapa separata personliga användare och företagsmedlemskap,
- använda en helt egen datamiljö,
- behålla samma säkerhets-, penning- och bokföringsregler.
