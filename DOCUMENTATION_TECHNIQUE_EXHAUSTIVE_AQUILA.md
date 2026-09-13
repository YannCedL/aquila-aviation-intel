# DOCUMENTATION TECHNIQUE EXHAUSTIVE : AQUILA AVIATION INTEL
## Moteur de Renseignement Aéronautique, Tracking ADS-B Live & Flottes Corporate (100% Dynamique)

---

### 1. MISSION & PÉRIMÈTRE FONCTIONNEL
AQUILA AVIATION INTEL est le micro-service de télémétrie aérienne de la suite géospatiale TERRA GEOINT (Écosystème NYANSA).
Il permet de :
1. Capter en direct sans filtre les signaux transpondeurs ADS-B mondiaux (1090 MHz Mode S / ADS-B Out) des aéronefs en vol et au sol.
2. Résoudre et filtrer **de façon 100% dynamique** les aéronefs civils, commerciaux, cargos et les jets d'affaires d'entreprises (recherche en temps réel par nom d'entreprise, opérateur, modèle, immatriculation ou indicatif).
3. Classifier dynamiquement les types d'appareils selon la nomenclature officielle **ICAO Doc 8643** (Dassault Falcon, Bombardier Global/Challenger, Gulfstream, Cessna Citation, Embraer Phenom/Legacy, etc.) et les indicatifs opérateurs ICAO.
4. **Zéro Donnée en Dur** : Aucune liste statique ou dictionnaire fermé d'avions. Toute détection et corrélation est opérée en temps réel sur les flux ADS-B vivants.
5. Servir un cockpit radar tactique sombre (thème Carbone & Or/Cyan) affichant les appareils avec leur cap physique réel et leurs métadonnées de vol (vitesse sol, altitude, ICAO 24-bit).

---

### 2. ARCHITECTURE & SOURCES DE DONNÉES (ZERO FAKE DATA)

AQUILA utilise une architecture résiliente à double flux :
* **Flux Primaire (OpenSky Network)** : API de recherche académique européenne (`/api/states/all`).
* **Flux Secondaire (ADSB.lol Community Feed)** : Réseau décentralisé de récepteurs SDR ouverts, activé automatiquement en cas de latence ou d'indisponibilité du flux primaire, avec télémétrie enrichie (codes types machine `t`, indicatifs `flight`, immatriculations `r`).
* **Recherche Ciblée Mondiale (ADSB.lol Direct Endpoint)** : Résolution instantanée de tout aéronef par immatriculation ou hex transpondeur (`/v2/reg/{reg}` ou `/v2/hex/{hex}`).
* **Algorithme Déterministe ICAO** : Catégorisation automatique et dynamique (Corporate Jet, Ligne Commerciale, Fret Aérien, Aviation Générale).

---

### 3. API ENDPOINTS

* **GET /** : Interface Web Tactique (Leaflet Sombre, orientation dynamique SVG des aéronefs, barre de recherche multi-critères, rafraîchissement toutes les 8s).
* **GET /health** : État de santé du micro-service (status: ok, version: 2.0.0, data_policy: REAL_TIME_ADSB_ONLY).
* **GET /api/v1/flights** :
  * Paramètres :
    * `lat_min`, `lat_max`, `lon_min`, `lon_max` : Boîte englobante géographique.
    * `q` (string, optionnel) : Recherche dynamique plein-texte (nom d'entreprise, compagnie, immatriculation, ICAO ou modèle).
    * `corporate_only` (bool, optionnel) : Filtre dynamique sur les aéronefs d'affaires (ICAO Doc 8643).
    * `limit` (int) : Nombre maximal de cibles à renvoyer (défaut : 250).
  * Réponse : `ResultContract` contenant la liste des aéronefs enrichis, le nombre de jets corporate détectés et la source télémétrique utilisée.
* **GET /api/v1/fleet** :
  * Paramètres : `group` ou `q` (nom du groupe ou de l'opérateur à rechercher).
  * Réponse : Recherche dynamique en vol sans aucune donnée en dur.

---

### 4. VALIDATION & TESTS AUTOMATISÉS
La suite de tests pytest (`tests/`) garantit :
* `test_zero_hardcoded_registry` : Contrôle d'intégrité validant l'absence totale de registre statique codé en dur.
* `test_dynamic_business_jet_icao_type_detection` : Résolution dynamique des jets corporate par leur type ICAO machine (`FA7X`, `GL7T`, etc.).
* `test_dynamic_business_operator_detection` : Résolution dynamique des opérateurs d'aviation d'affaires (`DSO`, `NJE`, `VJT`).
* `test_commercial_flight_classification` : Classification des vols de ligne (`AFR`).
* `test_cargo_flight_classification` : Classification du fret aérien (`FDX`).
* `test_track_flights_contract` : Validation de l'intégrité du `ResultContract` et des preuves épistémiques (`Evidence`).
* Couverture : 8/8 tests passés avec succès.

