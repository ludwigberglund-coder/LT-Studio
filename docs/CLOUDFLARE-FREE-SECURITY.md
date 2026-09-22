# Cloudflare Free – säkerhetsplan för LT Studio

Senast verifierad: 2026-09-22.

## Beslut

LT Studio kan använda Cloudflare Free som yttre säkerhetslager. Cloudflare får aldrig vara det enda skyddet: autentisering, CSRF, inputvalidering, tenant-isolering och rate limiting ska även finnas i applikationen.

Rekommenderad trafikväg:

```
Internet
  -> Cloudflare DNS / Universal SSL / DDoS / Free Managed WAF
  -> Cloudflare Tunnel
  -> 127.0.0.1:4180
  -> LT Studio API + portal
```

Origin-servern ska alltså inte ha port 4180 publik. Cloudflare Tunnel använder en utgående anslutning och kräver ingen öppen inbound-port till applikationen.

## Vad Free-planen ger som är användbart

- DNS och Universal SSL.
- Obegränsat/unmetered DDoS-skydd enligt Cloudflares Free-plan.
- Cloudflare Free Managed Ruleset i WAF för ett urval högpåverkande och brett utnyttjade sårbarheter.
- Custom WAF rules på Free.
- En rate-limiting rule på Free. Den bör användas som extra edge-skydd för den vanligaste kundinloggningen. LT Studios egna limiter skyddar alla routes oavsett Cloudflare-plan.
- Security Events finns på Free, men loggarna är sampled och Free saknar Security Events alerts.
- Cloudflare Tunnel finns på alla planer.
- Cloudflare Zero Trust Free är lämpligt för ett litet internt team/staging. Free-planen är avsedd för upp till 50 användare och har kortare loggretention än betalda planer.

Källor:
- https://www.cloudflare.com/plans/
- https://developers.cloudflare.com/waf/
- https://developers.cloudflare.com/waf/managed-rules/
- https://developers.cloudflare.com/waf/rate-limiting-rules/
- https://developers.cloudflare.com/tunnel/
- https://www.cloudflare.com/plans/zero-trust-services/

## Var Cloudflare ska användas

### Publik marknadswebb

Använd proxied DNS, Universal SSL, DDoS och Free Managed WAF. Ingen Cloudflare Access krävs eftersom sidan ska vara publik.

### Kundportal och API

Använd Cloudflare proxy/Tunnel + WAF. Behåll LT Studios egen login, MFA/BankID-plan, CSRF, behörigheter och applikations-rate-limit.

Cloudflare Access ska normalt inte ersätta kundinloggningen. Det skulle skapa dubbel identitetshantering och blir svårare när BankID införs.

### Staging

Skydda hela staging-hostnamnet med Cloudflare Access. Staging innehåller endast syntetisk data enligt repositoryts befintliga policy, men Access minskar ändå attackytan.

### LT Studio operatorportal

Skydda operator-host/path med Cloudflare Access utöver den separata operatorinloggningen och MFA:n. Det ger två oberoende grindar för den mest privilegierade ytan.

## Rekommenderad Free-konfiguration

1. Lägg domänen i Cloudflare och byt nameservers.
2. Aktivera proxied DNS för publika hostnamn.
3. Behåll SSL/TLS i strikt läge där arkitekturen använder origin-TLS. Med Tunnel till loopback kan tunnelanslutningen gå direkt till den lokala tjänsten.
4. Verifiera att Free Managed Ruleset är aktivt.
5. Skapa den enda Free rate-limit-regeln för `/api/v1/auth/login`. Free-planens rate-limit-uttryck är mer begränsade än betalda planer, så applikationens egna gränser gäller fortsatt för alla routes.
6. Använd de fem custom WAF-reglerna sparsamt för högsäkerhetssignaler, exempelvis uppenbart felaktiga paths eller trafik ni med säkerhet vet inte ska nå origin. Undvik breda regler som kan blockera legitima ekonomiflöden.
7. Testa Bot Fight Mode i staging före eventuell aktivering på produktionsdomänen.
8. Skapa en named Cloudflare Tunnel och routea hostnamnet till `http://127.0.0.1:4180`.
9. Stäng all publik inbound-åtkomst till applikationsporten.
10. Sätt `ROLLANDS_TRUST_CLOUDFLARE=1` först när steg 6–7 är verifierade. Servern vägrar starta med denna inställning om den inte är bunden till loopback.
11. Lägg Access framför staging och operatorportalen.
12. Testa normal login, 429-svar, felaktiga host headers, WAF-block, tunnelavbrott och återställning innan pilot.

## Secrets

Cloudflare API-token eller Tunnel-token får aldrig ligga i GitHub, klientkod, statiska assets eller `.env.example` som verkligt värde.

Om en remotely-managed Tunnel använder token ska token lagras i serverns secret manager/systemd credential eller annan privat driftkonfiguration utanför repositoryt. Repositoryt ska bara dokumentera namn/placeholder.

Alla Cloudflare-tokens ska ha minsta möjliga scope. En token som har committats, loggats eller exponerats i browserkod betraktas som komprometterad och ska roteras i Cloudflare innan fortsatt drift.

## Viktiga begränsningar i Free

Free WAF är inte samma fulla ruleset som Pro/Business. Free har endast en rate-limiting rule och Security Events är sampled. Därför får pilotens säkerhet inte bygga på att Cloudflare ensam upptäcker eller stoppar allt.

Applikationens egna limiter, audit/security events, central loggning och driftövervakning är fortsatt obligatoriska.
