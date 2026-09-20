# Penningmodell – heltal i ören

## Syfte

Alla nya ekonomimoduler i Rollands ska använda samma exakta penningmodell. JavaScript-tal med decimaler, exempelvis `0.1 + 0.2`, får inte användas som lagringsformat för bokföringsbelopp.

Den gemensamma implementationen finns i:

```text
packages/accounting/money.js
```

Modulen fungerar både i Node.js-tester och i webbläsaren. Projektadmin använder den i öreskalkylatorn.

## Grundregler

- Ett belopp lagras som ett säkert heltal i **ören**.
- `149,50 kr` lagras som `14950`.
- Kvantiteter lagras tillfälligt i tusendelar, exempelvis `1,5` som `1500`.
- Momssatser lagras som hundradels procent, exempelvis `12 %` som `1200`.
- Textinmatning med svenskt komma eller punkt accepteras, men belopp får högst ha två decimaler.
- Belopp formateras till kronor först när de visas för användaren.

## Avrundning

Radbelopp beräknas och avrundas till närmaste öre en gång på radnivå:

```text
styckepris i ören × kvantitet i tusendelar / 1000
```

Moms beräknas därefter på radens nettobelopp och avrundas till närmaste öre:

```text
radens nettobelopp × momssats / 10000
```

Fakturasummor skapas genom att summera de redan avrundade raderna. Detta ger ett spårbart underlag och undviker att totalsumman byggs av dolda flyttalsvärden.

## Blandad moms

`calculateInvoice()` grupperar automatiskt underlag, moms och total per momssats. Samma funktion ska senare användas av:

- kundfakturor,
- leverantörsfakturor,
- kreditfakturor,
- momsunderlag,
- lagerinköp,
- bokföringsverifikationer.

## Validering

Modulen stoppar bland annat:

- belopp med fler än två decimaler,
- kvantiteter med fler än tre decimaler,
- momssatser utanför 0–100 procent,
- tomma fakturor,
- rader utan positiv kvantitet,
- heltal som ligger utanför JavaScripts säkra heltalsintervall.

## Migrering från tidigare system

Den äldre demon lagrar flera belopp som hela kronor. Funktionen `legacyKronorToOre()` får endast användas när källvärdet uttryckligen är ett heltal i kronor. Decimalvärden stoppas i stället för att gissas.

Innan skarp data migreras ska varje datakälla klassificeras:

1. hela kronor,
2. kronor med decimaler,
3. redan lagrat i ören,
4. okänd eller blandad precision.

Okänd precision ska alltid stanna för manuell kontroll.

## Nästa lager

Öresmodellen är en grundmodul, inte ett färdigt bokföringssystem. Nästa steg är:

1. gemensamma domänidentifierare och tidsstämplar,
2. personliga personliga användare och företagsmedlemskap,
3. verifikationsmodell med debet och kredit i ören,
4. oföränderlig bokföringshistorik och rättelseverifikationer,
5. reskontra och betalningsavstämning ovanpå samma modell.
