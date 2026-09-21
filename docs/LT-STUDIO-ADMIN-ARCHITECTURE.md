# LT Studio central admin – säker arkitektur

## Mål

LT Studio ska ha en separat central adminyta för att kunna se:

- alla företag som använder plattformen,
- om företaget har medlemmar konfigurerade,
- antal aktiva sessioner,
- teknisk aktivitet,
- gemensam plattforms-/readiness-status,
- aggregerade säkerhetsvarningar,
- backup-, restore- och monitoreringsstatus.

Adminytan ska inte vara en genväg runt kundernas tenant-isolering.

## Gemensam SaaS-modell

Kunderna kör inte var sin separat kodkopia. De använder samma version av LT Studio-plattformen med separata `company_id`.

Därför visar central admin varje **företagsmiljö i den gemensamma plattformen**, inte ett separat serverbygge per kund.

## Steg 1 – read-only plattformsöversikt

`apps/api/platform-overview.js` sammanställer endast metadata:

- företagsidentitet,
- antal företagsmedlemmar,
- antal aktiva sessioner,
- antal kundregisterposter,
- antal fakturaposter,
- senaste revisionsaktivitet,
- antal säkerhetshändelser per nivå under ett begränsat tidsfönster.

Säkerhetssummeringen lämnar inte ut eventens fingeravtryck eller detaljdata.

Översikten returnerar inte:

- kundernas kundnamn,
- fakturanummer,
- fakturabelopp,
- dokumentinnehåll,
- bankuppgifter,
- löneuppgifter,
- IP-adresser,
- användarnamn från säkerhetshändelser.

Detta är medvetet. Operatörsöversikten ska kunna svara på “är kundmiljön aktiv och finns tekniska varningssignaler?” utan att normalt läsa affärsinnehåll.

## Steg 2 – separat operatörsautentisering

Innan plattformsöversikten får en HTTP-endpoint ska LT Studio-operatörer ha en separat autentiseringsmodell.

Krav:

- separat operatörsidentitet från kundanvändare,
- separat sessionscookie,
- MFA,
- kort inaktivitetsgräns och absolut sessionstid,
- CSRF på alla mutationer,
- serverlagrad session,
- revisionslogg för operatörsinloggning,
- kundsession får aldrig ge operatörsåtkomst.

Äldre projektadmin eller gamla admin-token får inte användas som permanent produktionslösning.

## Steg 3 – read-only operator-API

Första operator-API:t ska vara read-only och endast exponera plattformsmetadata.

Planerad yta:

- `GET /api/operator/v1/overview`
- `GET /api/operator/v1/readiness`
- `GET /api/operator/v1/security-events`

Säkerhetshändelser ska vara pseudonymiserade. Kundernas vanliga API ska inte få tillgång till dessa endpoints.

## Steg 4 – central adminwebb

Webbgränssnittet ska minst visa:

- företag,
- företags-id,
- medlemsstatus,
- aktiva sessioner,
- senaste aktivitet,
- systemversion/runtime,
- readiness-kontroller,
- säkerhetsvarningar med nivå,
- senaste lyckade backup/restore/monitorering.

Färgstatus ska alltid baseras på definierade tekniska regler, inte lösa uppskattningar.

## Steg 5 – åtgärder

Skrivande operatörsåtgärder, till exempel spärrning, återställning eller supportåtkomst, ska införas separat med:

- explicit anledning,
- dubbel bekräftelse för kritiska åtgärder,
- audit,
- idempotens,
- minsta möjliga behörighet.

Ingen sådan mutation ingår i steg 1.

## Integritetsprincip

Central admin är till för drift och säkerhet. Normal driftövervakning ska använda metadata och hälsosignaler i stället för att visa kundernas ekonomiska innehåll.
