# Fortsatt kontroll av privat PDF och webbplatsutkast

Granskad 2026-09-18. Uppföljning till [privat drift och förhandsvisning](PRIVATE-RUNTIME-AND-PREVIEW.md). **Pilot med verkliga uppgifter är fortfarande NO-GO.**

## Fel som återskapades och rättades i PR 68

- Internationella PDF-filnamn kunde orsaka HTTP 500 när de lades direkt i svarshuvudet. Svaret använder nu säkert ASCII-reservnamn och UTF-8-kodat filnamn enligt RFC 6266. Originalfilens innehåll ändras inte.
- En leverantörs-PDF kunde hämtas trots att dess innehåll inte längre stämde med det sparade fingeravtrycket. Servern kontrollerar nu SHA-256 vid läsning och före attest. Fel ger ett begripligt konfliktmeddelande, inte en ny automatisk kontrollsumma eller lyckad attest.
- Hämta senaste sparade kunde ersätta ett öppet CMS-formulär med en felsida om nätverket försvann. Serverns senaste utkast ersätter nu formuläret först efter ett komplett lyckat svar. Även ett ofullständigt svar med HTTP 200 behandlas som ett osäkert resultat; texten behålls och ingen lyckad lagring påstås.

PDF-visningen begär första sidan anpassad till bredden utan sidminiatyrer. Originalet visas i en autentiserad iframe; ny flik är tillgänglig. Resultatet måste granskas visuellt i CI eftersom en godkänd HTTP-hämtning inte i sig bevisar läsbar visning.

## Verifiering

Två ytterligare HTTP-tester återskapar filnamnsfelet och en ändrad PDF. Felaktigt underlag kan varken hämtas eller attesteras och skapar ingen lyckad attesthändelse. CMS-webbläsartestet omfattar också misslyckad omladdning samt avsiktligt ofullständigt serversvar.

287 Node-tester passerade lokalt på Node 24.11.1. Nätverket till npm-registret var inte tillgängligt lokalt; den lokala PDF-körningen använde därför den byte-verifierade pdf-lib-distributionen från projektets tidigare godkända GitHub Pages-artefakt. GitHubs ordinarie `npm ci` och fulla tester är fortfarande den bindande kontrollen före sammanslagning.

CI 35324504264 godkände Node-tester och befintliga demowebbläsarflöden, men det privata webbläsartestet stoppades vid Chromium-start eftersom nedladdad Chromium saknade användbar sandbox i runnerns miljö. Inga privata webbläsarsteg passerade i den körningen. Testet använder nu runnerns installerade Chrome-kanal med sandbox aktiverad. Ingen AppArmor-, kernel- eller CSP-policy ändras och ingen testkontroll hoppas över. Den nya körningen och dess skärmbilder måste godkännas före merge. Aktuellt slutresultat registreras i PR 68:s diskussion och Actions.

Endast de negativa nätverksproven avbryter eller ersätter testanrop. Positiva flöden använder verklig inloggning/MFA, API och SQLite. Kundens PDF öppnas via den riktiga knappen; testet skriver inte över webbläsarens URL-funktioner eller byter ut PDF-innehållet.

## Fortsatt avgränsning

SHA-256-kontrollen är inte en virusskanning, digital signatur eller ett skydd mot någon med full server-/databaskontroll. PDF-visning är inte färdig långtidsarkivering av exakt utfärdad kund-PDF. En publicerad CMS-version sparas i databasen men uppdaterar inte automatiskt extern webbdrift eller GitHub Pages.

Ytterligare en blockerare har reproducerats i [ärende 69](https://github.com/ludwigberglund-coder/Rollands/issues/69): attest kan avse en senare konteringsversion än den granskaren såg. Osparade konteringsändringar i privat portal kräver också tydlig hantering. PR 68 löser inte denna versionsbindning. Ingen verklig pilot får starta innan det och övriga relevanta blockerare i [pilotchecklistan](ROLANDS-PILOT-READINESS-CHECKLIST.md) är lösta.

## Primära tekniska källor

- RFC 6266, filnamn i Content-Disposition: https://www.rfc-editor.org/rfc/rfc6266.html
- Chromium, PDF-parametrar: https://chromium.googlesource.com/chromium/src/+/HEAD/chrome/browser/resources/pdf/open_pdf_params_parser.ts
- Chromium, stöd för Chrome stable i Ubuntus AppArmor-profil: https://chromium.googlesource.com/chromium/src/+/main/docs/security/apparmor-userns-restrictions.md
- Playwright, Chrome-kanal och chromiumSandbox: https://playwright.dev/docs/api/class-browsertype

Källorna kontrollerades 2026-09-18. Inga ändringar av svenska bokförings- eller momsregler görs i denna PR.
