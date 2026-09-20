# Personlig autentisering och företagsmedlemskap

Alla personliga, autentiserade användare i samma företag har samma behörighet. Inga interna användarroller eller behörighetsnivåer tilldelas.

## Säkerhetsgränsen

Varje skyddat API-anrop kräver en giltig serverlagrad session. Databasen kopplar sessionen till en aktiv användare och ett fortfarande existerande medlemskap i det valda företaget. Saknat medlemskap, avstängt konto eller utgången session nekar åtkomst direkt. Ett objekt hämtas eller ändras med sessionens företags-ID, aldrig ett företags-ID som klienten skickar in.

MFA krävs för alla inloggningar. Lösenordsskydd, TOTP-engångsförbrukning, idle-/absolut sessionstid, CSRF och inloggningens försöksspärr kvarstår. Audit identifierar den person som faktiskt utförde åtgärden. Frontendnavigation är aldrig en säkerhetsgräns.

`config/access-control.json` innehåller kända åtgärder och gemensamma kontrollregler. Åtgärdslistan tilldelas inte individuellt: samtliga företagsmedlemmar får använda alla definierade åtgärder. Den används för att neka okända operationer och beskriva arbetsflöden.

## Personseparation

Befintliga krav på olika personer vid leverantörsattest, ändrade betalningsuppgifter, betalningsfrisläppning, periodupplåsning och lagerjustering finns kvar. Alla medlemmar kan utföra båda stegen, men samma person kan inte kontrollera sin egen åtgärd när flödet kräver en andra person. Detta är en kontroll av händelsehistoriken, inte olika behörighetsnivåer. Det är en produktregel och ska inte beskrivas som ett generellt lagkrav.

## Säker uppgradering

1. Ta och verifiera backup, inklusive MFA-krypteringsnyckeln separat. Prova uppgraderingen på en isolerad kopia.
2. Den gamla medlemskapskolumnen `roles_json` tas bort i en databastransaktion. Konton, medlemskap, datum, lösenord, MFA-hemligheter och historiska auditposter bevaras.
3. Tidigare sessioner avslutas i samma transaktion. Alla behöver logga in igen med MFA. Ett konto som tidigare saknade MFA måste först få personlig MFA konfigurerad via den befintliga, spårbara återställningsrutinen.
4. Om migreringen misslyckas rullas både kolumnändringen och sessionsåterkallelsen tillbaka. Uppstarten stoppas.
5. Upprepad uppstart förändrar inte medlemskap eller nya sessioner.

Återgång till gammal kod kräver en separat verifierad backup och plan för data som skapats efter uppgraderingen. Återställ aldrig en gammal databas ovanpå nya ekonomiska händelser utan avstämning. Gamla auditposter kan beskriva tidigare rolltilldelningar; historiken skrivs inte om.

## Testbevis

- `membership-migration.test.js`: bevarade konton, medlemskap och audit, sessionsåterkallelse, upprepad uppstart och rollback vid injicerat migrationsfel.
- `company-membership-http.test.js`: två personliga medlemmar har samma åtkomst i 14 API-familjer; anonym åtkomst, indraget medlemskap och avstängt konto nekas; företagsfrämmande läsning, PDF och mutation nekas; MFA krävs även för nya konton.
- `access-control.test.js`: samma definierade åtgärder för alla medlemmar, nekad ogiltig identitet och fortsatt personseparation.
- Övriga HTTP-, CSRF-, tenant- och webbläsartester körs i full CI. `npm test` upptäcker nu alla `test/*.test.js` automatiskt.

Testmatrisen är inte ett påstående om fullständig täckning av varje route/metod/objekt. Full drift-UAT och återstående polymorfa objektrelationer är fortsatt pilotpunkter. **NO-GO för verkliga verksamhetsdata kvarstår.**
