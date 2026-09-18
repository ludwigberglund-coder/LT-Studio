# ROLANDS PILOT READINESS CHECKLIST

Senast granskad: 2026-09-18. Företag: Rolands Frukt o Grönt Aktiebolag, 556406-5059.

**Samlat beslut: ❌ Inte klar för pilot med verkliga verksamhets- eller bokföringsdata.** Detta är en nulägeschecklista, inte ett slutintyg. Se [audit och bevis](PRODUCTION-READINESS-AUDIT-2026-09-18.md).

✅ Klar = den uttryckligen avgränsade kontrollen är implementerad och testad. 🟡 Delvis klar = kod eller vissa prov finns men viktiga bevis saknas. ❌ Inte klar = saknas, är blockerad eller är inte verifierad i avsedd drift.

| Kritiskt område | Status | Bevis eller vad som återstår |
|---|---|---|
| GitHub som källa, spårbara ändringar | ✅ Klar | Baseline c8bb496; separata grenar/PR:er med kontroller före sammanslagning. |
| Atomisk lagring av en verifikation | ✅ Klar | PR 62; fel vid andra raden återställer huvud, rader och nummerserie. |
| Identiska/ändrade återförsök på journalnivå | ✅ Klar | PR 62; identiskt återanvänder, ändrat innehåll nekas. |
| Dubbelklick/idempotens i alla affärsflöden | 🟡 Delvis klar | Journalens skydd räcker inte för kundfakturans tidiga request-ID-retur eller alla andra mutationer. |
| Deklarerade företagsrelationer i SQLite | ✅ Klar | PR 63; kontroll vid start och spärrar för INSERT/UPDATE. Befintlig ogiltig historik stoppar start utan att tas bort. |
| Fullständig företagsisolering och IDOR | 🟡 Delvis klar | Vanlig företagsfiltrering, 14 routefamiljers anonyma anrop och flera objektprov; hela roll-/metodmatrisen och polymorfa länkar återstår. |
| Inloggning, sessionscookie, MFA och CSRF | 🟡 Delvis klar | Grund finns; absolut timeout, MFA-replay, rolländring, återhämtning och skalbart försöksskydd behöver provas/förstärkas. |
| Oföränderliga bokföringsposter och audit-logg | ❌ Inte klar | Skydd mot efterhandsändring samt oberoende revisionsankare återstår. |
| Rättelse med bibehållen originalhistorik | 🟡 Delvis klar | Motposter finns; kopplad reskontra/betalningsstatus måste följa rättelsen. |
| Moms i faktura och leverantörsbokföring | 🟡 Delvis klar | Beräkning/konton och normal inhemsk kontering finns. Komplett regel- och scenarioverifiering återstår. |
| Momsavstämning mot bokförd huvudbok | ❌ Inte klar | Nuvarande momsunderlag kommer från fakturaregister, inte komplett avstämning. |
| Aktuella momssatser, tidpunkt och klassificering | ❌ Inte klar | Livsmedel 6 %, restaurangtjänst 12 %, kredit över skatteändring och övriga fall måste verifieras. |
| Fakturadatum, förfallodatum, separat bokföringsdatum | 🟡 Delvis klar | Fält finns åtskilda. PDF, leveransdatum och riktiga backendflöden ska verifieras tillsammans. |
| Återanvändning av kunddata och inget artikelnummerkrav | 🟡 Delvis klar | Backend hämtar köpare från kundregister; betalningsvillkor/referenser och hela UAT behöver kompletteras. |
| PDF-visning i pilotens attest/fakturering | ❌ Inte klar | Reproducerade asset/CSP-problem skiljer sig från det statiska demot. |
| Kundfordringar, leverantörsskulder, ingående balanser | ❌ Inte klar | Normalflöden finns men full avstämning, import och källanknutna rättelser saknar pilotbevis. |
| Lokalt tekniskt backup-/restore-verktyg | 🟡 Delvis klar | PR 64 har utökad verifiering och verkliga CLI-prov. Det är inte ett helt återställningsprov av driftmiljön. |
| Krypterad extern backup, retention och larm | ❌ Inte klar | Inget verifierat leverantörs-/konfigurationsbevis. |
| Arkivering av original och långsiktig läsbarhet | ❌ Inte klar | Arkivplan, exakt utfärdat underlag, export/återläsning och avtal återstår. |
| Health/readiness, driftlogg och fungerande larm | ❌ Inte klar | Teknisk grund finns men disk-/DB-/timeout- och larmscenarier saknas. |
| Secrets-hantering och historikskanning | 🟡 Delvis klar | Platshållare i exempelkonfiguration; snapshot-skanning utan tydliga tokenfynd. Full Git-historik och faktisk drift måste kontrolleras. |
| Miljöspärr och separation demo/pilot/produktion | ❌ Inte klar | Förkontroll finns men är inte bindande startspärr; demo kan väljas på pilotserver. |
| Betalningsöversikt dag/vecka/månad/kvartal | 🟡 Delvis klar | Delvyer finns; en konsekvent filtrerad privat översikt ska sluttestas. |
| Filtrerad Excel-kompatibel export | ❌ Inte klar | Fullständighet, samma filter som vyn och formelinjektionsskydd återstår att verifiera. |
| Arbetslista och begriplig återkoppling | 🟡 Delvis klar | Flera vyer finns; godkänd får inte kallas bokförd, fel får inte döljas som nollvärden. |
| Obligatoriska releasekontroller och rollback | 🟡 Delvis klar | CI finns; branch/ruleset, produktionsflöde och databasrollback behöver driftsbevis. |
| Rolands nio UAT-scenarier mot pilotserver | ❌ Inte klar | Befintliga demo- och kodtester ersätter inte ett signerat pilot-UAT. |
| K2/K3, momsperiod och bolagsspecifika inställningar | ❌ Inte klar | Målinställningar finns; faktisk årsredovisning och registrerad redovisningsperiod ska styrkas. |
| Driftansvarig, dataskydd, support och pilotstopp | ❌ Inte klar | Ansvar, avtal, återgång och incidentrutin ska beslutas innan riktiga data används. |

## Godkännande av nästa steg

Tekniskt ansvarig och redovisningsansvarig ska stänga relevanta BLOCKER-rader med testbevis, exakt releaseversion och datum. Därefter genomför Rolands UAT med fiktiva/avidentifierade data i den tänkta driftmiljön. Först efter godkända bevis fattas ett uttryckligt beslut om begränsad pilot, datamängd, användare, varaktighet och stoppkriterier.

Detta arbete ansluter inte e-post eller bank och slår inte på självständig AI-bokföring. Ett godkännande av ett förslag måste alltid beskriva den faktiskt genomförda åtgärden.
