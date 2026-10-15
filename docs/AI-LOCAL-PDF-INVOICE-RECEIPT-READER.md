# Underlagsläsning: fakturor och kvitton i PDF (lokal första etapp)

Datum: 2026-10-15. Kopplat till AI-planen #774 och #797. GitHub är källan till koden.

## Vad som nu går att göra

- I `AI-bokföring` kan en inloggad användare välja en **passiv PDF** (leverantörsfaktura eller kvitto) och klicka **Läs PDF lokalt**.
- I befintliga `Dokument` finns **Läs PDF lokalt** på lagrade leverantörsfakturor och kvitton. Arkivet hämtar endast filen som aktuell inloggad användare redan får läsa, kontrollerar företagsmapp, MIME, storlek och originalets SHA-256, och analyserar den i webbläsaren.
- En begränsad PDF-textläsare känner igen okomprimerade och enkla FlateDecode-komprimerade textströmmar i vanliga digitala PDF-filer. Den letar efter explicit märkta uppgifter: leverantör/butik, nummer, datum, förfallodatum, netto, moms och totalbelopp. Beloppssummor jämförs matematiskt.
- Motstridiga, saknade eller obalanserade uppgifter markeras för granskning. Inga uppgifter antas vara verifierade.
- Originalet lämnar inte webbläsaren via denna läsare. Den gör **inga AI-, OCR-, API-, skriv-, uppladdnings- eller bokföringsanrop**. Den lagrar inte text, dokument, utdata eller token i localStorage, sessionStorage, Supabase eller GitHub.
- PDF-only (10 MB), header/slutmarkör, nekad aktiv/inbäddad PDF-syntax, begränsade strömmar och textmängder. Arkivets befintliga serververifiering och RLS gäller fortfarande vid **uppladdning**. Den lokala läsaren ersätter inte den kontrollen.

## Avgränsning och korrekt status

**Detta är inte AI.** Det är en lokal, regelbaserad, försiktig första läsning av digitala PDF-underlag. Ingen Cloudflare-modell är aktiverad; `AI_PILOT_RELEASED=false`, `RELEASE_APPROVED=false` och `DURABLE_IP_LIMITER_VERIFIED=false` består.

Skannade PDF-kvitton och fakturabilder saknar ofta markerbar text och kräver OCR/vision. Fontmappningar, ovanliga PDF-strömmar, flera sidlayouter, tabeller och felplacerade fält kan inte tolkas säkert av denna begränsade läsare. Den visar då ett fel eller ett osäkert resultat i stället för att hitta på belopp. Vanliga bildfiler stöds **inte** enligt `AGENTS.md`.

Inget avläst belopp får direkt bokföras, betalas eller skickas som en godkänd automation. Användaren måste granska originalet.

## Kvar till AI som kan tolka verkliga underlag

1. Serverägd, tenant-/MFA-säkrad dokumenthämtning och robust, fullständig PDF/OCR-extraktion; skannade kvitton kräver särskild säkerhetsgranskning.
2. Dataskydds-/DPA-/leverantörsbedömning och dokumenterat samtycke eller annan giltig behandlingsgrund innan riktiga kunddokument skickas till extern AI.
3. Låst Cloudflare-adapter som endast får nödvändiga verifierade fakta, med verifierad klient-IP, session, företagsisolering, atomär kvot och idempotens. Separat godkännande innan aktivering.
4. Oberoende momskontroll och kontoval, sedan ett **granskningsförslag i befintlig automationskö**, aldrig direkt automatbokföring från modellen.
5. Tvåföretags-UAT med syntetiska fakturor och kvitton, inklusive skannat underlag, krediter, 0/6/12/25 % moms, prompt injection, dubbletter och negativa tester.

## Tester

`node --test test/ai-document-reader.test.js` och hela `npm test` i GitHub CI. Alla ändringar levereras via branch/PR/CI/merge enligt `AGENTS.md`.
