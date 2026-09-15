# Verksamhetsbeslut för Rolands Frukt o Grönt Aktiebolag

**Organisationsnummer:** 556406-5059  
**Beslutsdatum:** 2026-09-15

Dessa beslut ska vara styrande för fortsatt utveckling av Rollands ekonomiplattform.

## Beslutade inställningar

| Område | Beslut | Status |
|---|---|---|
| Räkenskapsår | Kalenderår, 1 januari–31 december | Beslutat |
| Redovisningsregelverk | K2 | Beslutat mål; verifieras mot senaste signerade årsredovisning före skarp drift |
| Momsperiod | Månad | Beslutat mål; verifieras mot registrerad momsperiod hos Skatteverket före skarp deklaration |
| Beloppsprecision | Ören ska stödjas och lagras exakt | Krav; teknisk migrering återstår |
| Lön | Bokföringsintegrerad lönehantering med stöd för extern löneleverantör | Beslutat |
| Lager | Integrerad lagerhantering i Rollands-systemet | Beslutat |

## Tekniska konsekvenser

### Öresprecision
Nuvarande ekonomimotor använder fortfarande hela kronor i flera flöden. Innan produktionsdrift ska hela penningmodellen migreras till en exakt minsta enhet, normalt ören som heltal. Presentationen ska därefter kunna visa exempelvis `1 234,56 kr` utan flyttalsfel.

### Lön
Första produktionsnivån ska stödja import av lönejournaler, bokföring av lönekostnader, personalskatt, arbetsgivaravgifter, semesterlöneskuld och avstämning. Full löneberäkning kan byggas senare utan att bokföringsmodellen behöver göras om.

### Lager
Lagermodulen ska omfatta artiklar, lagersaldo, inköpspris, inventering, svinn/kassation, lagerjusteringar och bokföring av lagerförändringar. Svinn är särskilt viktigt eftersom verksamheten arbetar med färskvaror.

## Produktionsspärrar

Följande ska verifieras innan funktionerna används skarpt:

1. Att senaste signerade årsredovisning faktiskt använder K2.
2. Att registrerad momsredovisningsperiod hos Skatteverket är månad.
3. Att all monetär lagring är migrerad till öresprecision genom hela systemet.
4. Att lager- och löneflöden har avstämning, behörigheter och revisionsspår.

Den maskinläsbara motsvarigheten finns i `config/rolands-business-decisions.json`.
