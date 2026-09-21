# Strukturerad driftloggning

API-servern kan skriva en JSON-rad per drift-/säkerhetshändelse till stderr. Formatet är leverantörsneutralt så hostingmiljön senare kan skicka stdout/stderr vidare till vald central loggtjänst utan att applikationskoden binds till en viss leverantör.

I `staging`, `pilot` och `production` är strukturerad loggning på som standard. `ROLLANDS_STRUCTURED_LOGS=1` kan användas explicit. `ROLLANDS_STRUCTURED_LOGS=0` stänger av den och bör endast användas vid kontrollerad felsökning; faktisk pilot ska ha en fungerande loggtransport.

## Loggade händelser

- `http_request`: metod, grov route-klass, HTTP-status, servergenererat request-id och duration.
- `request_handler_error`: redigerad felkod när servergränsen fångar ett oväntat fel.
- `security_event`: för närvarande redigerad `LOGIN_FAILURE_THRESHOLD` när samma pseudonymiserade inloggningskälla når fem fel.
- `service_started`: runtime-id när serverprocessen startar i strukturerat loggläge.

## Det som inte loggas

Applikationsgränsen loggar inte request body, querysträng, full URL, cookies, Authorization-header, lösenord, MFA-kod, användarnamn, rå IP-adress, sessionsvärden, databasväg eller kundernas affärsdata.

Route sparas endast som en grov klass, exempelvis `private-api`, `operator-api`, `readiness` eller `static`. Felkoder måste matcha en strikt versal kodlista/form; fria felmeddelanden förs inte vidare.

## Request-id

Servern skapar ett UUID för varje request och sätter `X-Request-Id` i svaret. Samma id används i `http_request`-loggen. Det gör att support kan be en användare om request-id och hitta rätt teknisk händelse utan att söka på personuppgifter.

## Central insamling

Denna kod levererar ett säkert JSONL-format till processens stderr. Den bevisar **inte** att en extern loggleverantör är konfigurerad.

Före pilot ska hostingmiljön:

1. samla stderr från API-processen,
2. transportera loggar krypterat till en separat central destination,
3. begränsa åtkomst till driftansvariga,
4. använda den beslutade loggretentionen i den privata operationsfilen,
5. larma på minst `security_event`, återkommande 5xx och uteblivna serverloggar,
6. verifiera med ett verkligt test att en loggrad går att hitta via request-id.

Loggtransportens credentials får aldrig läggas i GitHub.

## Stagingbevis för central loggtransport

När en riktig central loggtjänst är konfigurerad ska ett verkligt staging-request genomföras och svarets `X-Request-Id` kopieras. Driftansvarig söker därefter efter exakt samma request-id i den centrala loggtjänsten.

Först **efter** att den faktiska loggraden har hittats får följande privata bevis skapas:

```bash
npm run staging:logging:evidence
```

Kommandot kräver bland annat:

- `ROLLANDS_ENV=staging`,
- explicit `ROLLANDS_STRUCTURED_LOGS=1`,
- leverantör och logisk destination,
- exakt request-id från testet,
- färsk testtid, observatör och uppslagsreferens,
- bekräftelse att request-id faktiskt hittades,
- bekräftad krypterad transport,
- begränsad loggåtkomst,
- retention som exakt matchar `logRetentionDays` i den privata operationsfilen,
- konfigurerade larm för `security_event`, återkommande 5xx och utebliven loggström.

Evidensfilen måste ligga utanför Git-repositoryt och skrivs med privata filrättigheter. Den innehåller inga loggcredentials och ingen kunddata.

Kommandot kontaktar inte leverantörens privata sök-API. Det betyder att de manuella bekräftelseflaggorna endast får sättas efter den riktiga kontrollen hos leverantören. Verktygets uppgift är att göra bevisets struktur, färskhet, retention och koppling till staging-signoff maskinellt verifierbara.

`staging:evidence:verify` och `staging:signoff` kräver därefter ett färskt giltigt loggbevis. Signoff schema 3 binder loggbevisfilen med SHA-256; ändras filen efter signoff blir verifieringen röd.

## Fail-safe

Om själva logg-writern kastar ett fel får den inte krascha kundrequesten. Det betyder inte att loggbortfall är acceptabelt i drift: den externa plattformen måste övervaka att loggströmmen faktiskt tas emot.
