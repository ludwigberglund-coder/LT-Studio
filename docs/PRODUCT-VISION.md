# Produktvision – en komplett småföretagsplattform med Rolands som första referenskund

## Dokumentets roll

Detta dokument beskriver **varför systemet byggs**, **vem det byggs för** och **hur vi ska undvika att fastna i ett specialbygge för ett enda företag**.

När det uppstår ett val mellan en snabb Rolands-specifik lösning och en återanvändbar lösning ska följande princip gälla:

> Rolands är vår första kompletta referenskund. Själva plattformens kärna ska samtidigt kunna användas av andra saluhallar, småbutiker och mindre restauranger utan att byggas om från början.

## Produktens mål

Vi bygger en sammanhållen plattform för små företag som behöver både en publik hemsida och ett privat verksamhetssystem.

Plattformen ska på sikt kunna samla:

- publik företagshemsida,
- webbplatsinnehåll och erbjudanden,
- personlig inloggning,
- företagsmedlemskap och objektbehörighet,
- företagsöversikt och arbetsuppgifter,
- kunder och leverantörer,
- försäljning, kundfakturor och betalningar,
- inköp, leverantörsfakturor och attest,
- bokföring, moms, perioder och rapporter,
- bankimport och bankavstämning,
- artiklar, lager, inventering och svinn,
- dokument och originalunderlag,
- personal- och löneunderlag,
- inställningar, integrationer och revisionsspår.

Alla företag behöver inte aktivera alla moduler. Plattformen ska kunna anpassas efter verksamhetens storlek och arbetssätt.

## Första målgrupp

Den första målgruppen är:

- saluhallar,
- mindre livsmedelsbutiker,
- specialbutiker,
- mindre restauranger och caféer,
- närliggande småföretag med försäljning, inköp, lager och enkel personaladministration.

De verksamheterna har flera gemensamma behov men också skillnader. En butik behöver ofta artiklar, lager och kassaflöden. En restaurang behöver dessutom exempelvis råvaror, recept, svinn, bord eller beställningsflöden. Därför ska gemensamma funktioner ligga i plattformens kärna medan branschspecifika funktioner byggs som valbara moduler.

## Rolands roll

Rolands Frukt o Grönt Aktiebolag är **kund nummer ett och referensimplementationen**.

Vi ska bygga en komplett kedja för Rolands:

1. En besökare öppnar Rolands publika hemsida.
2. Besökaren kan endast se publikt innehåll.
3. En behörig medarbetare går till inloggningen.
4. Efter säker inloggning öppnas företagets privata portal.
5. Alla inloggade medlemmar ser samma funktioner inom sitt företag.
6. Företagets ekonomi, lager, dokument, webbplats och övriga moduler hanteras i samma portal.

Rolands ska ge oss verkliga arbetsflöden, riktiga krav och ett tydligt exempelresultat. Men följande får **inte** byggas direkt in i den gemensamma kärnan:

- företagsnamnet Rolands,
- Rolands logotyp och färger,
- Rolands organisationsnummer och kontaktuppgifter,
- Rolands konton, användare eller dokument,
- Rolands specifika webbtexter,
- antaganden som bara gäller Rolands arbetssätt.

Sådant ska ligga i en separat företagskonfiguration och i företagets egen datamiljö.

## Systemet i fyra tydliga lager

### 1. Publik hemsida

Den publika hemsidan är öppen för alla och får endast innehålla information som företaget vill publicera.

Exempel för Rolands:

- startsida,
- sortiment och tjänster,
- aktuella erbjudanden,
- öppettider,
- kontakt och hitta hit,
- information om beställning, catering eller leverans.

Design, bilder och innehåll ska kunna anpassas för varje företag utan att ekonomisystemets kärna ändras.

### 2. Inloggning och säkerhetsgräns

`/login` är gränsen mellan den publika webbplatsen och det privata företagssystemet.

En dold webbadress är inte säkerhet. Det privata systemet måste därför använda:

- personliga användarkonton,
- säkra lösenord eller extern identitetsleverantör,
- flerfaktorsautentisering för alla personliga användare,
- servervaliderade sessioner,
- central behörighetskontroll,
- automatisk utloggning och säker sessionshantering,
- loggning av viktiga åtgärder.

Frontend får aldrig själv avgöra om en skyddad åtgärd är tillåten. Backend ska kontrollera varje skyddat anrop.

### 3. Företagsportal och administration

Efter inloggning öppnas företagets privata portal. Portalen ska innehålla ett gemensamt skal med navigation, sökning, meddelanden, uppgifter och dashboard.

Alla personliga, autentiserade användare inom samma företag har samma behörighet. Ingen användare får åtkomst till andra företags data utan medlemskap där.

Portalen ska också innehålla webbplatsadministration så att företaget kan ändra exempelvis öppettider, erbjudanden och texter utan att redigera programkod.

### 4. Gemensam plattformskärna

Den gemensamma kärnan innehåller regler som ska fungera likadant för alla företag:

- penningbelopp och moms,
- personliga användare och företagsmedlemskap,
- bokföring och perioder,
- fakturor och reskontra,
- bankmatchning,
- lagerlogik,
- dokument och revisionsspår,
- rapportering,
- integrationsgränser.

Kärnan ska använda neutrala begrepp och kunna testas utan någon särskild företagsdesign.

## Företagsanpassning utan nytt specialbygge

Varje företag ska få en egen **företagsmiljö**. En företagsmiljö innehåller bland annat:

- företags-id,
- juridiskt namn och organisationsnummer,
- logotyp, färger och typografi,
- domännamn,
- webbtexter, bilder och öppettider,
- bokföringsinställningar,
- momskonfiguration,
- kontoplan och nummerserier,
- aktiverade moduler,
- personliga användare och företagsmedlemskap,
- integrationsinställningar,
- företagets egna affärsdata och dokument.

När nästa kund tillkommer ska vi i första hand:

1. skapa en ny företagsmiljö,
2. välja design och innehåll,
3. aktivera rätt moduler,
4. konfigurera ekonomi och integrationer,
5. lägga till personliga användare och företagsmedlemskap.

Vi ska inte kopiera hela systemet och skapa en ny separat kodbas för varje kund.

## Datagränser

GitHub är basen för:

- programkod,
- gemensamma mallar,
- exempelkonfiguration,
- dokumentation,
- tester,
- ändringshistorik,
- demo och granskningsversioner.

GitHub och GitHub Pages får inte innehålla skarp:

- bokföring,
- kund- eller leverantörsdata,
- bankdata,
- personuppgifter,
- löneuppgifter,
- fakturabilagor,
- lösenord, API-nycklar eller andra hemligheter.

Skarp data ska ligga i en riktig databas och skyddad dokumentlagring. Varje företags data ska vara strikt avskild från andra företags data.

## Viktiga produktprinciper

1. **Rolands först, men inte Rolands-låst.** Vi löser verkliga behov för Rolands men lägger gemensamma regler i återanvändbara moduler.
2. **Konfiguration före specialkod.** Företagsskillnader ska så långt som möjligt hanteras med innehåll, inställningar, teman och aktiverade moduler.
3. **Säkerhet på serversidan.** Dold navigation eller frontendkontroller räcker aldrig.
4. **Minsta möjliga behörighet.** Varje användare får endast den åtkomst som behövs för arbetsuppgiften.
5. **Spårbar ekonomi.** Bokförda poster skrivs inte över; rättelser görs med nya spårbara poster.
6. **En gemensam sanningskälla.** GitHub är sanningskälla för systemets kod och dokumentation. Produktionsdatabasen är sanningskälla för företagets affärsdata.
7. **Modulärt och stegvis.** Vi bygger färdiga vertikala arbetsflöden i kontrollerade etapper i stället för många halvfärdiga sidor.
8. **Enkelt för småföretag.** Systemet ska dölja onödig teknisk komplexitet och förklara vad användaren behöver göra.
9. **Säkra standardval.** Osäkra eller oklara automatiska förslag ska stanna för granskning.
10. **Test före publicering.** Ändringar ska kontrolleras automatiskt innan de når demo eller produktion.

## Rekommenderad byggordning

### Fas 1 – Plattformens grund

- fast produktvision och gemensamt språk,
- företagsmodell och företags-id i alla privata dataflöden,
- tydlig separation mellan publik webb, login, admin och API,
- miljöer för demo, test och produktion,
- gemensam navigation och designsystem.

### Fas 2 – Riktig identitet och dataplattform

- backend/API,
- PostgreSQL eller motsvarande transaktionsdatabas,
- personlig inloggning,
- MFA och sessionshantering,
- företagsisolering,
- säker dokumentlagring,
- migrations- och backupstrategi.

### Fas 3 – Rolands första kompletta verksamhetsflöden

- kunder och leverantörer,
- kund- och leverantörsfakturor,
- betalningar och reskontra,
- bokföring och perioder,
- bankimport och avstämning,
- artiklar, lager, inventering och svinn,
- rapporter, momsunderlag och SIE.

### Fas 4 – Komplett småföretagsportal

- webbplatsredigering,
- dokumentinkorg och attest,
- personal- och löneunderlag,
- uppgifter och aviseringar,
- integrationscenter,
- branschmoduler för butik, saluhall och restaurang.

### Fas 5 – Produktionssättning och återanvändning

- säkerhetsgranskning,
- redovisningsmässig verifiering,
- återställningstest,
- övervakning och incidentrutiner,
- första skarpa Rolands-miljön,
- mall för att skapa nästa kund utan ny kodbas.

## Hur vi mäter att lösningen är återanvändbar

Rolands-implementationen är inte färdig som plattform förrän vi kan skapa en andra testkund och utan större kodändringar:

- byta varumärke och webbdesign,
- ändra företagsuppgifter,
- välja andra moduler,
- skapa separata personliga användare och företagsmedlemskap,
- använda en egen databas-/företagsmiljö,
- behålla samma ekonomiska kärna och säkerhetsregler.

Den andra testkunden behöver inte vara skarp. Den fungerar som ett bevis på att vi verkligen har byggt en plattform och inte bara en enskild Rolands-applikation.
