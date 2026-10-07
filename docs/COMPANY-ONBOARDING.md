# Kundonboarding

GitHub är source of truth för LT Studios kundonboarding.

## Mål

LT Studio-operatörer ska kunna lägga till riktiga kundföretag från Driftadmin utan att skapa lösenord åt kunden eller ge operatören automatisk åtkomst till kundens ekonomiska data.

Flödet är:

1. Operatören loggar in i Driftadmin med Supabase Auth + TOTP-MFA/AAL2.
2. Operatören registrerar bolagsidentitet, fakturauppgifter och första företagsadmin.
3. Edge Function validerar uppgifterna server-side.
4. En service-role-only databasfunktion skapar företag, fakturainställningar, personlig aktivering och audit-post i samma transaktion.
5. Driftadmin visar aktiveringslänken en gång. Endast SHA-256-hash av aktiveringskoden lagras.
6. Den inbjudna administratören väljer själv lösenord och registrerar MFA.
7. Först därefter kan AAL2-skyddad RLS ge åtkomst till företagets data.

## Säkerhetsgränser

- Företagsdata isoleras med `company_id`, `company_memberships` och RLS.
- LT Studio-operatör är en plattformsroll, inte ett kundmedlemskap.
- Onboarding-RPC:er är `security invoker`, nekas `public`, `anon` och `authenticated`, och får endast köras med `service_role`.
- Service-role-nyckel finns endast i Edge Functions.
- Aktiveringslänken är bunden till angiven e-postadress, engångsbaserad och gäller i 48 timmar.
- Befintliga LT Studio-konton måste verifiera AAL2/MFA innan ett nytt företag kan kopplas.
- Nytt konto kan inte läsa kunddata förrän MFA har slutförts eftersom databasen kräver AAL2.
- Utgångna eller felaktiga aktiveringslänkar roteras; företaget skapas inte om.
- Lösenord, MFA-hemligheter och aktiveringskod i klartext skrivs inte till audit-loggen.\n- Nya lösenord kontrolleras mot HIBP Pwned Passwords med k-anonymity: endast de första fem tecknen av SHA-1-hashen skickas, respons-padding används och kontoskapandet failar stängt om kontrollen inte går att utföra. Detta är vårt kostnadsfria kompensationsskydd medan Supabases inbyggda Leaked Password Protection kräver Pro-plan.

## Svenska bolagsuppgifter

Första versionen av onboardingguiden är avsiktligt svensk:

- organisationsnummer valideras som tio siffror med Luhn-kontroll,
- VAT ska motsvara `SE<organisationsnummer utan bindestreck>01`,
- webbplats, om angiven, måste använda HTTPS,
- bankgiro, om angivet, använder svensk bankgiroform,
- skattestatus väljs från en begränsad lista.\n\nSamma centrala kontroller finns både i Edge Function och i den atomiska databasfunktionen som defense-in-depth.

Internationell onboarding ska läggas till som en separat, explicit utökning och inte genom att försvaga svensk validering.

## Aktiveringsstatus

Driftadmin skiljer mellan:

- **Väntar på aktivering** – giltig personlig länk finns.
- **MFA återstår** – första admin har skapat kontot men ännu inte verifierat TOTP/AAL2.\n- **Aktiv** – minst en aktiv företagsadmin har verifierad MFA/AAL2.
- **Aktivering utgången** – länken måste roteras.
- **Saknar admin** – företaget saknar en fungerande första aktivering.

## Viktigt

Det äldre `uat-bootstrap`-flödet finns kvar för historisk UAT/operator-bootstrap och ska inte användas för nya kundföretag. Nya kunder använder `company-activate` och `company_activation_invites`.
