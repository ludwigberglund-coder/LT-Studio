# Intern utskickskö och automationskö

Det här dokumentet beskriver grunden som finns innan en riktig e-postleverantör eller AI-tjänst kopplas in.

## Viktig gräns

**Systemet skickar inte e-post ännu.**

När en betalningspåminnelse skapas sparas två saker i samma databastransaktion:

1. själva påminnelseunderlaget med kapital, ränta, eventuella tillåtna avgifter och spårbar användare,
2. ett internt utskicksjobb i `notification_outbox`.

Ett utskicksjobb med status `queued` betyder därför bara **klart för en framtida leveransintegration**. Det betyder inte att kunden har fått ett mejl.

Ingen e-postprovider, Microsoft 365-koppling, SMTP-server eller annan extern leveranstjänst är aktiverad i denna etapp.

## Utskickskön

Kön innehåller bland annat:

- företag,
- faktura/påminnelse som utskicket hör till,
- mottagaradress,
- ämne och meddelandetext,
- stabil idempotensnyckel så samma utskick inte skapas dubbelt,
- status,
- antal försök,
- framtida leverantörs-id,
- felorsak och tidsstämplar.

Statusar:

- `queued`: internt köad, inte skickad,
- `processing`: reserverad av en framtida worker,
- `sent`: får endast användas efter uttrycklig leverantörsbekräftelse,
- `failed`: leveransförsök misslyckades och kan provas igen,
- `blocked`: kräver manuell åtgärd, till exempel saknad e-postadress eller för många leveransfel.

Om kunden saknar e-postadress skapas påminnelseunderlaget ändå, men utskicket blir `blocked`. Systemet förlorar alltså inte ekonomihistoriken och påstår inte heller att något har skickats.

## Varför påminnelse och utskick skapas atomiskt

Påminnelsen och köposten skapas i samma databastransaktion. Om något steg misslyckas rullas hela operationen tillbaka. Vi undviker därmed lägen som:

- påminnelsen finns men utskicket glömdes bort,
- utskicket finns men dess juridiska/ekonomiska underlag saknas.

## Automations- och AI-förslag

`automation_proposals` är en permanent granskningskö för framtida automatisering.

Ett förslag sparar bland annat:

- företag och källobjekt,
- typ av förslag,
- strukturerad rekommendation,
- bevis/underlag,
- förklaring,
- motor/version,
- säkerhetsvärde,
- om träffen är deterministisk eller tvetydig,
- status och personlig granskare.

Tanken är att samma struktur senare kan användas för exempelvis:

- matchning av bankinbetalning mot kundfaktura,
- konteringsförslag för leverantörsfaktura,
- konto- och momsförslag,
- förberedelse av leverantörsutbetalning,
- avvikelseflaggning,
- förslag på periodisering eller annan löpande bokföring.

## Hur ett förslag ska visas för användaren

Automationskön är en arbetsyta för människor och får därför inte använda rå JSON eller interna id:n som huvudsaklig förklaring.

Varje förslag ska i stället tydligt visa:

1. **vilken typ av åtgärd det gäller**, till exempel `Inbetalning`, `Utbetalning` eller `Kontering`,
2. **vad systemet vill göra i klartext**, till exempel att en viss inbetalning ska kopplas till en viss kundfaktura,
3. **relevanta parter och belopp**, exempelvis kund/leverantör, fakturanummer, belopp och datum,
4. **föreslagen kontering** som en tabell med konto, kontonamn, debet och kredit,
5. **varför förslaget uppstod**, inklusive använda underlag och säkerhetsgrad,
6. **vad som ännu inte har genomförts**.

Exempel på begriplig presentation:

> Omför inbetalning 3 925,00 kr till kundfaktura 310002. Föreslagen kontering: Debet 1930 Företagskonto / bank, Kredit 1510 Kundfordringar.

eller:

> Kontera leverantörsfaktura 8871. Föreslagen kontering: Debet 5460 Förbrukningsmaterial, Debet 2641 Ingående moms, Kredit 2440 Leverantörsskulder.

## Förslag måste vara redigerbara före godkännande

Ett öppet automationsförslag ska kunna korrigeras av en behörig användare när underlaget är otydligt eller förslaget är fel.

- Konton väljs via en rullista som visar både kontonummer och kontonamn.
- Vid bankmatchning kan mål-faktura ändras till en annan tillåten öppen faktura.
- Belopp från själva bankhändelsen eller originalunderlaget får inte skrivas om fritt bara för att få förslaget att passa.
- En ändrad kontering måste fortfarande balansera i debet och kredit.
- Manuella ändringar sparas i backend och revisionsloggen med personlig användare.
- När ett förslag har ändrats manuellt går det tillbaka till status `manual-review` och markeras som mänskligt ändrat.
- Om användaren ändrar ett förslag och därefter trycker Godkänn ska den aktuella ändringen sparas före godkännandet. Skärmen får aldrig visa ett nytt värde medan ett gammalt värde godkänns i backend.

Kontonamnen i `config/accounting-accounts.json` används för presentation och val i granskningsvyn. Företagets slutliga formella kontoplan kan senare ersätta eller utöka denna katalog utan att granskningsflödet byggs om.

## Säkerhetsprincip för automation

Ett AI- eller regelmotorförslag får aldrig i sig vara samma sak som en bokförd transaktion eller frisläppt betalning.

Förslagslagret ska alltid vara separat från exekveringslagret. Ett godkänt förslag betyder bara att en behörig person har accepterat rekommendationen. Den faktiska bokföringen eller betalningen måste fortfarande gå genom det vanliga behörighets-, attest-, period- och revisionsflödet.

Det gör att vi i framtiden kan öka automationsgraden utan att ge en AI-modell möjlighet att kringgå ekonomisystemets kontrollpunkter.

## Nästa steg senare

När e-post ska kopplas in bygger vi en provider-adapter ovanpå den befintliga kön. Då ska leverantören returnera ett verifierbart meddelande-id/leveransresultat innan status får ändras till `sent`.

När AI-tjänst ska kopplas in använder den samma persistenta förslagskö. Modellens svar ska valideras till strukturerade data och får inte direkt skriva verifikationer eller frisläppa betalningar.
