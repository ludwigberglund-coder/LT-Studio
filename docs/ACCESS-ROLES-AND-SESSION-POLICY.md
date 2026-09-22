# Behörigheter, LT Studio global admin och personlig sessionstid

Datum: 2026-09-22

## Företagsroller

LT Studio använder fyra explicita roller per företagsmedlemskap. Servern fattar alltid det slutliga behörighetsbeslutet; frontend är endast en presentation av samma rättigheter.

### Admin / huvudanvändare

Kan administrera företagets verksamhet och ekonomi, men kan inte skapa användarkonton, byta lösenord eller ändra användarroller. Kontohantering är reserverad för LT Studios separata operatorportal.

### Ekonom

Kan arbeta med samtliga ekonomiska delar, inklusive lön, rapporter, bokföring, fakturor, betalningar, bank, dokument och lagerrelaterad ekonomi. Rollen får inte hantera företagsanvändares roller, plattformsinställningar eller webbplatsadministration.

### Attestant

Kan läsa ekonomisk information utom lön och får attestera leverantörsfakturor. Rollen får inte bokföra, frisläppa betalningar, ändra masterdata eller göra andra normala skrivåtgärder.

### Läsbehörighet

Kan läsa tillåtna företags- och ekonomivyer men får inte ändra data. Lön är uttryckligen exkluderad.

## Migrering

När rollsystemet införs migreras befintliga företagsmedlemskap till `admin`.

Detta är avsiktligt för att undvika att befintliga konton låses ute vid uppgraderingen. Därefter kan LT Studio ändra rättigheterna via den separata operatorportalen.

När en roll ändras återkallas den berörda användarens aktiva sessioner.

## LT Studio global admin

Ett personligt användarkonto kan markeras som **LT Studio global admin**.

Ett sådant konto:

- kräver fortfarande personligt lösenord och MFA,
- kan välja alla företag som finns i plattformen,
- får rollen `admin` i det företag som öppnas,
- behöver inte läggas in som vanligt medlemskap i varje kundföretag,
- loggas i företagets audit trail vid inloggning,
- förlorar omedelbart sin globala åtkomst om flaggan tas bort.

Global admin aktiveras aldrig automatiskt från användarnamn eller e-post. Det kräver en explicit administrativ åtgärd.

Exempel för en verifierad LT Studio-användare:

```sh
export ROLLANDS_DATABASE_PATH=/säker/sökväg/platform.sqlite
export ROLLANDS_GLOBAL_ADMIN_USERNAME=anvandarnamn
npm run platform:set-global-admin -- --enable --apply
```

Avaktivering görs med `--disable --apply`. Kommandot återkallar användarens aktiva sessioner.

### Readiness för verklig kunddata

I pilot och produktion rapporteras systemet inte som ready om det saknas minst ett aktivt LT Studio global-admin-konto vars MFA-hemlighet kan dekrypteras och valideras med den aktuella servernyckeln. Staging använder syntetisk data och blockeras därför inte av denna kontroll.

Detta förhindrar ett falskt grönt läge där ett global-admin-konto ser korrekt ut i databasen men i praktiken inte går att använda för säker inloggning.

## Personlig inloggningstid

Varje personligt konto kan välja:

- Varje gång
- 2 timmar
- 4 timmar
- 6 timmar
- 8 timmar

### Varje gång

Använder en webbläsarsession utan permanent `Max-Age` på sessionscookien. När webbläsarsessionen avslutas krävs ny inloggning. Serversidan behåller dessutom ett åttatimmars absolut säkerhetstak, så en öppen webbläsare kan inte hålla sessionen vid liv obegränsat.

### 2 / 4 / 6 / 8 timmar

Valet är en absolut maxgräns. Aktiv användning får inte förlänga sessionen förbi den valda tiden.

Systemets separata inaktivitetsgräns gäller fortfarande och kan därför logga ut användaren tidigare om kontot lämnas oanvänt.

När en användare ändrar inställningen:

1. den nya preferensen sparas server-side,
2. ändringen auditloggas,
3. samtliga befintliga sessioner för användaren återkallas,
4. användaren måste logga in igen,
5. den nya sessionen får den nya absoluta sluttiden.

## Säkerhetsprinciper

- saknad eller okänd roll = deny,
- rollen läses från databasen vid varje request,
- tenant-isolering kontrolleras separat från rollen,
- rolländring återkallar gamla sessioner,
- global admin är explicit och MFA-skyddad,
- lönebehörighet är separat och saknas för Attestant och Läsbehörighet,
- servern litar aldrig på att en knapp är dold i frontend.


## Kundkonton hanteras endast av LT Studio

Kundföretag kan inte själva skapa användare eller administrera andra användarkonton.

Den separata LT Studio-operatorportalen är den enda normala administrativa vägen för att skapa användarkonton, ändra roller, återställa lösenord och ta bort användarens åtkomst till ett kundföretag.

Kundportalens tidigare sida **Användare & behörigheter** och dess privata kund-API är borttagna. Detta är en serverregel, inte bara dold navigation.
