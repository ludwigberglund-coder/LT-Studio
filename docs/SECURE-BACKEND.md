# Säker backend – vad som finns och vad som krävs före skarp drift

## Kort förklaring

GitHub Pages är vår öppna demo. Den är bra för att visa design och arbetsflöden, men den är **inte** en säker plats för verklig ekonomidata.

Den nya backendgrunden under `apps/api/` är därför ett separat serversystem. Den gör de kontroller som en webbläsare aldrig ska få ansvara för själv:

- vem användaren är,
- vilket företag användaren tillhör,
- vilka roller personen har,
- om åtgärden är tillåten,
- om formuläret kommer från en giltig inloggad session,
- vilket företags data som får läsas eller ändras,
- hur ändringen sparas och loggas.

## Viktig gräns

Den publika GitHub Pages-adressen innehåller fortfarande **demodata** och får användas av vem som helst.

Den riktiga företagsportalen ska i skarp drift köras tillsammans med `apps/api/server.js` bakom HTTPS. Riktiga kunder, fakturor, bankhändelser, personuppgifter eller löneuppgifter ska aldrig läggas i GitHub eller GitHub Pages.

## Delarna i backend v1

### Personliga konton

Användare identifieras med ett eget konto. Delade administratörsnycklar ska inte vara den långsiktiga modellen.

Lösenord lagras inte som vanlig text. Servern använder `scrypt` med separat slumpmässigt salt.

### MFA

Roller som kan utföra kritiska åtgärder kräver flerfaktorsautentisering. TOTP-hemligheten krypteras med AES-256-GCM innan den lagras.

Krypteringsnyckeln kommer från servermiljön och ska aldrig läggas i GitHub.

### Serverlagrade sessioner

Efter inloggning får webbläsaren en slumpmässig sessionsnyckel i en `HttpOnly`-cookie.

Databasen lagrar endast hashvärdet av sessionsnyckeln. Cookien använder `SameSite=Strict` och i skarp drift `Secure`.

### CSRF-skydd

Alla API-anrop som ändrar data kräver ett separat CSRF-värde. Det gör det svårare för en annan webbplats att lura en inloggad användare att skicka en otillåten ändring.

### Default deny

Backend använder samma centrala behörighetsmodell som resten av plattformen. Om en rättighet inte uttryckligen finns blir svaret nej.

Frontend får alltså inte själv bestämma om en användare får göra något.

### Företagsisolering

Alla privata affärsobjekt hör till ett internt `companyId`.

En faktura hämtas exempelvis med både:

- företagets id,
- fakturans id.

Om en inloggad användare känner till id:t till ett annat företags faktura ska den ändå inte gå att läsa. API:t svarar då som om posten inte finns.

### Transaktioner

Databasen använder riktiga databastransaktioner. Om ett arbetsflöde innehåller flera steg och ett steg misslyckas ska hela ändringen rullas tillbaka i stället för att lämna halvfärdig data.

### Revisionslogg

Viktiga serverhändelser loggas med företag, personlig användare, händelsetyp, objekt och tid.

## Databasval i denna fas

Backend v1 använder Node 24:s inbyggda SQLite-stöd.

Det är ett stort steg framåt från en enda JSON-fil eftersom vi får:

- tabeller och datatyper,
- unika nycklar,
- främmande nycklar,
- transaktioner,
- index,
- strikt företagskoppling,
- samtidighetsskydd via databasmotorn.

SQLite är lämpligt för utveckling, tester och en kontrollerad enserverpilot. Innan plattformen drivs som en skalad molntjänst för många företag bör datalagret flyttas till PostgreSQL eller motsvarande serverdatabas. Domänmodellerna och API-gränserna ska utformas så att detta byte inte kräver att affärsreglerna byggs om.

## Starta en privat utvecklingsmiljö

Skapa aldrig lösenord eller MFA-hemligheter i källkod.

Exempel på servervariabler som behöver sättas i driftmiljön:

```text
ROLLANDS_DATABASE_PATH
ROLLANDS_AUTH_ENCRYPTION_KEY
ROLLANDS_ALLOWED_HOSTS
ROLLANDS_API_HOST
ROLLANDS_API_SECURE_COOKIE
```

För det allra första kontot används bootstrap-kommandot. Det gör ingen ändring utan den uttryckliga flaggan `--apply`.

```text
ROLLANDS_BOOTSTRAP_USERNAME
ROLLANDS_BOOTSTRAP_DISPLAY_NAME
ROLLANDS_BOOTSTRAP_PASSWORD
ROLLANDS_BOOTSTRAP_ROLES
ROLLANDS_BOOTSTRAP_MFA_SECRET
ROLLANDS_AUTH_ENCRYPTION_KEY
```

Därefter:

```bash
npm run platform:bootstrap -- --apply
npm run api
```

Hemligheter ska sättas av driftmiljön eller en riktig secrets manager, aldrig genom att checkas in i GitHub.

## Produktionskrav som fortfarande återstår

Backendkoden är en verklig servergrund, men en skarp molntjänst kräver fortfarande:

1. HTTPS och säker reverse proxy/load balancer.
2. Produktionsdatabas och automatiska databasbackuper.
3. Säker dokumentlagring för PDF:er, kvitton och originalunderlag.
4. Backup som regelbundet återställningstestas.
5. Central loggning, övervakning och larm.
6. Secrets manager och nyckelrotation.
7. Automatisk säkerhetsuppdatering och sårbarhetskontroll.
8. Incidentrutiner och åtkomstgranskning.
9. Databas-migrationer som körs kontrollerat mellan versioner.
10. Penetrationstest och extern säkerhetsgranskning före bred skarp användning.
11. PostgreSQL eller annan serverdatabas när flera samtidiga produktionsinstanser behövs.

## Princip för fortsatt utveckling

Varje ny privat modul ska följa samma ordning:

```text
personlig session
→ företagstillhörighet
→ behörighet
→ validering
→ databastransaktion
→ revisionslogg
→ svar till portalen
```

Det gör att säkerhetsreglerna inte behöver uppfinnas på nytt för kundreskontra, leverantörsfakturor, bank, lager eller lön.
