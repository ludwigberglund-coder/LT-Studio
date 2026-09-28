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

## Etapp 2 – gemensamma sökytor

- kundreskontra, leverantörer och leverantörsfakturor delar samma visuella sökprincip
- sökfält har gemensam radie, fokusram och lågmäld skugga
- popup-listor är solida och högkontrastiga, inte genomskinliga
- aktiv resultatrad har samma tydliga markering i ljust och mörkt läge
- befintlig tangentbordsnavigering och ARIA-semantik behålls
- leverantörssökningen använder Iconoir även för sökikonen
- reduced motion respekteras

## Etapp 3 – gemensamma formulärytor

- faktura-, kund-, bokförings-, löne-, CMS-, dokument-, lager- och inställningsformulär delar samma kontrollstil
- input, select och textarea får konsekvent radie, kant, skugga och fokusindikator
- disabled och readonly är tydligt visuellt skilda från redigerbara fält
- checkboxes och radio behåller native funktion men följer LT Studios accent
- mörkt läge har egna tokenbaserade formulärvärden
- reduced motion respekteras
- sökfält påverkas inte av denna etapp utan fortsätter använda den separata sökdesignen
- inga fältordningar, valideringsregler, submit-flöden eller Supabase-anrop ändras

## Etapp 4 – gemensamma dialoger

- portalens kritiska beslut använder LT Studios egen dialog i stället för browser-native alert/confirm/prompt
- samma dialogkomponent stödjer information, bekräftelse och textinmatning
- Escape, Tab-fokusfälla och återställning av tidigare fokus ingår i den gemensamma komponenten
- befintliga bunt-, betalnings-, dokument-, leverantörs- och standardmodaler får samma visuella skal
- mörkt läge, reduced motion och reduced transparency stöds
- massregistrering av buntar, avvisningsorsaker, periodupplåsning, osparade fakturautkast, datumrättelser, UAT-reset och CMS-återställning använder LT Studio-dialoger
- affärslogik och API/Supabase-anrop lämnas oförändrade
- regressionstest förbjuder browser-native dialoger i portalmodulerna
- UI-regressionstester avgränsas till respektive etapps CSS-sektion så att senare, avsiktliga effekter inte ger falska fel

## Etapp 5 – navigation och topbar

- gemensam topbar får konsekvent höjd, spacing och kontrollordning
- navigationens ikonkolumn och textlinje är stabila på alla portalsidor
- aktiv menyrad får tydligare djup utan att bli visuellt tung
- 11–13-tums laptopläge använder en kompakt 236 px sidebar för mer arbetsyta
- mobil drawer blir en tydlig enkolumnslista med minst 44 px höga träffytor
- rubriker får säker ellipsis i smala topbars i stället för layoutbrott
- befintligt fokusläge/collapse-beteende bevaras
- reduced motion stöds

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
- PR #585 hanterar buntdialoger och felmeddelanden som första referens

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
