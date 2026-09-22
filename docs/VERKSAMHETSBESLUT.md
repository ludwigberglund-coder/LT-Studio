# Verksamhetsbeslut – syntetisk demokonfiguration

Det här dokumentet beskriver endast den publika demokonfigurationen i GitHub. Det innehåller inte beslut eller registrerade uppgifter för någon verklig kund.

## Demoantaganden

| Område | Demovärde | Produktionsregel |
|---|---|---|
| Räkenskapsår | Kalenderår | Verifieras privat för varje kund före skarp drift |
| Redovisningsregelverk | K2 som demoexempel | Senaste signerade årsredovisning styr verkligt val |
| Momsperiod | Månad som demoexempel | Registrerad momsperiod verifieras privat före deklarationsflöde |
| Beloppsprecision | Ören | Ska lagras exakt genom hela systemet |
| Lön | Bokföringsintegrerad med stöd för extern löneleverantör | Kundens verkliga upplägg beslutas privat |
| Lager | Integrerad demomodul | Kundens verkliga behov beslutas privat |

## Regel

GitHub får endast innehålla syntetiska demoantaganden. Verkliga kunders redovisningsregelverk, momsperiod, interna beslut och annan företagsspecifik driftinformation ska lagras och verifieras utanför det publika repositoryt.

Den maskinläsbara publika demomotsvarigheten finns i `config/rolands-business-decisions.json`. Filnamnet är ett äldre tekniskt namn och ska inte tolkas som kunddata.
