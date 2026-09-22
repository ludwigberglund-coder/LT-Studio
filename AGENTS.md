# AGENTS.md – obligatoriska säkerhetsregler för LT Studio

GitHub `main` är source of truth. Kodändringar ska göras via branch -> test/CI -> PR -> main.

Följande är obligatoriskt för all ny eller ändrad funktionalitet:

1. Alla exponerade routes ska omfattas av applikationens centrala rate limiting. Autentiserade API-anrop begränsas både per klient-IP och per användaridentitet. Login har striktare IP-gräns och separat persistent brute-force-spärr.
2. Alla JSON-mutationer ska gå genom det centrala inputschemat i `apps/api/request-security.js`. Nya bodyfält och queryparametrar måste registreras explicit. Oväntade fält ska avvisas, inte ignoreras.
3. Validera typ, längd, format, liststorlek och nästlade objekt. Kontrolltecken/prototype-pollution-nycklar ska avvisas. Domänlagret ska fortfarande göra affärsvalidering även efter transportvalideringen.
4. Lita aldrig på `X-Forwarded-For` eller `CF-Connecting-IP` utan explicit betrodd proxykonfiguration. `ROLLANDS_TRUST_CLOUDFLARE=1` får bara användas när origin är loopback-bunden och inte publikt nåbar, normalt via Cloudflare Tunnel.
5. Inga verkliga API-nycklar, lösenord, MFA-hemligheter, tokens, bankcredentials, R2-credentials eller Cloudflare-credentials får finnas i GitHub eller browserkod. Använd server-side environment/secret manager.
6. Nya tredjepartscredentials ska ha minsta möjliga scope, dokumenterad rotationsväg och aldrig skickas till klienten. Vid misstänkt exponering: rotera först; historikradering räcker inte.
7. Kör/behåll secret scanning av full Git-historik samt klient-/build-artifacts i CI.
8. Ändra inte säkerhetskontroller för att få ett test att passera utan att förstå varför kontrollen finns. Lägg regressionstest när en säkerhetsbugg hittas.
9. Cloudflare är defense-in-depth, inte ersättning för serverns egna kontroller.
10. Bevara tenant-isolering, append-only bokförings-/audithistorik, CSRF, MFA, säkra cookies och idempotens i alla relevanta flöden.
11. Filuppladdning är PDF-only. Endast passiva PDF-underlag för fakturor/dokument får accepteras. Tillåt inte bilder, Office-filer, ZIP/arkiv, körbara filer, script, HTML/SVG/XML eller andra filtyper utan en separat uttrycklig säkerhetsdesign och godkänd PR.
12. Alla PDF-uppladdningar ska gå genom den gemensamma PDF-säkerhetskontrollen, ha hård storleksgräns, verifierad PDF-header/slutmarkör, blockera aktivt/inbäddat innehåll och lagras/levereras så att browsern inte kan köra filinnehållet som applikationskod.

Om en ny route inte passar befintligt schema eller rate-limit-klass ska säkerhetslagret uppdateras i samma PR som routen. En ny publik route får inte lämnas obegränsad eller acceptera ospecificerad input.
