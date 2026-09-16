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
- avvikelseflaggning,
- förslag på periodisering eller annan löpande bokföring.

## Säkerhetsprincip för automation

Ett AI- eller regelmotorförslag får aldrig i sig vara samma sak som en bokförd transaktion eller frisläppt betalning.

Förslagslagret ska alltid vara separat från exekveringslagret. Ett godkänt förslag betyder bara att en behörig person har accepterat rekommendationen. Den faktiska bokföringen eller betalningen måste fortfarande gå genom det vanliga behörighets-, attest-, period- och revisionsflödet.

Det gör att vi i framtiden kan öka automationsgraden utan att ge en AI-modell möjlighet att kringgå ekonomisystemets kontrollpunkter.

## Nästa steg senare

När e-post ska kopplas in bygger vi en provider-adapter ovanpå den befintliga kön. Då ska leverantören returnera ett verifierbart meddelande-id/leveransresultat innan status får ändras till `sent`.

När AI-tjänst ska kopplas in använder den samma persistenta förslagskö. Modellens svar ska valideras till strukturerade data och får inte direkt skriva verifikationer eller frisläppa betalningar.
