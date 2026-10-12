# AI-bokföring i kundportalen – första säkra förhandsvisningen

Status 2026-10-12: **interaktiv testsida i kundportalen, men inte aktiverad modell för riktiga fakturor**.

## Kundflöde

- Gå till **Ekonomi → AI-bokföring** i LT Studios kundportal.
- Välj en påhittad leverantörsfaktura: kontorsmaterial, IT-tjänst eller förbrukningsmaterial.
- Klicka på **Visa bokföringsexempel**. Då visas en deterministisk demonstration med tydlig märkning **FAST RÄKNEEXEMPEL – INTE AI**, 1 000 kr kostnad, 250 kr moms, 1 250 kr skuld, utan bokföring eller någon extern tjänst.
- Klicka på **Prova med AI (pilot)** endast som behörig inloggad admin/accountant när en riktig, säker Edge Function har driftsatts och pilotläget separat godkänts. Fram till dess ger sidan ett begripligt meddelande att AI-funktionen ännu inte är aktiverad.
- Om den framtida AI-funktionen svarar ska användaren se förslaget med tydlig märkning, kontrollera beloppen, och gå vidare till samma automationskö som idag. Förslaget ska **inte** kunna utföra eller godkänna bokföring från den här sidan.

## Säkerhet

- Sidan innehåller aldrig Cloudflare-tokens, Supabase service role-nycklar eller företagsdokument.
- Anrop sker via befintligt `LTSupabase.functions.invoke('ai-bookkeeping-pilot', {companyId,scenario,requestId}, accessToken)` och bara för den inloggades företag. Inga dokument, användarskrivna uppgifter, belopp eller instruktioner skickas i pilotläge.
- En extern respons måste ange rätt companyId, `manual-review`, `posted:false`, kräva mänsklig granskning, ha exakt tre balancerade konteringsrader och tillåtna testkonton; annars visas inget AI-förslag.
- `readonly` kan bara se de lokala, fördefinierade räkneexemplen.
- Felmeddelanden är neutrala och visar inte externa fel eller API-hemligheter.
- Menyalternativet kräver `accounting.view` i befintlig portalnavigation.
- CSS använder designtokens och är mobilanpassad med stöd för ljus/mörk vy.
- Inga verkliga kundfakturor, inget automatiskt bokförande, ingen uppladdning i denna etapp.

## Fortsättning för riktig AI

Innan **Prova med AI** kan utföra ett skarpt AI-anrop behövs enligt #774:
1. Transaktionssäker server-side kvot per IP, användare, företag och global nivå med idempotens, säker proxy/IP-källa och kill switch.
2. Kontrollerad Supabase Edge Function med riktig JWT/AAL2, företagsmedlemskap och testföretag; funktion måste deployas från GitHub-versionerad kod.
3. Verifierad kostnadsfri modell/licens, leverantörsavtal och dataskydd; därefter syntetisk UAT med två företagsidentiteter och faktiska modellresultat.
4. Därefter PDF-extraktion, bokföringsvalidering och sparande i den befintliga automationskön genom säkra RPC:er, med audit och mänsklig attest. Production release först efter redovisningsgranskning.

GitHub-ärenden: #767 och #774. Inget behov av att dela eller flytta API-token.
