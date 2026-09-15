# Roller, behörigheter och attestseparation

## Syfte

Det nya Rollands-systemet använder ett centralt behörighetsregelverk. Ekonomifunktioner ska inte själva gissa vem som får göra vad. De frågar i stället samma behörighetsmodul före varje skyddad åtgärd.

Reglerna finns i:

- `config/access-control.json` – roller, behörigheter, MFA-krav och separationsflöden.
- `packages/access-control/authorization.js` – validering och beslut.
- `test/access-control.test.js` – automatiska säkerhetsgränser.

## Grundprinciper

1. **Default deny.** Allt som inte uttryckligen tillåts nekas.
2. **Personliga konton.** Delade användarnamn får inte användas i produktion.
3. **Minsta möjliga behörighet.** Varje roll får endast rättigheter som behövs för arbetsuppgiften.
4. **Fyrögonprincip.** Kritiska steg kräver olika personer även när någon har flera roller.
5. **MFA för känsliga roller.** Systemadministration, ekonomi, attest, kontroll och lön kräver flerfaktorsautentisering.
6. **Ingen dold superanvändare.** Systemadministratören har inte automatiskt rätt att bokföra, attestera eller frisläppa betalningar.
7. **Servern bestämmer.** Ett dolt eller inaktiverat gränssnitt är aldrig ett säkerhetsskydd; framtida API måste göra samma kontroll på serversidan.

## Roller

Den första rollmatrisen innehåller:

- systemadministratör,
- ekonom,
- attestant,
- ekonomikontrollant,
- försäljning och kassa,
- lageransvarig,
- löneansvarig,
- revisor eller läsbehörig granskare.

Rollerna är verksamhetsroller, inte namn på enskilda personer. En person kan ha flera roller, men attestseparationen gäller fortfarande för samma underlag.

## Kritiska separationsflöden

Följande arbetsflöden kräver olika personliga användaridentiteter:

- registrering och attest av samma leverantörsfaktura,
- förberedelse och frisläppning av samma betalning,
- begäran och upplåsning av samma bokföringsperiod,
- inventering och godkännande av samma lagerjustering.

Kontrollen sker med `evaluateWorkflowAction`. Funktionen kräver både rätt behörighet och godkänd separation mellan aktörerna.

## Exempel för framtida API

```js
const AccessControl = require('./packages/access-control/authorization.js');
const config = require('./config/access-control.json');
const access = AccessControl.createModel(config);

const actor = {
  id: session.userId,
  roles: session.roles,
  disabled: false
};

AccessControl.requirePermission(access, actor, 'accounting.post');
```

För ett attestflöde:

```js
const decision = AccessControl.evaluateWorkflowAction(
  access,
  actor,
  'supplier-invoice-approval',
  {
    registeredBy: invoice.registeredBy,
    approvedBy: actor.id
  }
);

if (!decision.allowed) throw new Error(decision.reason);
```

## Så ändras en roll

1. Ändra endast `config/access-control.json`.
2. Lägg till eller ta bort uttryckliga behörighets-id:n i rollen.
3. Kör `npm run content:check` och `npm test`.
4. Skapa pull request och låt GitHub Actions kontrollera ändringen.
5. Granska särskilt om ändringen bryter attestseparation eller ger en roll onödigt bred åtkomst.

Nya behörigheter ska ha ett stabilt tekniskt id, svensk beskrivning, kategori och risknivå. Gamla id:n ska inte byta betydelse eftersom loggar och historik kommer att hänvisa till dem.

## Gräns för GitHub Pages-demon

Projektadmin visar rollmatrisen och kan simulera beslut, men detta är inte en verklig inloggning. GitHub Pages saknar skyddad server, sessionsdatabas och hemlighetshantering.

Före produktion krävs därför:

- extern identitetsleverantör eller egen säker kontotjänst,
- säkra lösenord eller lösenordsfri inloggning,
- MFA,
- kortlivade servervaliderade sessioner,
- återkallelse av sessioner,
- loggning av inloggning och behörighetsändringar,
- skydd mot brute force och kapade sessioner,
- serverkontroll av varje skyddat API-anrop,
- regelbunden åtkomstgranskning.
