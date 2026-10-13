# Visuell kontrastgranskning – 2026-10-12

## Underlag och avgränsning

Jag granskade **renderade Chromium-skärmbilder** från GitHub Actions QA, inte enbart stilmallar eller automatiska testresultat:

- 25 vyer × 4 skärmstorlekar (1440, 1024, 768 och 390 px) × ljust/mörkt läge = **200 skärmbilder**.
- Verkligt renderade popupbilder från kundreskontrans kvittningsdialog i båda teman.
- GitHub QA-artifact: [Rollands UI review / visual screenshots](https://github.com/ludwigberglund-coder/LT-Studio/actions/runs/38292855641) (artifacts har begränsad lagringstid).
- Publik inloggad Supabase-UAT kontrollerades **inte** manuellt. Det är ett UI-test med syntetiskt demonstrationsinnehåll; autentiserade och ännu inte öppnade dialogtillstånd täcks inte fullständigt.

## Faktiska synlighetsproblem i skärmbilderna

1. Översiktens mörkgröna knapp *Rekommenderat nästa steg* visade mörk/svag text, framför allt i ljust läge.
2. Räknebrickorna på uppgiftskorten hade mörk text på mörk bakgrund i mörkt läge.
3. Hamburgermenyns Iconoir-linjer hade bristande kontrast i mörkt läge.
4. Användaravatarens initialer, användaretiketter och aktiv navigation behövde egna kontrastregler.
5. Kryssknappen som stänger kundreskontrans kvittningspopup hade för låg kontrast i mörkt läge.
6. Driftadmins inloggningssymbol hade svag avgränsning mot sin gradient.

## Korrigering

Uppdatera **endast** det befintliga gemensamma färglagret `packages/shared/browser/theme-contrast.css`, utan en ny konkurrerande temasnurra. Använd en tydlig ljus/mörk färg per faktisk yta, och vit text på mörka primärknappar oavsett globalt tema. Ikonernas SVG-stroke måste också synas, inte bara ärva en färg som förlorar kontrast.

## Regressionstester

- `test/visual-design-browser.cjs`: kontrollerar WCAG-liknande kontrastkvot (4,5:1 för text och 3:1 för ikonsymboler) på rekommenderad åtgärd, uppgiftsnummer, menyikon, användaravatar och aktiv navigering i samtliga testade skärmstorlekar och teman.
- `test/settlement-theme-browser.cjs`: granskar stängningsknappens kontrast i båda temana och tar mobilbilder med kontroll av att popup och stängningsknapp inte klipps.
- `test/theme-readability.test.js`: säkerställer att kontrastregler och interaktiva tester finns kvar.

## Godkännandekriterium

Innan merge måste Quality, CodeQL, Supabase clean rebuild och de utökade Chromium-testerna bli gröna. Inspektera sedan nya renderade skärmbilder visuellt igen. Skyddsregler och betalnings-/bokföringslogik får inte försvagas för att få gröna tester.

## Begränsning

Detta är **inte ett löfte om att varje tänkbart framtida popupfönster eller varje personlig tenantvy är kontrollerad**. Upptäckta brister och verifierade vyer framgår ovan. Fortsatt faktisk UAT med riktiga roller men syntetisk testdata behövs innan bredare lansering.
