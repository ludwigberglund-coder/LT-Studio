# AI-hjälp för hela LT Studio – första UI- och kodetappen

Datum: 2026-10-13. Relaterade ärenden: #767, #774, #727, #745.
**Status: kodad, men endast lokala regelstyrda guider – ingen aktiverad generativ AI för kunddata.**

## Vad användaren kan göra

- Öppna **AI-hjälp** under **Kom igång** i enkel meny, eller **Ekonomi** i avancerad meny.
- Använd toppmenyns **✦ AI-hjälp** från vilken auktoriserad portalsida som helst; rätt ekonomiområde väljs från sidans namn, aldrig från privata kunduppgifter.
- Skriv en enkel svensk fråga och få konkreta steg samt länk till ett befintligt arbetsflöde.
- Välj kundfakturor, inköp, bank, bokföring, automationsförslag, moms/rapporter, bokslut, lön och lager.
- Behörigheten styr vilka guider och åtgärder som visas. Verklig rättighet till data/skrivningar kontrolleras alltid server-side.
- Admin/accountant kan gå vidare till den tidigare syntetiska AI-bokföringsförhandsvisningen.

## Vad det ännu inte är

Sökningen körs lokalt i webbläsaren mot versionerade statiska guider. **Det är inte ett modellgenererat AI-svar eller en kontroll av företagets underlag.** Inga promptar, PDF:er, bankuppgifter eller fakturatexter skickas till Cloudflare. Söktext sparas inte. Ingen ny Edge Function, databas, migrationsfil, rate-limit-route eller ekonomisk skrivning skapades.

Den syntetiska Cloudflare-piloten är fortfarande hårt avstängd enligt docs/AI-EDGE-GATEWAY-DEPLOYMENT-GATE.md. Behåll RELEASE_APPROVED=false och DURABLE_IP_LIMITER_VERIFIED=false; en klientflagga får inte slå på piloten.

## Versionsstyrd kod

- apps/portal/ai-process-guides.js – sammanhållen katalog med trygga processguider, interna länkar och lokal svensk sökning.
- apps/portal/ai-assistant.html, .js, .css – ny mobilvänlig och tillgänglig assistentvy.
- apps/portal/portal-nav.js + shared-nav.css – behörighetsfiltrerad meny och kontextstyrd knapp på alla portalsidor.
- scripts/build-static.js – kräver nya filer i GitHub Pages-bygget.
- test/ai-assistant-workflows.test.js – regressionstester för sökning, rollstyrning, källhänvisning, demo och frånvaro av ekonomiska skrivningar.

## Nästa kodetapper för verklig AI i hela systemet

1. **Säker servergrind #774:** bevisa betrodd klient-IP/proxy i hosted Supabase, testa två syntetiska företag, återkallad session, kvot/idempotens under samtidighet och felvägar. Behåll piloten avstängd tills samtliga grindar är godkända.
2. **Gemensam processadapter:** tillåt bara versionerade purpose-värden för exempelvis fakturaförslag, bankmatchning, moms, lön, bokslut och lager med auktoriserad source_id. Ingen godtycklig fri klientprompt utan separat säkerhetsdesign.
3. **Kontrollerade fakta:** säker serverhämtning av minimerade underlag per företag; källspårning, schemavalidering, deterministic moms-/belopps-/periodkontroll och avslag vid tveksamheter.
4. **Befintlig attesteringskö:** föreslå enbart needs_review med versionsnummer, källhash, revisionsspår och behörig granskning. AI får aldrig anropa ekonomiska skrivrutiner direkt.
5. **Aktivering i respektive flik:** efter säker release, möjliggör kontextuella AI-analyser i fakturor, bank, bokföring, rapporter och bokslut med tydlig AI-markering. Behåll manuellt läge och möjlighet att stänga av AI.
6. **Produktionen:** dataskydd/leverantörslicens, kvalitet på svensk bokföring, kostnadstak, grön Quality/CodeQL/Supabase clean rebuild, tenanttest, backup och uttryckligt ägarbeslut.

GitHub main är källan för kod; inga riktiga personuppgifter, ekonomidata, privata dokument eller hemligheter får ligga där. Ingen Supabase-deployment ingår i denna etapp.
