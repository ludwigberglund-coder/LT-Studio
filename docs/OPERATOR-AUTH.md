# LT Studio-operatörsautentisering

## Separat från kundkonton

LT Studio-operatörer är en egen identitetstyp och ligger inte i kundernas `users`-tabell.

Plattformen använder separata tabeller:

- `platform_operators`
- `platform_operator_sessions`
- `platform_operator_mfa_used_steps`
- `platform_operator_audit_events`

En operatör är inte en kundroll. Kundernas vanliga medlemskap och sessioner ger aldrig operatörsåtkomst.

## Sessionscookie

Operatörssessioner använder:

`lt_operator_session`

Kundportalen använder fortsatt:

`rollands_session`

Båda är HttpOnly och SameSite=Strict. Secure är standard utanför lokala tester.

## MFA och lösenord

Operatörer använder samma beprövade kryptografiska byggstenar som kundinloggningen:

- scrypt för lösenord,
- TOTP för MFA,
- AES-GCM för kryptering av MFA-hemligheten,
- SHA-256 för sessions- och CSRF-token,
- replay-skydd för använda MFA-tidssteg.

Operatörens MFA-replay-register är separat från kundanvändarnas register.

## Sessionstider

Datamodellen stödjer både:

- inaktivitetsgräns,
- absolut maxgräns.

Den planerade operator-API:n ska använda kortare tider än kundportalen. Standard för operatörscookien är två timmar som absolut webbläsarcookie-gräns; API-lagret ska dessutom sätta en kort inaktivitetsgräns.

## Audit

Operatörsåtgärder skrivs i en separat operatörsaudit. Den ska inte blandas ihop med kundernas företagsaudit.

## Skapa första operatören

Kommandot är fail-closed och gör inget utan `--apply`:

`npm run platform:bootstrap-operator -- --apply`

Följande miljövariabler måste sättas utanför GitHub:

- `ROLLANDS_DATABASE_PATH`
- `ROLLANDS_AUTH_ENCRYPTION_KEY`
- `ROLLANDS_OPERATOR_BOOTSTRAP_USERNAME`
- `ROLLANDS_OPERATOR_BOOTSTRAP_DISPLAY_NAME`
- `ROLLANDS_OPERATOR_BOOTSTRAP_PASSWORD`
- `ROLLANDS_OPERATOR_BOOTSTRAP_MFA_SECRET`

Databasen måste ligga utanför repositoryt i pilot/produktion.

Kommandot skriver inte lösenord, MFA-hemlighet eller krypteringsnyckel till loggen och skriver aldrig över ett befintligt operatörskonto.

## Nästa steg

Nästa etapp är ett separat `/api/operator/v1`-API med login, session, logout och en read-only översikt. Först därefter ska den centrala adminwebben kopplas på.
