# Personlig autentisering och företagsmedlemskap

Alla personliga, autentiserade användare i samma företag har samma behörighet. Inga interna användarroller eller behörighetsnivåer tilldelas.

## Säkerhetsgränsen

Varje skyddat API-anrop kräver en giltig serverlagrad session. Databasen kopplar sessionen till en aktiv användare och ett fortfarande existerande medlemskap i det valda företaget. Saknat medlemskap, avstängt konto eller utgången session nekar åtkomst direkt. Ett objekt hämtas eller ändras med sessionens företags-ID, aldrig ett företags-ID som klienten skickar in.

MFA krävs för alla inloggningar. Lösenordsskydd, TOTP-engångsförbrukning, idle-/absolut sessionstid, CSRF och inloggningens försöksspärr kvarstår. Felräknaren lagras i SQLite som en SHA-256-nyckel av nätverksadress + normaliserat användarnamn, så spärren överlever serveromstart utan att spara dessa värden i klartext. Audit identifierar den person som faktiskt utförde åtgärden. Frontendnavigation är aldrig en säkerhetsgräns.

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

## Kontorecovery

Kontorecovery är ett offline-driftsflöde och ska endast användas när en personlig användare inte kan återfå åtkomst genom normal inloggning. Kör `npm run platform:recover-account -- --apply` med privata environment-värden för mål-användare, nytt lösenord, ny MFA-hemlighet, aktuell autentiseringsnyckel, recoveryärende och två godkännare.

Båda godkännarna måste vara två olika aktiva personliga användare, får inte vara kontoinnehavaren och måste vara medlemmar i samtliga företag som det återställda kontot tillhör. Recovery byter lösenord och MFA i samma databastransaktion, återkallar alla sessioner, rensar använda MFA-steg och skriver en audit-händelse i varje berört företag med recoveryreferens och båda godkännarnas identitet. Lösenord, MFA-hemlighet och krypteringsnyckel skrivs inte i audit eller terminalutskrift.

Den persistenta inloggningsspärren rensas medvetet inte av recovery. Om kontot är spärrat efter felaktiga försök kan återinloggning därför kräva att 15-minutersfönstret löper ut. Detta undviker att recovery används för att kringgå brute-force-skyddet.

## Testbevis

- `membership-migration.test.js`: bevarade konton, medlemskap och audit, sessionsåterkallelse, upprepad uppstart och rollback vid injicerat migrationsfel.
- `company-membership-http.test.js`: två personliga medlemmar har samma åtkomst i 14 API-familjer; anonym åtkomst, indraget medlemskap och avstängt konto nekas; företagsfrämmande läsning, PDF och mutation nekas; MFA krävs även för nya konton.
- `access-control.test.js`: samma definierade åtgärder för alla medlemmar, nekad ogiltig identitet och fortsatt personseparation.
- Övriga HTTP-, CSRF-, tenant- och webbläsartester körs i full CI. `npm test` upptäcker nu alla `test/*.test.js` automatiskt.

Testmatrisen är inte ett påstående om fullständig täckning av varje route/metod/objekt. Full drift-UAT och återstående polymorfa objektrelationer är fortsatt pilotpunkter. **NO-GO för verkliga verksamhetsdata kvarstår.**
