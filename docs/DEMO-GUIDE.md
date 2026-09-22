# Demoguide – referenskunden företagsplattform

Den här guiden används när ägarna testar den sammanhängande demon. GitHub Pages är endast en öppen granskningsmiljö med exempeldata. Riktiga kund-, bank-, faktura-, personal- eller bokföringsuppgifter får inte läggas in där.

## Ingång

Den gemensamma ekonomidemon öppnas via:

`/portal/dashboard.html?demo=1`

Översikten leder vidare till alla färdigkopplade arbetsytor.

## Testordning

### 1. Översikt

Kontrollera att dagsbilden är begriplig och att länkarna går till rätt modul.

### 2. Kundreskontra

Kontrollera:
- kolumnväljaren,
- öppna och betalda fakturor,
- transaktionsrader,
- högerklick och intern fakturakommentar,
- betalningspåminnelse,
- dröjsmålsränta och avgifter i demon.

### 3. Bank och avstämning

Kontrollera:
- importerade inbetalningar,
- status för matchning,
- OCR/fakturanummer/belopp som matchningsunderlag,
- att osäkra träffar går till granskning i stället för automatisk bokföring.

### 4. Automationskö

Kontrollera:
- säkerhetsgrad,
- motivering,
- underlag,
- föreslagen åtgärd/kontering,
- godkännande och avvisning.

Ett godkännande i kön är fortfarande ett mänskligt granskningsbeslut. Det får inte i sig kringgå övriga bokförings- eller betalningskontroller.

### 5. Leverantörsfakturor

Kontrollera hela flödet:
1. registrera ny faktura,
2. bifoga PDF,
3. se fakturan i arbetskön,
4. öppna PDF bredvid konteringen,
5. hämta konteringsförslag,
6. ändra konteringen,
7. attestera,
8. förbered betalning,
9. frisläpp betalningen med separat person i den skarpa modellen,
10. bekräfta genomförd betalning och bokför 2440 mot bankkonto.

Demon skickar inga pengar till banken.

### 6. Leverantörsregister

Kontrollera:
- leverantörsuppgifter,
- standardkonto,
- ändringshistorik,
- begäran om nytt bankgiro/plusgiro,
- separat godkännande av betalningsuppgifter.

En redan förberedd betalning ska behålla den mottagare som gällde när betalningen förbereddes även om leverantörsregistret ändras senare.

## Moduler som ska anslutas innan helhetsdemon betraktas som komplett

- bokföringsvy och periodhantering i samma portal,
- resultatrapport, balansrapport, moms och ekonomiska rapporter,
- lager, inventering och svinn,
- löneunderlag/lönejournal,
- dokumentarkiv,
- webbplats-CMS,
- användar- och företagsadministration,
- en andra fiktiv testkund för att bevisa företagsisolering och återanvändbarhet.

## Hur fel och önskemål ska bedömas

För varje upptäckt problem, notera:
- vilken sida/modul det gäller,
- vad ni gjorde,
- vad ni förväntade er,
- vad som faktiskt hände,
- om problemet gäller funktion, tydlighet, design eller verksamhetsregel.

Alla korrigeringar ska göras i GitHub, testas automatiskt och först därefter slås ihop till `main`.
