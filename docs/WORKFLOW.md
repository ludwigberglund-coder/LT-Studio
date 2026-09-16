# Arbetsflöde för fortsatt utveckling

Detta dokument beskriver hur utvecklingsarbetet ska drivas i projektet.

## GitHub är basen

Kod, dokumentation, tester, konfiguration och ändringshistorik ska finnas i GitHub. Ändringar görs i arbetsgren, testas via GitHub Actions och förs därefter till `main` när kontrollkedjan är grön.

## Arbeta vidare medan beslut väntar

Om en uppgift är blockerad av ett beslut eller godkännande ska utvecklingen inte stå still i onödan.

Arbetsregeln är:

1. Dokumentera vad som väntar på beslut.
2. Fortsätt med andra oberoende delar som inte påverkar det väntande beslutet.
3. Ändra inte den blockerade delen på ett sätt som föregriper beslutet.
4. När beslutet finns, återuppta den blockerade uppgiften från den dokumenterade punkten.
5. Testa hela berörda flödet igen innan sammanslagning.

Detta ska användas för att arbeta effektivt utan att gissa i frågor där ägarna behöver fatta beslut.
