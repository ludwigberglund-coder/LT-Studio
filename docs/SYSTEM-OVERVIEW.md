# referenskunden-plattformen – enkel förklaring av nuläge, upplägg och plan

## Sammanfattning

Vi bygger inte bara en hemsida för referenskunden. Vi bygger en **återanvändbar småföretagsplattform** där den första referenskunden är den första kompletta referenskunden.

Tanken är att samma tekniska kärna senare ska kunna användas av andra:

- saluhallar,
- småbutiker,
- mindre restauranger och caféer,
- närliggande småföretag med försäljning, inköp, lager och ekonomi.

För varje nytt företag ska vi kunna byta namn, design, texter, inställningar och aktiverade moduler utan att kopiera eller bygga om hela systemet.

Systemet består i längden av två tydliga delar:

1. **En publik hemsida** som alla besökare får se.
2. **Ett privat företagssystem** som endast behöriga användare kommer åt efter säker inloggning.

Det som finns idag är en genomarbetad utvecklingsgrund och demo. Det är ännu inte en färdig produktionsmiljö för verklig bokföring eller personuppgifter.

---

## En enkel bild av systemet

Man kan tänka på lösningen som en fysisk butik:

### Skyltfönstret – publik hemsida

Alla får se öppettider, erbjudanden, sortiment, kontaktuppgifter och annan publik information.

### Den låsta personalingången – login

Här ska personal och andra behöriga logga in. En besökare ska aldrig kunna komma åt företagets privata information genom att bara känna till en webbadress.

### Kontoret – adminportal och företagssystem

Efter inloggning finns företagets arbetsyta med ekonomi, fakturor, lager, dokument, rapporter, webbplatsredigering och övriga moduler.

### Maskinrummet – gemensamma regler och datalagring

Här finns reglerna som ser till att belopp räknas rätt, bokföringen balanserar, rätt användare får göra rätt saker och företagets data lagras säkert.

Det är maskinrummet som ska vara gemensamt för alla företag. Skyltfönstret och vissa funktioner kan däremot anpassas efter varje företag.

---

## Vad som är byggt hittills

## 1. Publik webbplats

Det finns en ny publik webbplats som byggs från redigerbara innehållsfiler.

Den är skapad för att:

- fungera bra på dator och mobil,
- visa företagets information,
- kunna få egna färger, texter och erbjudanden,
- publiceras automatiskt via GitHub Pages,
- hållas åtskild från ekonomi- och administrationslogik.

Den publika demon finns här:

<https://ludwigberglund-coder.github.io/referenskunden/>

### Vad som är enkelt att ändra

Företagsuppgifter och webbtexter ligger i tydliga filer:

- `content/company.json` – namn, adress, telefon och e-post,
- `content/site.json` – rubriker, texter och erbjudanden,
- `content/admin.json` – adminmeny och utvecklingsöversikt.

Det innebär att vanliga textändringar inte behöver göras mitt inne i programkoden.

## 2. Projektadmin och utvecklingsdemo

Det finns en adminliknande miljö där vi kan se och prova de nya delarna:

<https://ludwigberglund-coder.github.io/referenskunden/admin/>

Den innehåller bland annat:

- översikt över projektet,
- enkel redigering av webbplatsinnehåll,
- öreskalkylator,
- behörighetsmatris,
- demo för verifikationer och perioder,
- lista över systemmoduler och verksamhetsbeslut.

### Viktig begränsning

Denna miljö är **inte den slutliga säkra adminportalen**. Den ligger på GitHub Pages, som är en statisk webbmiljö utan riktig serverinloggning.

Det betyder:

- den får använda demodata,
- lokala demoändringar kan sparas i den egna webbläsaren,
- den får inte innehålla verkliga fakturor, bankuppgifter eller personuppgifter,
- den skyddar inte privata sidor med riktig serverautentisering.

Projektadmin är alltså ett verktyg för utveckling, granskning och demonstration.

## 3. Exakt penningmodell

En ny gemensam ekonomisk grund finns i:

`packages/accounting/money.js`

Den ser till att:

- pengar lagras som heltal i ören,
- `1 234,56 kr` lagras som `123456` öre,
- kvantiteter kan ha decimaler utan vanliga avrundningsfel,
- moms beräknas kontrollerat,
- fakturor med blandade momssatser kan summeras,
- felaktiga eller för stora belopp stoppas.

### Varför ören lagras som heltal

Datorer kan annars få små fel när de räknar med decimaler. Ett ekonomisystem får inte råka skapa differenser på grund av sådana tekniska avrundningsfel.

Att lagra `100,50 kr` som `10050` öre är därför säkrare än att lagra talet `100.50` som ett vanligt decimaltal.

En fungerande demo finns här:

<https://ludwigberglund-coder.github.io/referenskunden/admin/#/money>

## 4. Personlig autentisering och företagsmedlemskap

Alla autentiserade medlemmar inom samma företag har samma behörighet. MFA krävs för alla. API:t kontrollerar aktuell session, aktivt medlemskap och objektets företag. Individuell användaridentitet bevaras i audit.

Befintliga kontroller för två olika personer vid vissa åtgärder gäller lika för alla. Se [åtkomstmodell och migration](ACCESS-CONTROL.md).

## 5. Ny verifikations- och periodmotor

Den nya bokföringskärnan finns i:

`packages/accounting/journal.js`

Den kan bland annat:

- skapa balanserade verifikationer,
- kräva lika mycket debet och kredit,
- lagra alla belopp i ören,
- kontrollera fyrsiffriga konton,
- ge löpnummer inom serie och år,
- stoppa bokföring i en låst period,
- låsa och låsa upp perioder med rätt behörighet,
- skapa motverifikationer när något behöver rättas,
- behålla originalposten,
- bevara vem som gjorde vad och när,
- hitta vissa typer av manipulation och nummerseriefel.

### Vad append-only betyder

Bokförda poster ska inte skrivas över eller försvinna.

När något är fel gör systemet i stället:

1. en ny post som vänder den felaktiga bokningen,
2. vid behov en ny korrekt ersättningspost,
3. en tydlig koppling mellan posterna.

Det gör historiken begriplig och spårbar.

Demon finns här:

<https://ludwigberglund-coder.github.io/referenskunden/admin/#/journal>

## 6. Tidigare system som referens

Den äldre versionen finns kvar under:

<https://ludwigberglund-coder.github.io/referenskunden/legacy/#/overview>

Den innehåller många tidigare funktioner och arbetsflöden, exempelvis fakturering, reskontra, bankbedömning, rapporter och SIE-export.

Vi använder den som:

- funktionsreferens,
- källa till verksamhetskrav,
- jämförelse när nya moduler byggs,
- skydd mot att glömma fungerande arbetsflöden.

Den äldre versionen är inte samma sak som den långsiktiga nya arkitekturen. Funktionerna ska flyttas över stegvis till nya, tydligare moduler.

## 7. Automatiska tester och publicering

GitHub Actions kontrollerar projektet vid ändringar.

Kontrollerna omfattar bland annat:

- innehållsfiler,
- JavaScript-syntax,
- säkerhetsregler,
- ekonomiska beräkningar,
- företagsmedlemskap och objektbehörighet,
- verifikationer och perioder,
- dataintegritet,
- SIE-export,
- statisk webbbyggnad,
- kända sårbarheter i beroenden.

På den senast kontrollerade huvudversionen passerade **67 automatiska tester** utan fel.

När allt passerar byggs och publiceras GitHub Pages-demon automatiskt.

Det här innebär inte att systemet är produktionsgodkänt. Tester minskar risken för fel, men riktig drift kräver även databas, server, backup, säkerhetsgranskning och verksamhetsverifiering.

---

## Hur projektet är organiserat

```text
apps/
  website/               publik hemsida
  admin/                 projektadmin och domändemos

packages/
  accounting/            pengar, moms, verifikationer och perioder
  access-control/        företagsmedlemskap och attestseparation
  shared/                gemensamma små verktyg

content/                  redigerbara webb- och företagstexter
config/                   verksamhets- och behörighetsinställningar
public/                   äldre system som referens
docs/                     förklaringar, beslut och planer
scripts/                  bygge, validering och driftverktyg
test/                     automatiska tester
```

### Varför denna uppdelning är viktig

Om allt ligger i en enda stor fil blir varje ändring riskfylld och svår att förstå.

Med tydliga delar kan vi exempelvis:

- ändra webbdesign utan att röra bokföringsregler,
- hantera företagsmedlemskap utan att skriva om varje sida,
- återanvända samma penningmodell i fakturor, lager och bank,
- testa varje regel separat,
- byta databas eller frontend utan att kasta hela systemet.

---

## Så ska den färdiga lösningen fungera

## Besökare

En vanlig besökare ska endast kunna:

- öppna företagets publika hemsida,
- läsa publikt innehåll,
- använda publika kontakt- och beställningsfunktioner.

Besökaren ska inte få tillgång till företagets privata API, adminportal eller data.

## Behörig användare

En medarbetare eller konsult ska:

1. öppna inloggningssidan,
2. identifiera sig säkert,
3. vid behov använda flerfaktorsautentisering,
4. komma in i rätt företagsmiljö,
5. se företagets gemensamma funktioner,
6. få alla känsliga åtgärder kontrollerade av backend.

## Flera företag

Varje företag ska ha:

- ett eget företags-id,
- egen design och domän,
- egna personliga användare och företagsmedlemskap,
- egna inställningar,
- egna dokument,
- egen ekonomidata,
- egna integrationer.

Ett företag får aldrig kunna läsa eller påverka ett annat företags data.

---

## Vad som ännu inte är färdigt

## 1. Riktig login

Personlig inloggning och MFA finns i API-servern. Driftverifiering och full pilot-UAT återstår.

Det återstår att bygga:

- personlig autentisering,
- lösenord eller extern identitetsleverantör,
- flerfaktorsautentisering,
- säkra sessioner och cookies,
- återställning av konto,
- inbjudan och avstängning av användare,
- serverkontroll på varje skyddat anrop.

## 2. Riktig backend och databas

GitHub Pages kan inte driva ett skarpt ekonomisystem.

Vi behöver därför:

- ett riktigt API,
- PostgreSQL eller motsvarande transaktionsdatabas,
- databastransaktioner,
- idempotensskydd mot dubbla anrop,
- företagsskydd i varje databasfråga,
- migrationssystem,
- test- och produktionsmiljöer.

### Enkelt förklarat

Frontend är det användaren ser. Backend är den skyddade servern som kontrollerar regler och sparar data. Databasen är det säkra arkivet där informationen lagras strukturerat.

Alla tre behövs för en riktig produktionslösning.

## 3. Säker dokumentlagring

Originalfakturor, kvitton, avtal och andra bilagor ska lagras i skyddad dokumentlagring, inte i GitHub.

Vi behöver bland annat:

- uppladdning,
- behörighetskontroll,
- versions- och revisionsspår,
- kontrollsumma,
- backup,
- bevarande enligt tillämpliga krav,
- koppling mellan dokument och affärspost.

## 4. Ny reskontra

Nästa stora verksamhetsmodul är kund- och leverantörsreskontra.

Den ska hantera:

- kunder och leverantörer,
- fakturor och kreditfakturor,
- förfallodatum,
- delbetalningar,
- restbelopp,
- överbetalningar och tillgodohavanden,
- leverantörsattest,
- betalningsförberedelse,
- koppling till verifikationsmotorn,
- skydd mot dubbelregistrering.

## 5. Bank

Det återstår att bygga den nya bankmodulen med:

- säker filimport,
- CAMT-format,
- importhistorik,
- skydd mot att samma fil eller transaktion läses in två gånger,
- matchning mot fakturor,
- granskningskö för osäkra matchningar,
- bokföring genom den nya verifikationsmotorn.

## 6. Lager och svinn

För saluhallar, butiker och restauranger behövs:

- artikelregister,
- enheter och inköpspris,
- lagersaldo,
- inventering,
- svinn och kassation,
- lagerjustering,
- inköp och försäljning,
- spårbar bokföring av lagerförändringar.

För färskvaror är svinn en central funktion, inte ett tillägg.

## 7. Rapporter, moms och bokslut

Det finns tekniska rapportgrunder och SIE 4I i den äldre lösningen, men den nya modellen behöver få:

- huvudbok,
- saldobalans,
- resultat- och balansrapport,
- momsunderlag,
- periodkontroller,
- ingående balanser,
- bokslutsstöd,
- verifierad kontoplan och rapportkoppling,
- export från den nya databasen.

## 8. Personal och lön

Det återstår att bygga eller integrera:

- personalregister,
- lönejournal,
- import från extern löneleverantör,
- personalskatt,
- arbetsgivaravgifter,
- semesterlöneskuld,
- avstämningar,
- särskild åtkomst till känsliga löneuppgifter.

## 9. Webbplatsadministration som riktig produktfunktion

Projektadmin kan redan förhandsvisa och exportera vissa webbtexter. Den färdiga produkten behöver ett riktigt innehållssystem där behöriga användare kan:

- ändra texter,
- publicera erbjudanden,
- ändra öppettider,
- hantera bilder,
- förhandsgranska,
- publicera med historik och återställning.

## 10. Produktion och drift

Innan skarp användning krävs:

- säker driftmiljö,
- domäner och TLS,
- loggning och övervakning,
- automatiska säkerhetskopior,
- provad återställning,
- incidentrutiner,
- behörighetsgranskning,
- säkerhetsgranskning,
- redovisningsmässig verifiering,
- tydlig ansvarsfördelning.

---

## Rekommenderad plan framåt

## Etapp 1 – Gör plattformen företagsneutral

Mål: referenskunden ska vara första konfigurationen, inte hårdkodad kärna.

Arbete:

- definiera en gemensam företagsmodell,
- införa företags-id i alla nya privata dataobjekt,
- separera tema, innehåll och verksamhetsinställningar,
- definiera vilka moduler ett företag kan aktivera,
- skapa en andra enkel testkund som bevis.

Klart när: samma system kan visa två olika företag utan delad privat data och utan kopierad kodbas.

## Etapp 2 – Backend, databas och riktig login

Mål: skapa den säkra gränsen till det privata systemet.

Arbete:

- bygga API,
- införa PostgreSQL,
- bygga personlig login och sessioner,
- verifiera personliga användares företagsmedlemskap,
- införa företagsisolering,
- skapa utvecklings-, test- och produktionsmiljö.

Klart när: en användare kan logga in och backend på riktigt nekar otillåtna anrop.

## Etapp 3 – Ny reskontra

Mål: färdigt flöde från faktura till betalning och bokföring.

Arbete:

- kund- och leverantörsregister,
- kundfakturor,
- leverantörsfakturor och attest,
- delbetalningar och krediter,
- koppling till den nya verifikationsmotorn,
- dokumentbilagor.

Klart när: ett komplett testfall kan gå från fakturaregistrering till betalning, bokföring och rapportspår.

## Etapp 4 – Bank

Mål: säker och spårbar avstämning.

Arbete:

- filimport,
- dubblettskydd,
- matchningsregler,
- granskningskö,
- bokföring och avstämning.

Klart när: en importerad bankhändelse kan matchas och bokföras utan dubbelregistrering.

## Etapp 5 – Lager och svinn

Mål: verksamhetsstöd för saluhall, butik och restaurang.

Arbete:

- artiklar,
- lagersaldo,
- inköp,
- inventering,
- svinn,
- lagerjustering med attest,
- bokföringskoppling.

## Etapp 6 – Rapporter, moms, lön och branschmoduler

Mål: komplett portal för småföretag.

Arbete:

- nya rapporter från databasen,
- momsflöden,
- SIE,
- löneimport och avstämning,
- webbplats-CMS,
- aviseringar och uppgifter,
- butik-, saluhalls- och restaurangspecifika moduler.

## Etapp 7 – Produktionssättning av referenskunden

Mål: första säkra och verifierade kundmiljön.

Arbete:

- dataimport,
- säkerhetsgranskning,
- redovisningsverifiering,
- återställningstest,
- användarutbildning,
- pilotdrift,
- kontrollerad övergång.

---

## Vad vi har lärt oss hittills

## 1. Börja med verkliga behov, men separera dem från kärnan

referenskunden ger oss konkreta problem att lösa. Det är bra. Men företagsnamn, design och lokala arbetssätt får inte hamna inne i de gemensamma ekonomireglerna.

## 2. Regler bör byggas före många nya sidor

Penningmodell, behörighet och verifikationsregler är mindre synliga än snygga sidor, men de avgör om systemet blir säkert och hållbart.

När reglerna är gemensamma kan flera olika gränssnitt använda dem.

## 3. GitHub Pages är mycket bra för demo, men inte för privat drift

Vi har fått en enkel automatisk demo som uppdateras när `main` uppdateras. Det är bra för granskning och utveckling.

Men statisk publicering kan inte ersätta:

- serverinloggning,
- databas,
- säker dokumentlagring,
- privata API-anrop.

## 4. Automatiska tester hittar verkliga problem

Tester har redan stoppat felaktiga ändringar, exempelvis inkonsekventa konfigurationer och svaga integritetsregler.

Det visar varför vi ska fortsätta bygga varje kritisk regel tillsammans med tester.

## 5. Pengar måste modelleras korrekt från början

Att börja med ören som heltal gör fakturor, lager, moms, bank och bokföring säkrare. Det är billigare att göra rätt nu än att migrera många felaktiga beloppsfält senare.

## 6. Behörighet är mer än en adminroll

Alla företagets medlemmar har samma funktioner. Vissa kontrollsteg kräver två olika personer. Personlig audit och isolering mellan företag är obligatoriska.

## 7. Bokföring får inte behandlas som vanliga redigerbara poster

En text på hemsidan kan skrivas över. En bokförd verifikation ska i stället rättas spårbart. Olika typer av data behöver alltså olika regler.

## 8. Den andra testkunden blir ett viktigt prov

Det bästa sättet att upptäcka referenskunden-hårdkodning är att skapa en andra testkund tidigt. Då ser vi direkt vilka delar som verkligen är återanvändbara.

## 9. Färdiga arbetsflöden är bättre än många halvfärdiga moduler

Vi bör bygga ett sammanhängande flöde i taget, exempelvis:

`leverantör → faktura → attest → betalning → bokföring → rapport`

Det ger tidigare verklig nytta och gör testningen tydligare.

---

## Vad systemet är idag

Systemet är idag:

- en publicerad utvecklingsdemo,
- en innehållsdriven publik webbplats,
- en ny modulär teknisk grund,
- en exakt penningmodell,
- en central behörighetsmodell,
- en ny verifikations- och periodmotor,
- en äldre funktionsrik referensimplementation,
- en automatiskt testad GitHub-baserad utvecklingsprocess.

Systemet är idag **inte**:

- en färdig säker SaaS-tjänst,
- en färdig produktionsinloggning,
- en riktig flerföretagsdatabas,
- ett komplett nytt reskontra- och banksystem,
- en juridiskt eller redovisningsmässigt slutgranskad produkt,
- redo för skarpa företags-, bank-, kund- eller löneuppgifter.

Detta är en viktig och positiv skillnad: grunden är genomtänkt, men vi ska inte beskriva en utvecklingsdemo som färdig produktion.

---

## Ordlista

**Frontend:** det användaren ser och klickar på.

**Backend:** den skyddade serverdelen som kontrollerar regler och sparar data.

**API:** den kontrollerade förbindelsen mellan frontend och backend.

**Databas:** strukturerad och beständig lagring av företagets information.

**Domänmodul:** en avgränsad del som innehåller verksamhetsregler, exempelvis pengar eller bokföring.

**Reskontra:** lista och historik över fakturor, betalningar och återstående belopp.

**Verifikation:** en bokföringspost med debet och kredit.

**Periodlås:** spärr som hindrar nya bokningar i en avslutad period.

**MFA:** flerfaktorsautentisering, exempelvis lösenord plus kod i mobil.

**Default deny:** allt skyddat är förbjudet tills behörighet uttryckligen ges.

**Fyrögonprincip:** en känslig process kräver två olika personer.

**Företagsisolering:** varje företags data är tekniskt avskild från andra företag.

**GitHub Pages:** statisk publicering för demo och publik webb, inte privat ekonomidrift.

---

## Slutsats

referenskunden är rätt första referenskund. Det ger projektet ett verkligt mål och en tydlig kvalitetsnivå.

Den bästa vägen är:

1. bygg hela kedjan för referenskunden,
2. håll kärnan företagsneutral,
3. lägg referenskunden-specifika delar i konfiguration och egen företagsdata,
4. bygg riktig login, backend och databas innan privat information används,
5. färdigställ ett arbetsflöde i taget,
6. skapa en andra testkund som bevis på återanvändbarhet,
7. produktionssätt först efter säkerhets-, drift- och redovisningskontroller.

På så sätt får vi både ett tydligt exempelresultat för referenskunden och en grund som kan växa till ett komplett system för många småföretag.
