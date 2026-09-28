# LT Studio UI 2.0 – Apple-inspirerad designplan

## Syfte

LT Studio ska kännas lika genomarbetat och lugnt som ett modernt Apple-gränssnitt utan att bli en kopia av macOS och utan att offra läsbarhet i ekonomiska arbetsflöden.

Grundprincipen är:

- mer Apple-inspiration i navigation, topbar, popup-menyer, sökfält och modaler
- mindre Apple-effekter i tabeller, bokföringsrader, huvudbok och täta ekonomiska vyer
- LT Studios egna färger och Iconoir-ikoner behålls
- ljust och mörkt läge ska alltid fungera parallellt
- animationer ska vara diskreta, funktionella och respektera reduced motion
- transparens får aldrig försämra kontrast eller ekonomisk läsbarhet

## Etapp 1 – implementerad i denna PR

- gemensam topbar med mjuk materialkänsla och blur där webbläsaren stöder det
- tydligare separation mellan navigation och arbetsyta
- mer konsekventa rundningar och skuggor för menyknapp, tema och profil
- profilmenyn får tydligare lager och popup-känsla
- sidomenyn får lugnare spacing och tydligare aktiv markering
- Översikt får mer konsekventa kort, rundningar och visuell hierarki
- mörkt läge har egna materialvärden
- fallback finns om backdrop-filter inte stöds
- reduced transparency respekteras när webbläsaren exponerar det

## Nästa etapper

### Navigation och topbar

- finjustera desktop/mobil spacing på alla portalsidor
- säkerställ att ikonkolumn, text och aktiva tillstånd är identiska överallt
- kontrollera att tema- och profilkontroller alltid ligger i samma ordning
- testa komprimerad sidebar/fokusläge på små laptopskärmar

### Modaler och bekräftelser

- standardisera gemensam LT Studio-modal för bekräftelser och varningar
- använd mjuk backdrop-blur endast bakom dialogen
- primär handling tydlig, sekundär handling diskret
- full tangentbordsnavigering, Escape och fokusfälla
- aldrig browser-native confirm/prompt i slutliga kritiska arbetsflöden
- PR #584 hanterar buntgodkännande som första referens

### Sökfält och popup-listor

- gemensam stil för sökfält med tydlig fokusindikator
- förslag ska visas i en separat, lätt upphöjd lista
- konsekvent tangentbordsnavigering och aktiv rad
- popup-ytor kan använda lätt materialkänsla, men resultaten ska vara solida och lättlästa

### Formulär

- bättre gruppering av relaterade fält
- något mjukare inputytor och mer konsekventa radier
- tydliga labels och hjälptexter
- inga överdrivna animationer i datainmatning

### Dashboard och kort

- fortsätt använda färg sparsamt för status och prioritet
- håll de viktigaste uppgifterna först
- animationer ska förklara interaktion eller status, inte dekorera utan syfte
- undvik informationsöverlastning

### Tabeller, reskontra och bokföring

Dessa ska INTE göras glasiga.

- solida bakgrunder
- hög kontrast
- tydliga kolumnrubriker
- centrerad numerisk information där det minskar feltolkning
- hover får vara diskret
- ekonomiska belopp ska förbli snabba att skanna
- tätare layout än övriga kortbaserade vyer

### Buntar

- behåll dataområdet solitt
- godkännandedialog kan använda Apple-inspirerad modalstruktur
- status, debet, kredit och kontrollresultat ska synas tydligt
- undvik visuell effekt som kan dölja att godkännande är definitivt

### Tillgänglighet och kvalitet

- verifiera WCAG-kontrast i båda teman
- reduced motion ska respekteras
- reduced transparency ska respekteras där möjligt
- tangentbordsnavigering ska fungera för popup-menyer, modaler och sidebar
- UI-förändringar ska testas i GitHub Pages-UAT innan bred utrullning

## Designregel

Ju mer en yta handlar om navigation, orientering och övergripande kontroll, desto mer Apple-inspiration kan användas.

Ju mer en yta handlar om bokföringsdata, reskontra, verifikationer eller exakta belopp, desto mer ska designen prioritera densitet, kontrast och stabilitet framför visuella effekter.
