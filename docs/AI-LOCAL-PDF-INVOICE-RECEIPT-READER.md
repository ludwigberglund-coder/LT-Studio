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

## Nästa etapp 2026-10-15: lokal granskningskontering (PR efter #811)

Efter avläsning i **AI-bokföring** kan användaren nu välja inköpstyp på vanlig svenska (kontorsmateriel, förbrukningsmaterial eller IT-tjänster). För kvitton måste användaren dessutom uttryckligen välja företagskonto eller kassa som betalningssätt. Den rena klientmodulen `apps/portal/ai-document-review.js` skapar då ett **tillfälligt granskningsutkast** från PDF-fakta.

- Leverantörsfaktura: valt kostnadskonto + eventuell ingående moms 2641 i debet och leverantörsskuld 2440 i kredit.
- Kvitto: valt kostnadskonto + eventuell ingående moms 2641 i debet och manuellt valt företagskonto 1930 eller kassa 1910 i kredit.
- Endast 0/6/12/25 % moms när satsen entydigt kan beräknas i heltalsören och nettobelopp + moms = total. Annars stoppas utkastet. Vid kvitto kan netto beräknas som total minus explicit moms, med tydlig varning.
- Källfält saknas, felaktig summa, oklar momssats, utländsk valuta, motstridiga värden, negativa/kreditbelopp och okänt konto ger stopp. Dubblettkontroll och faktisk betalningsmetod **kan inte** verifieras av denna lokala modul och måste granskas.
- Inga knappar för attest, spara, betala eller bokföra. `posted:false`, `saved:false`, `aiGenerated:false`, `requiresHumanApproval:true`. **Inga** Cloudflare-/Supabase-anrop eller kunduppgifter till modellen. Utkastet försvinner vid omladdning.
- Detta är inte en rekommendation att använda samma kostnadskonto för alla inköp eller ett juridiskt momsgodkännande. Konto väljs uttryckligen av användaren och ska kontrolleras mot inköpet.

Detta är en användbar, kontrollerad övergång från underlag till möjlig kontering, men **inte** det slutliga AI-automationsflödet. AI-gateway och riktiga dokument i automationskön är fortsatt spärrade tills tenant-, GDPR-, IP-, budget-, redovisnings- och releasekrav är uppfyllda. Varken `AI_PILOT_RELEASED` eller Edge Function-releaseflaggorna ändras.

## 2026-10-15: Granskningsutkast även i dokumentarkivet

Den befintliga knappen **Läs PDF lokalt** i `Dokument` ger nu samma möjlighet till tillfälligt bokföringsutkast som i `AI-bokföring`. Användaren behöver inte ladda ned och ladda upp PDF:en på nytt:

1. Välj ett redan lagrat kvitto eller en leverantörsfaktura och klicka **Läs PDF lokalt**.
2. Arkivet kontrollerar aktiv företagskontext, privat Storage-sökväg, MIME, filstorlek och SHA-256 för originalet, och läser PDF-texten i webbläsaren.
3. Välj **vad som köpts** (kontorsmateriel, förbrukningsmaterial eller IT-tjänster). För kvitto måste användaren även aktivt välja **hur det betalades**.
4. Klicka **Visa granskningsutkast**. Den gemensamma regelmotorn `LTStudioDocumentReview.buildReview` visar antingen balanserade debet-/kreditrader med tydliga varningar, eller ett **blockerat** utkast med orsaker.
5. Stäng granskningen: PDF-fakta och konteringsutkast finns bara i webbläsarens arbetsminne under den öppna dialogen. Ingen ny dokumentpost, verifikation, automation eller betalning skapas.

Vid varje begäran om konteringsutkast kontrolleras aktuell session, användare, företag, dokument-id, lagringsväg, kategori och SHA-256 igen. Ändrad företagskontext eller dokumentmetadata stänger dialogen. Alla textfält från PDF och varningar HTML-escapas. Det finns inga attest-, bokförings- eller spara-knappar och inga Cloudflare-/modell-/Edge Function-anrop i detta steg.

**Begränsningar:** Textbaserade, passiva PDF:er; ingen OCR för skannade bilder. En användarvald kostnadskategori är inte ett AI-beslut och garanterar inte korrekt konto eller avdragsgill moms. Faktisk betalning, dubbletter, kreditnotor, komplexa fakturor och momsundantag måste fortfarande kontrolleras i de ordinarie ekonomiflödena. AI-releasegrindarna är oförändrade.

Regressionstest: `test/document-accounting-preview.test.js`, tillsammans med befintliga `test/ai-document-reader.test.js` och `test/ai-document-review.test.js`.
