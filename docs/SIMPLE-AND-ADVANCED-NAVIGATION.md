# Förenklad navigation för småföretagare – genomförandeplan

Datum: 2026-10-12
Huvudärende: [#749](https://github.com/ludwigberglund-coder/LT-Studio/issues/749)
Närliggande produktplan: [#727](https://github.com/ludwigberglund-coder/LT-Studio/issues/727)
Status: Etapp 1 – kundvänlig navigation med frivilligt avancerat läge.

## Vad vi har sett i verklig kod

Kundportalen använder `apps/portal/portal-nav.js`. Den har många direkt synliga menyval: kund- och leverantörsreskontra, buntar, automationskö, kontoplan, bokföring, bank och oplacerade betalningar. Användare utan redovisningsvana måste i dag välja bland specialistord. Behörigheter filtreras genom `visibleGroups`; den befintliga kontrollen ska fortsätta vara grunden för båda visningslägena.

Granskningen gäller GitHub-koden, **inte** ett komplett inloggat test av alla kundflöden. UAT är ännu inte godkänd för skarpa ekonomidata.

## Målbild: två visningslägen

**Enkelt (standard för en ny inloggad kund)**
1. Kom igång → Översikt
2. Fakturor → Kundfakturor, obetalda fakturor och kunder
3. Inköp & kvitton → Leverantörsfakturor, PDF-underlag, leverantörsskulder och leverantörer
4. Pengar & bank → Bankhändelser, betalningar att hantera, övriga betalningar
5. Resultat & rapporter → Rapporter
6. Månad & bokslut → Befintlig månadsavstämning/bokföring, bokslut
7. Inställningar → Företagsinställningar om behörig

**Avancerat (valfritt, tydlig växel)**
Befintlig fullständig rollstyrd navigation med kontoplan, buntar, automationskö, lager, lön, webbplats m.m. Äldre demo/testlänkar visas bara i uttryckligt demoflöde, precis som tidigare.

Det enkla läget ska använda **befintliga sidor**, inte duplicera affärsflöden eller uppfinna ny databas. Alla befintliga direktlänkar ska fortsätta fungera och användare ska kunna öppna avancerade funktioner när de behöver dem.

## Etapper

### Etapp 1 – lättare meny och lägesväxel (denna PR)
- Bygg enkel meny från **redan behörighetsfiltrerade** menyobjekt.
- Behåll fullt avancerat läge och alla ursprungliga URL:er.
- Växel med tydliga svenska etiketter, knapptillgänglighet och visuellt markerat läge.
- Spara visningsval för aktuell användare + företag när identiteter är kända. Uppgiften lagras enbart som UI-preferens, ingen behörighetsinformation.
- Visa avancerat läge tillfälligt vid besök på avancerad direktlänk så att aktuell sida går att lokalisera; ändra inte användarens sparade val.
- Låt särskilt **oplatserade/o-placerade betalningar** vara en tydlig nybörjarhandling.
- Regressionstester för behörigheter, menykartor och säkerhet. Ingen ekonomisk mutation.

### Etapp 2 – begripligare arbetsflöden
- Länka kundreskontra från fakturor, leverantörsreskontra från inköp och omatchade betalningar från bank utan dubbla system.
- En gemensam förklarande statusstruktur: vad behöver göras, varför, var kommer uppgifterna ifrån, vad händer om den godkänns.
- Bevara underliggande audit, verifikationer, godkännanden, periodlås och felhantering.
- Samarbeta med #728 (PDF-inkorg) och #745 (bokslut) och andra pågående PR:er. Inget parallellt ägande av samma kodfiler.

### Etapp 3 – anpassning och användartest
- Visa lager, lön och webbplats i enkelt läge först när aktuellt företag faktiskt använder dem (och har behörighet); aldrig dölj enda vägen till en aktiv kritisk uppgift.
- Använd fem syntetiska kundfall: skapa/skicka faktura; PDF-underlag; manuell/omatchad betalning; månadsavstämning; hitta en äldre verifikation.
- Registrera antal klick, onödiga val, fel, varningar och om användaren hittar växeln. Testa mobil, tangentbord, fokusordning, mörkt läge och kontobyte.
- Om ekonomidata inte kan läsas ska UI visa ofullständig status – inte antyda att allt är klart.

## Risker / invariants
- Läge är endast **presentation**. Det får aldrig skapa/utöka roller eller bypassa RLS/RPC/CSRF/MFA.
- Dolda funktioner ska kunna nås via avancerat läge, av behöriga användare, inklusive på mobil.
- Bokförings-/revisionsspår, säkerhetsloggar, verifikationer och underlag ska **inte tas bort**.
- GitHub är sanningskälla för kod; riktiga företagsdata ligger skyddat i verksamhetssystemet, inte GitHub.
- Skydda inloggningsgränser och bevara alla befintliga djuplänkar.
- GitHub main → egen branch → tester/Quality/CodeQL/Supabase rebuild → PR → merge → inloggad UAT med **syntetiska data**.

## Klart när
- De sju nybörjargrupperna är filtrerade med användarens befintliga behörighet.
- Avancerat läge visar alla de tidigare tillåtna sidorna.
- Läge kan bytas snabbt utan ekonomiska sidoeffekter.
- En annan användares/företags preferens återanvänds inte.
- Mobil, tangentbord, fokusering och direktlänkar är testade.
- PR och senare UAT har verifierbara testbevis innan påståenden om produktionsklarhet.

## Samordning

Vid start 2026-10-12 var följande PR:er öppna: #715 (Liquid Glass, ej `portal-nav.js`), #747 (månadsavstämning), #748 (bokslut), samt Dependabot #719/#720. Denna etapp avgränsas till gemensam navigation, meny-CSS, testspecifikation och denna plan för att minska konflikter. Senare etapper måste kontrollera nya PR:er innan nya filer vidrörs.
