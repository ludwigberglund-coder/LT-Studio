# Automations- och AI-plan

## Målet

Ambitionen är att ett litet företag ska behöva göra så lite manuellt rutinjobb som möjligt.

På sikt ska systemet kunna:

- läsa inkommande bankhändelser,
- hitta rätt kund och rätt kundfaktura,
- föreslå eller förbereda omföring av inbetalningen,
- tolka leverantörsfakturor,
- föreslå kostnadskonto och momskonto,
- fylla i betalningsuppgifter,
- jämföra med tidigare liknande underlag,
- föreslå konteringar,
- upptäcka avvikelser,
- lägga säkra förslag i en godkännandekö,
- endast stoppa användaren när systemet är osäkert eller när en regel kräver mänskligt godkännande.

Det ska kännas som att systemet förbereder jobbet och människan kontrollerar undantagen.

## En viktig princip

AI får **inte** vara en genväg runt bokföringsregler, behörigheter eller attest.

AI är ett förslagslager ovanpå de vanliga domänreglerna.

```text
underlag
→ deterministiska kontroller
→ AI/rules-förslag
→ säkerhetsvärde + förklaring + bevis
→ behörig människa godkänner när det krävs
→ vanlig bokförings-/betalningsmotor gör den riktiga ändringen
→ revisionslogg
```

AI-modulen ska alltså aldrig själv skriva direkt i huvudboken eller banken.

## Det som är påbörjat nu

`packages/automation/proposals.js` är första gemensamma byggstenen.

Ett förslag innehåller bland annat:

- företag,
- typ av förslag,
- vilken källpost det gäller,
- säkerhetsvärde,
- tydlig motivering,
- vilka konkreta uppgifter som stöder förslaget,
- den strukturerade rekommendationen,
- vilken regelmotor eller AI-motor som skapade förslaget,
- tidpunkt,
- status,
- vem som senare godkände eller avvisade förslaget.

Även ett förslag med mycket hög säkerhet kan i denna fas bara bli `ready-for-approval`. Det kan inte automatiskt exekvera pengar eller bokföring.

## Steg 1 – deterministisk automatik först

Innan AI används ska systemet automatisera sådant där svaret kan bevisas med vanliga regler.

Exempel för en inbetalning:

```text
OCR = exakt faktura-OCR
+ belopp = exakt restbelopp
+ endast en öppen faktura matchar
= entydigt matchningsförslag
```

Det är säkrare och billigare än att fråga en AI-modell om ett svar som redan går att fastställa exakt.

Nuvarande kundreskontramodul har redan en sådan första matchningsregel.

## Steg 2 – AI som hjälper när reglerna inte räcker

AI används när betalningsinformationen är mer otydlig.

Exempel:

- kundens namn är förkortat,
- OCR saknas,
- flera fakturor kan summera till betalningen,
- kunden har skrivit en fri betalningstext,
- en klumpsumma avser flera fakturor,
- en leverantörsfaktura saknar tydlig bokföringsinformation.

AI ska då lämna ett förslag med:

- rekommenderad faktura eller kontering,
- säkerhetsvärde,
- förklaring,
- bevis/underlag,
- eventuella alternativa kandidater.

Om flera rimliga svar finns markeras förslaget som tvetydigt och går direkt till manuell granskning.

## Steg 3 – lärande från företagets godkända historik

När vi har riktig produktionsdata kan förslag förbättras med företagets egen historik.

Exempel:

> Leverantör X har de senaste 24 gångerna bokförts på 4010 med 12 % moms.

Det ska inte betyda att nästa faktura blint bokförs likadant. Systemet ska fortfarande kontrollera exempelvis:

- fakturatext,
- belopp,
- moms,
- period,
- leverantör,
- avvikelse från tidigare inköp,
- om konto fortfarande är tillåtet,
- om underlaget kräver särskild hantering.

## Steg 4 – kundinbetalningar

Målflödet är:

1. Bankhändelsen kommer in automatiskt.
2. Regler söker OCR, fakturanummer, belopp och kund.
3. Om träffen är exakt förbereds matchningen direkt.
4. Om träffen är oklar analyserar AI betalningstext och öppna kundfordringar.
5. Förslaget visar varför en faktura valts.
6. Hög säkerhet hamnar i en snabb godkännandekö.
7. Låg säkerhet eller flera kandidater flaggas tydligt.
8. Efter godkännande skapar den vanliga bokföringsmotorn betalningsposten och uppdaterar reskontran.

Senare kan vi besluta om vissa helt deterministiska fall får exekveras utan klick. Det beslutet ska tas separat och kräver produktionsdata, tydliga beloppsgränser, återställningsflöde och säkerhetsgranskning.

## Steg 5 – leverantörsfakturor

Målflödet är:

1. Fakturan kommer in via e-post, Peppol/e-faktura eller uppladdning.
2. Dokumentet sparas som original.
3. OCR/dokumenttolkning läser leverantör, fakturanummer, datum, belopp, moms, bankgiro och referenser.
4. Systemet kontrollerar dubbletter.
5. Regler och AI föreslår kostnadskonto, momskonto och eventuell periodisering.
6. Betalningsuppgifterna förbereds men skickas inte till banken.
7. Användaren ser fakturabilden bredvid förslaget.
8. Behörig person godkänner konteringen.
9. En annan behörig person frisläpper betalningen när fyrögonprincipen kräver det.
10. Allt sparas i revisionshistoriken.

## Steg 6 – löpande bokföring

Varje automatiskt konteringsförslag ska kunna svara på:

- vilket konto föreslås,
- vilken momskod eller momshantering föreslås,
- vilket belopp går i debet och kredit,
- varför,
- vilka tidigare poster eller regler som stöder svaret,
- hur säker modellen är,
- vilka delar som är osäkra.

Ett förslag som inte kan förklara sitt underlag ska inte få hög automationsnivå.

## Säkerhetsnivåer

Vi börjar konservativt:

### Manuell granskning

Används när:

- säkerheten är låg,
- flera kandidater finns,
- belopp eller moms avviker,
- ny leverantör eller okänd typ av köp förekommer,
- obligatoriska uppgifter saknas.

### Redo för godkännande

Används när:

- deterministiska regler ger en entydig träff, eller
- AI-förslaget har hög säkerhet och tillräckligt tydligt underlag.

Människan behöver då normalt bara kontrollera och trycka godkänn.

### Automatisk exekvering

Är **inte aktiverad i den nuvarande arkitekturen**.

Den kan övervägas senare för mycket tydliga och lågriskfall. Innan dess krävs bland annat:

- en längre historik av korrekta förslag,
- mätning av felgrad,
- beloppsgränser,
- kundspecifika regler,
- full revisionslogg,
- idempotens/dubblettskydd,
- säker återföring,
- produktionsövervakning,
- separat godkännande av automationspolicyn.

## Hur vi mäter AI:n

Vi ska inte mäta framgång på hur många saker modellen “gissar”.

Viktigare mått är:

- andel förslag som godkänns utan ändring,
- andel felaktiga förslag,
- andel manuella undantag,
- tid sparad per faktura/bankhändelse,
- antal dubbletter som stoppas,
- antal avvikelser som upptäcks,
- hur väl säkerhetsvärdet motsvarar faktisk korrekthet.

Om förslag med 95 % angiven säkerhet bara är rätt 80 % av gångerna är säkerhetsvärdet dåligt kalibrerat och ska inte styra automationsnivån.

## Integritet och företagsgränser

AI-underlag måste följa samma företagsisolering som övrig data.

Ett företags fakturor, kunder eller historik får inte användas som privat kontext i ett annat företags förslag.

Vilken extern AI-tjänst som får användas med riktiga ekonomidokument är ett separat produktionsbeslut. Avtal, databehandling, lagringspolicy och känsliga personuppgifter måste vara utredda innan skarp dokumentdata skickas till en extern modell.

## Nästa tekniska steg

1. Spara automationsförslag i backenddatabasen.
2. Bygg en gemensam granskningskö i företagsportalen.
3. Koppla den deterministiska bankmatchningen till kön.
4. Skapa bokföringsförslag för leverantörsfakturor med regler först.
5. Lägg till ett modellgränssnitt där AI-leverantören kan bytas utan att domänlogiken ändras.
6. Logga modell/version, prompt-/policyversion och underlag för varje AI-förslag.
7. Koppla ett godkänt förslag till den vanliga bokförings- eller betalningsmotorn.
8. Mät förslagens kvalitet innan automationsnivån höjs.
