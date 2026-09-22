# GitHub repository security – LT Studio

Senast verifierad: 2026-09-22.

## Aktuellt läge

GitHub är source of truth och projektets arbetsflöde är branch -> PR -> CI -> main.

Vid kontroll 2026-09-22 returnerade repositoryts Rulesets-API en tom lista. Det betyder att projektet inte har ett repository-ruleset som tekniskt tvingar denna arbetsgång på `main`.

Kod och CI är skyddade av tester, men utan ruleset kan en användare med tillräcklig GitHub-behörighet i princip fortfarande skriva direkt till `main`.

## Rekommenderat ruleset för main

Skapa ett branch ruleset som gäller `main` och konfigurera:

- Require a pull request before merging.
- Require status checks to pass before merging.
- Kräv checken från `Quality and security checks`.
- Block force pushes.
- Block branch deletion.
- Require conversation resolution before merging.
- Tillåt repositoryägarna Ludwig och Theodor samt den GitHub-integration ChatGPT använder att skapa branches och PR:er.
- Undvik regler som gör att ni själva eller ChatGPT inte längre kan administrera repositoryt.
- Behåll möjlighet till administrativ recovery, men använd bypass endast vid incident.

Om GitHub-planen eller UI:t erbjuder "Do not allow bypassing the above settings" ska den inte aktiveras förrän ni verifierat att minst två mänskliga administratörer fortfarande kan återställa repositoryt vid problem.

## Varför detta är separat från applikationssäkerheten

Applikationens rate limiting, inputvalidering, MFA, CSRF, tenant-isolering och secret scanning skyddar systemet när det körs.

GitHub-ruleset skyddar själva källkoden och minskar risken att en osäker ändring når `main` utan review och CI.

Båda lagren behövs före skarp pilot.

## Kontroll efter aktivering

Efter att rulesetet skapats:

1. Försök göra en ofarlig direktändring mot `main`; GitHub ska blockera den.
2. Skapa en testbranch och PR; det ska fortfarande fungera.
3. Verifiera att PR inte kan mergas medan `Quality and security checks` är röd eller pågår.
4. Verifiera att Ludwig, Theodor och ChatGPT fortfarande kan skapa branches/PR:er.
5. Dokumentera resultatet i repositoryts readiness-dokumentation.
