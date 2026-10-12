# Småföretagarflöden – etapp 2A: snabbare vardagsuppgifter

Datum: 2026-10-12.
Huvudärende: [#749](https://github.com/ludwigberglund-coder/LT-Studio/issues/749).
Föregående etapp: [PR #750](https://github.com/ludwigberglund-coder/LT-Studio/pull/750) – enkelt och avancerat navigationsläge.

## Varför denna etapp
Etapp 1 minskade mängden tekniska menyord, men en småföretagare som bara vill öppna fakturor, granska inköp eller hitta en betalning kan fortfarande behöva öppna sidomenyer och leta efter rätt vy. Startskärmen visar redan prioriterade ärenden. Den här lilla etappen kortar vägen till vanliga befintliga arbetsytor, **utan ny ekonomi-, bank-, attest- eller databaskod**.

## Leverans 2A
- Under den prioriterade arbetslistan visas ett kompakt område **Vanliga uppgifter** med direkta länkar till Fakturor, Inköp, Underlag, Oplacerade betalningar och Månadskontroll – endast när samma användare får se motsvarande länkar i den befintliga rollfiltrerade sidomenyn.
- Den befintliga översiktens beräkning av antal väntande ärenden, datakällor och ärligheten vid ofullständig dataläsning ändras inte.
- Om en inbetalning saknar koppling till faktura leder arbetslistans rekommenderade handling direkt till **Oplacerade betalningar**, inte först till banköversikten.
- En snabbväg öppnar bara befintliga sidor. Ingen verifikation, attest, överföring eller bokföring skapas av länkklicket.
- Visningen är anpassad till mobil, mörkt läge, tangentbordsfokus och reducerad rörelse.
- Befintliga redovisningsspecialistsidor finns fortsatt i avancerat läge.

## Roll- och säkerhetsmodell
`quickActionLinks(allowedGroups)` får endast använda redan behörighetsfiltrerade objekt från `navigationContext().groups`. Navigationsetiketter och kort är inte säkerhetskontroller; server, RLS och ekonomi-RPC skyddar alla känsliga åtgärder. En försvunnen eller felaktig sessionsläsning ger **inga extra snabbvägar**. Inloggnings- och företagsseparation ändras inte.

## Godkännandekriterier
1. Fem vanliga länkar på översikten för en behörig användare, respektive färre när behörighet saknas.
2. Oplacerade betalningar öppnas på ett klick från översiktens uppgift när bankhändelsen är omatchad.
3. Befintliga sidor, djuplänkar och avancerade lägen fungerar som tidigare.
4. Det finns inga nya skrivningar, RLS-policyer, migrationer eller servervägar.
5. Test `dashboard-quick-actions.test.js`, uppdaterat dashboard browser smoke och ordinarie Quality/CodeQL/Supabase clean rebuild passerar.
6. Merge mot senaste `main`, sedan Pages-UAT publicering och senare inloggad test med syntetiska företag.
7. Inte produktionsgodkänt före ordinarie P0-gates.

## Avgränsad fortsättning 2B
- Förbättra kund- och leverantörsvyer med kontextuella nästa-steg-länkar i befintliga arbetsflöden, efter separat kartläggning.
- Mäta faktiska klick i fem syntetiska scenarier och kontrollera att inget öppnar fel företag eller tappade formulärdata.
- Visa trygg, begriplig återkoppling när något godkänns; behåll dubbla kontroller där lag och intern säkerhet kräver det.

**GitHub är source of truth för kod/plan; företagets affärsdata ska inte kopieras till repositoryt.**
