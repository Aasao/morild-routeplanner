# Review av kravspek-utkast v0.1 — erfaren Skagerrak-seiler

- Dato: 2026-08-30. Persona-review (30+ sesonger Oslofjorden/Skagerrak/Bohuslän/
  Kattegat, shorthanded cruising 38–45 fot). Innarbeidet i kravspek v0.2.

## Hovedbudskap

Spec-en er godt jordet i det tekniske (ensemble, dybdekvalitet, 800 m strøm),
men «skrevet av en ruter-ingeniør, ikke av en nattevakt»: en overfart er mer
enn en linje med tidsstempler — den er alternativhavner, trafikk, dagslys,
varsler og et mannskap som skal orke det.

## MÅ endres

1. **Seilingshøyde (air draft) mangler.** Mast ~19–20 m; indre leder i
   Bohuslän/norskekysten har bruer og luftspenn (Sotenkanalen, Malö strömmar,
   kraftspenn). `no-go der dybde < X` må få tvillingen
   `no-go der fri høyde < mastehøyde + margin`. Objektene finnes i kartdata.
2. **Vannstandsprognose + sjøgangstillegg i marginen.** (a) Vind-/trykkdrevet
   *lavvann* i Kattegat/Bæltene (østavind + høytrykk → godt under sjøkartnull)
   fanges ikke av astronomisk tidevann — bruk prognosen, trekk negativt avvik
   fra tilgjengelig dybde. (b) I 1 m sjø stamper en 41-fot ±0,5–0,7 m — margin
   bør være `statisk + f(Hs)` (grovt +0,5×Hs på eksponerte segmenter).
   (c) Verifiser dypgang mot båtens papirer — Dufour 41 har flere
   kjølalternativer, flere stikker dypere enn 2,10 m; bruk lastet dypgang.
3. **Bølgebratthet og vind-mot-strøm.** Hs alene lyver: 1,5 m dønning på 8 s
   ≠ 1,5 m vindsjø på 4–5 s (Grenen i SV frisk mot NØ-strøm). Derating/grense
   som funksjon av bratthet (Hs/Tp²-klasse) + eksplisitt «vind mot strøm»-
   flagg der komponentene står mot hverandre over terskel. S1-ruten seiler
   rett gjennom denne fella.
4. **TSS og skipsleder må inn.** Skagen-rutetiltakene + Oslofjord-TSS +
   fergekorridorer er statiske kartobjekter (krever ikke AIS). Regel 10:
   kryss på tvers — en tidsoptimal isokronruter vil gjerne legge seg langs.
   Kostnad/geometriregel i masken + visning i UI.
5. **Offisielle farevarsler (MetAlerts).** «Avgang 08: robust» samtidig med
   aktivt kulingvarsel dreper troverdigheten. Vis aktive varsler i
   avgangstabellen; la kuling/storm farge anbefalingen.
6. **Bail-out-havner er en del av robusthet, ikke tillegg.** Plan B er det
   første en erfaren seiler tegner: til hvilken time kan jeg falle av til
   Strömstad–Smögen–Marstrand, når er Skagen nærmeste ly? Minimum: kuratert
   nødhavnliste + per kandidat «lengste strekk uten alternativ: X t».
   Robusthetsscore uten dette sier hvor sannsynlig planen ryker, ikke hva
   det koster når den gjør det.

## BØR vurderes

7. **Robusthetspresentasjon: behold maskineriet, forenkle overflaten.**
   Trafikklys + én norsk setning; P90 som *plantid* («regn med inntil 31 t»);
   «følsomste faktor» som beslutningsregel med klokkeslett («sjekk kl 05:30:
   har vinden dreid SV? Hvis ikke — utsett»); vær-langs-ruten-bånd (tidslinje
   m/vindpiler/bølge, gjerne ensemble-vifte) — tillitsbroen til skipperen.
   Persentiler/medlemstall bak et trykk. P10 er nesten uinteressant.
8. **Dagslys-ankomst som hardt/mykt krav**, ikke bare kostnadsvekt; mørketimer
   som skravur i avgangstabellen.
9. **Manglende scenarier:** S5 retur-deadline («hjem senest søndag 18 — hvor
   langt tør jeg gå?» — get-home-itis er der dårlige beslutninger tas);
   S6 dagsetappe m/havnevalg mot *morgendagens* vær (nordvendt naturhavn +
   SV frisk i morgen); S1b morgen-re-sjekk med eksplisitt diff mot gårsdagens
   plan.
10. **Mannskap:** konfigurerbart maks-etappetid-tak; kryssandel-vekt skalert
    med etappelengde; kryss-timer i mørket vist separat.
11. **Verne-/forbudssoner:** sesongbaserte fågel-/sälskyddsområden i Bohuslän
    (datointervall), skytefelt — statiske polygoner, billig i masken.
12. **Sikt/tåke:** finnes ikke i spec-en. MEPS/ECMWF har siktfelt — inn i
    etappesammendrag + flagg «sikt < 1 nm i trafikkert farvann». Trenger ikke
    påvirke ruting i v2.0.
13. **Sverige:** ikke nedprioriter (det er dit vi drar). «Usikkert»-nivå +
    sterk farled-bias — hovedledene er godt merket og dype; slik seiles det
    der uansett.

## KJEKT

- Avgangsvindu på 1 t-oppløsning (6 t-steg bommer på solgangsbris-timing).
- Personlig havnebok (egne notater per havn, D1-synk) framfor generisk
  havnedatabase.
- Efs/navigasjonsvarsler og måne-/lysdata: senere.
- **Nedprioriter:** geometrisk korridor-stabilitet (geografien gir korridoren
  i disse farvannene), krengningsproxy (komfort er bølgedrevet her),
  60 fps-/APK-polish.
- Motorverdier 6,5 kn / 3,0 l/t plausible for D2-60F; kalibrer mot logg.

## Svar på kravspekens åpne spørsmål

1. Trafikklys m/detaljer bak trykk — men P90-tid og beslutningsregel synlig.
2. Sverige: «usikkert» + farled-bias, ikke nedprioritering.
4. 0,5 m OK som gulv innaskjærs; + sjøgangstillegg + vannstandsprognose;
   verifiser dypgang.
5. Motorverdier beholdes.
