# Beslut: Liquid Glass tas bort – 2026-10-12

LT Studio ska använda **solida och tydliga gränssnitt**, inte genomskinliga eller suddiga Liquid Glass-material. Beslutet gäller företagsportalen, bokföringsmodulerna, Driftadmin, äldre testvyer och webbplatsen.

## Genomförd ändring
- Den gemensamma filen `packages/shared/browser/liquid-glass.css` har raderats.
- Den statiska byggprocessen injicerar inte längre glasstilar eller `data-lt-glass-surface`.
- Företagsportalens navigation, verktygsfält, popupmenyer och batchlistor använder opaka ljusa/mörka paneler.
- Driftadmin får tillbaka solida paneler i sitt eget oberoende ljus- och mörkerläge.
- Frostad oskärpa (backdrop-filter) har tagits bort i aktiva huvudsakliga stilmallar.
- Liquid Glass-specifika assertions har ersatts med regressionstest för solid design.

## Vad som inte ändras
Bokföringslogik, betalningar, företagsisolering, behörigheter, sessioner, autentisering, Supabase och databas påverkas inte av designbytet. Befintliga menyer och åtgärdsknappar finns kvar.

## Publicering och kontroll
För att nå `main` krävs granskning av Quality, CodeQL, Supabase clean rebuild och visuell browser smoke. När PR:n mergats ska GitHub Pages-UAT kontrolleras för dator, mobil, ljus och mörkt tema.

Detta beslut ersätter tidigare Liquid Glass-design i PR #711, #713 och #715. Tidigare PR-historik bevaras i GitHub, men glaslagret ska inte införas på nytt.
