# Kom igång: gratis Cloudflare AI för LT Studio

Detta är en **klick-för-klick-guide för administratörerna**, inte för slutkunderna. Senast kontrollerad: 2026-10-12. GitHub-ärende: #767.

**Status:** PR #771 förbereder en kodmodul som **ännu inte är inkopplad i den publika portalen eller Supabase Edge Functions**. De första stegen kan göras utan kodkunskaper. Ni ska inte använda riktiga kundfakturor eller förvänta er att en AI-knapp finns i LT Studio ännu. Inga kostnadstjänster ska aktiveras.

## DEL A – det ni kan göra själva nu

1. Öppna https://dash.cloudflare.com/ i webbläsaren. Registrera er om ni saknar Cloudflare-konto. Använd företagets gemensamt förvaltade e-postadress, men dela aldrig personliga inloggningsuppgifter. Aktivera gärna tvåfaktorsinloggning för kontot.
2. Välj en **Free**-plan (Workers Free). Aktivera **inte Workers Paid** och köp inga AI Gateway-krediter.
3. Öppna kontot i Cloudflare-panelen och välj **Workers AI** i menyn.
4. Klicka på **Use REST API**. Välj **Create a Workers AI API Token**, granska informationen och klicka på **Create API Token**. Om ni manuellt bygger en token i stället säger Cloudflares dokumentation att den behöver `Workers AI – Read` och `Workers AI – Edit`, bara för rätt konto. Undvik onödiga ytterligare behörigheter.
5. Tryck **Copy API Token**. **Skicka inte token till denna chatt, mejl, GitHub, README eller webbläsarkod.** Spara den tillfälligt i en lösenordshanterare tills den har lagts in som hemlighet i Supabase. En läckt token ska omedelbart återkallas och skapas på nytt.
6. På samma REST API-sida hittar ni **Account ID**. Kopiera ID:t. Det identifierar ert Cloudflare-konto (är inte samma sak som API-token).
7. Logga in på https://supabase.com/dashboard och välj **befintligt LT Studio-projekt**; skapa inte ett nytt och blanda inte test och produktion.
8. I vänstermenyn, välj **Edge Functions** och därefter **Secrets** (alternativt öppna funktionen *Edge Function Secrets* i projektpanelen). Lägg till två nya hemligheter, en åt gången:
   - **Key:** `CLOUDFLARE_ACCOUNT_ID` – **Value:** det kopierade Account ID:t.
   - **Key:** `CLOUDFLARE_AI_TOKEN` – **Value:** den hemliga API-token ni nyss skapade.
   Tryck **Save**. Detta är framtida serverkonfiguration, inte en aktivering av AI eller ett liveanrop.
9. Bekräfta endast att **namnen** `CLOUDFLARE_ACCOUNT_ID` och `CLOUDFLARE_AI_TOKEN` finns i hemlighetslistan. Ni ska aldrig behöva visa hemligheternas värden för oss. Ta bort eventuell osäker tillfällig kopia av token från urklipp och anteckningar.
10. Kontrollera i Cloudflares Workers AI-användningsvy att kontot fortfarande är på gratisnivån. Cloudflare erbjuder **10 000 Neurons per dag totalt per konto** på Workers Free. Det är inte 10 000 fakturor. Överskriden gratisgräns ger fel i stället för automatiskt betald drift.

**Klart för er del just nu.** Ni ska inte distribuera en Edge Function genom att klistra in egen kod, inte ändra någon Supabase-databas och inte ladda upp riktiga kundunderlag för AI-testet.

## DEL B – det LT Studio måste utveckla och testa innan AI kan användas i programmet

- En serverkontrollerad Supabase Edge Function som läser ovanstående två Secrets med `Deno.env.get`. Förslag ska nekas utan verifierad personlig session, MFA, roll och rätt företag.
- Test av dedikerad serverkvot och gräns för hur många Neurons/AI-anrop hela LT Studio och varje företag förbrukar, inklusive enkel avstängning vid slut på gratisgränsen.
- Säker läsning av endast passiva PDF-underlag; skannade bild-PDF:er stöds inte förrän en separat granskad OCR-lösning finns.
- AI ska bara skapa bokföringsförslag i den befintliga automationskön, med kontroll av BAS-konton, balans, moms, dubbletter och revisionsspår. Automatisk verifikationsbokföring ska inte aktiveras i denna etapp.
- Syntetisk UAT för två företag och därefter integritetstest (GDPR/personuppgiftsbiträdesavtal) och svensk redovisningskvalitet före något verkligt kundunderlag.

## Hur ni kan prova modellen redan nu, helt utan verkliga data

Via Cloudflares **LLM Playground** kan ni experimentera med helt påhittad svensk inköpstext, t.ex. "Demoföretaget köpte tio paket A4-papper för 1 250 kr inklusive 25 % moms. Föreslå 6110, 2641 och 2440". Det är en demonstration, **inte ett test av LT Studios integration eller dess bokföringssäkerhet**. Skicka inte personuppgifter eller riktiga dokument i Playground.

## Hjälplänkar (leverantörernas dokumentation)

- Cloudflares exakta REST API-knappar: https://developers.cloudflare.com/workers-ai/get-started/rest-api/
- Cloudflares gratisgräns: https://developers.cloudflare.com/workers-ai/platform/pricing/
- Supabases Secrets-panel: https://supabase.com/docs/guides/functions/secrets
- GitHub PR #771: https://github.com/ludwigberglund-coder/LT-Studio/pull/771

**Viktigt:** om menyerna i Cloudflare/Supabase ser annorlunda ut, utgå från de senaste leverantörsinstruktionerna ovan. För att hjälpa till med klick behövs endast en skärmbild där kontouppgifter och token har dolts.
