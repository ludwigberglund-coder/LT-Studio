# Staging: företagsisolering och operatörsgräns, 2026-10-12

**Status: EJ GODKÄND för inloggad tvåföretags-UAT.** Denna notering är resultatet av read-only-kontroller, inte en fullständig penetrationstestning. GitHub `main` är källa för kod/migrationer. Undersökt från `024ba1effbdc138d2483afb7b201d403ee20acb0`, och alla leveranser måste testas igen mot faktisk senare merge-commit.

## Verifierat i de hostade Supabase-miljöerna

| Kontroll | LT-Studio (UAT) | LT-Studio-Staging |
|---|---:|---:|
| PostgreSQL | 17.6 | 17.11 |
| Public-tabeller | 51 | 50 |
| Public-tabeller utan RLS | 0 | 0 |
| Unika public-funktionsnamn | 63 | 57 |
| RLS-policies på public-tabeller | 169 | 168 |
| Företag (antal) | 2 | 2 |
| Auth-användare (antal) | 3 | **0** |
| Företagsmedlemskap (antal) | 3 | **0** |
| LT-operatörskonton (antal) | 2 | **0** |
| Security Advisor | 1 tidigare känd varning | 0 varningar |

Två särskilda syntetiska stagingföretag (`staging-alpha` och `staging-beta`) är skapade. De är **inte** två inloggningsbara testföretag förrän separata Auth-konton och företagsmedlemskap finns.

UAT:s enda rapporterade Security Advisor-varning är **Leaked Password Protection Disabled**, som är blockerad av nuvarande Free-plan. Den innebär inte att UAT är production-ready.

## Exakt schema-/funktionsskillnad

Staging saknar, relativt till UAT, följande public-objekt:

- Tabellen `company_activation_invites` och den nekande policyn `no browser access to company activation invites`.
- `claim_company_activation_invite`.
- `operator_create_company_onboarding`.
- `operator_reissue_company_activation`.
- `operator_change_company_membership`.
- `operator_capture_user_sessions`.
- `operator_count_remaining_previous_sessions`.

Alla sex funktioner är i **UAT** exekverbara för `service_role`, **inte** för `anon` eller `authenticated`. De två sessionsfunktionerna är `SECURITY DEFINER`; deras behörighet är begränsad till serverrollen. Detta är en viktig skillnad mellan saknat funktionsstöd och ett faktiskt öppet behörighetshål.

Samtliga sex funktioner och tabellen/policyn finns redan som versionsstyrd kod i GitHub. Centrala migrationsfiler:

1. `20261007152000_company_activation_invites.sql`
2. `20261007152100_operator_create_company_onboarding.sql`
3. `20261007152200_claim_company_activation.sql`
4. `20261007152300_reissue_company_activation.sql`
5. `20261007152400_single_active_company_activation.sql`
6. `20261007200500_protect_last_company_admin.sql`
7. `20261007211000_verify_operator_password_reset_sessions.sql`

**Lös inte detta genom att skapa nya fristående funktioner eller köra handskriven SQL i staging.** Stäm först av *samtliga* saknade, beroende och namnmässigt avvikande migrationer i respektive hosted migration history mot `main`. Läs `supabase/migration-history-parity.json` och `docs/SUPABASE-PARITY.md`. Vid historikskillnader används en verifierad versions-/migration-repair-process, inte råa ändringar i `schema_migrations`. Funktionen `operator_change_company_membership` beror bland annat på senare onboarding- och medlemskapsskydd. En enskild plockad migration räcker inte.

## Automatisk regression i GitHub

`supabase/tests/staging_tenant_operator_boundary.test.sql` är ett syntetiskt **rollback-only**-test för Supabase clean rebuild. Det kontrollerar:

- att de sex operator-/aktiveringsfunktionerna finns och endast `service_role` får anropa dem,
- att inga `public.SECURITY DEFINER`-funktioner är direkt öppna för browserroller,
- att aktiveringsinbjudningar och operatörstabellen är skyddade,
- att två syntetiska sessioner med AAL2 bara ser respektive företags kunder, fakturor och medlemskap,
- att en session utan AAL2 inte kan läsa kunder.

Testet skapar **inga bestående användare, fakturor eller banktransaktioner**. Testet körs bara i en isolerad clean rebuild och bevisar **inte** att de två hostade stagingföretagen fungerar med riktig Auth, MFA, Edge Functions eller Storage.

## Blockerare och nästa säkra steg

1. **Migration-/miljöparitet:** synka den hostade stagingmiljön kontrollerat från granskad GitHub-kod, med korrekt ordning, beroenden, clean-rebuild-bevis och koppling till exakt commit. Säkerställ att alla sex operatorfunktioner har förväntade EXECUTE-behörigheter efteråt. Inga påhittade live-migrationer.
2. **Två syntetiska testkonton:** skapa och aktivera *separata* staging-only Supabase Auth-identiteter via stödd Auth/bootstrap-väg. Aktivera MFA; tilldela enbart respektive Alpha/Beta-medlemskap. Lagra aldrig lösenord, TOTP-hemligheter eller service-role-nycklar i GitHub.
3. **Inloggad negativ UAT:** logga in som Alpha och Beta separat och verifiera att kundregister, fakturor, bokföring, privata PDF:er, Realtime, RPC och operatörsgräns **nekar fel företag även när ett API-anrop manipuleras**. En operatör ska kunna administrera företagskonto utan automatisk insyn i ekonomidata.
4. **Övrig readiness:** genomför verkligt ekonomiflöde med syntetiska data, backup-/restore-övning och koppla testbevis till exakt publicerad GitHub-commit. Lämna issue #364 öppet tills detta är utfört och dokumenterat.

**Kostnad:** befintlig Free-staging återanvänds. Ingen ny Supabase-resurs eller betald plan krävs av den här etappen.

**Ändrad extern förutsättning:** Supabase har aviserat förändrade standard-`GRANT`-regler för Data API från 2026-10-30. Vid kommande schemamigrationer ska erforderliga behörigheter sättas explicit; `GRANT` är inte samma sak som RLS. Källa: https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically
