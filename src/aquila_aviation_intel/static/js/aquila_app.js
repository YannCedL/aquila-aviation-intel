/**
 * AQUILA AVIATION INTEL — Vue 3 Tactical Radar & Telemetry Engine
 * Sovereign GEOINT / Avionics OSINT Hybrid 2D/3D Architecture
 */

const { createApp, ref, computed, onMounted, onUnmounted, nextTick } = Vue;

createApp({
  setup() {
    // ----------------------------------------------------
    // ÉTAT RÉACTIF DE L'APPLICATION
    // ----------------------------------------------------
    const flights = ref([]);
    const focusedFlight = ref(null);
    const viewMode = ref('2d'); // '2d' | '3d'
    const corporateOnly = ref(false);
    const selectedCompany = ref('');
    const searchQuery = ref('');
    const isLoading = ref(false);
    const feedSource = ref('ADS-B Live Feed');
    const cesiumStatus = ref('idle'); // 'idle' | 'loading' | 'ready' | 'error'

    // Accordéons ouverts
    const openSections = ref({
      ident: true,
      kinematics: true,
      dynamics: true,
      cockpit: true,
      weather: false,
      sigint: false
    });

    let map2d = null;
    let markersLayer2D = null;
    let cesiumViewer = null;
    let refreshInterval = null;
    let searchDebounce = null;

    // ----------------------------------------------------
    // PROPRIÉTÉS CALCULÉES
    // ----------------------------------------------------
    const totalFlightsCount = computed(() => flights.value.length);
    
    const corporateCount = computed(() => {
      return flights.value.filter(f => f.is_corporate).length;
    });

    // Liste déroulante dynamique : NE CONTIENT QUE les entreprises avec >= 1 aéronef sur la carte
    const activeCompanies = computed(() => {
      const compMap = new Map();
      flights.value.forEach(f => {
        if (f.is_corporate) {
          const name = f.parent_company || f.operator || f.owner;
          if (name && !['International', 'Inconnu', 'Aviation Générale / Privée', 'Aviation d\'Affaires Privée'].includes(name.trim())) {
            const clean = name.trim();
            if (!compMap.has(clean)) {
              compMap.set(clean, { name: clean, count: 0 });
            }
            compMap.get(clean).count++;
          }
        }
      });
      return Array.from(compMap.values()).sort((a, b) => b.count - a.count);
    });

    const filteredFlights = computed(() => {
      let list = flights.value;
      if (corporateOnly.value) {
        list = list.filter(f => f.is_corporate);
      }
      // Filtrage par entreprise sélectionnée dans la liste déroulante
      if (selectedCompany.value) {
        const sc = selectedCompany.value.toLowerCase().trim();
        list = list.filter(f => {
          const parent = (f.parent_company || '').toLowerCase();
          const op = (f.operator || '').toLowerCase();
          const owner = (f.owner || '').toLowerCase();
          return parent.includes(sc) || op.includes(sc) || owner.includes(sc);
        });
      }
      const q = searchQuery.value.toLowerCase().trim();
      if (q) {
        list = list.filter(f => {
          const txt = `${f.callsign} ${f.icao24} ${f.registration} ${f.operator} ${f.owner} ${f.parent_company || ''} ${f.model} ${f.type_code}`.toLowerCase();
          return txt.includes(q);
        });
      }
      return list;
    });

    const isSquawkEmergency = computed(() => {
      if (!focusedFlight.value || !focusedFlight.value.squawk) return false;
      const sq = String(focusedFlight.value.squawk).trim();
      return ['7700', '7600', '7500'].includes(sq);
    });

    const squawkAlertLabel = computed(() => {
      if (!focusedFlight.value) return '';
      const sq = String(focusedFlight.value.squawk).trim();
      if (sq === '7700') return 'Détresse Générale / Mayday';
      if (sq === '7600') return 'Panne Radio (NORDO)';
      if (sq === '7500') return 'Interférence Illicite / Hijack';
      return '';
    });

    // ----------------------------------------------------
    // INITIALISATION DE LA CARTE 2D LEAFLET
    // ----------------------------------------------------
    function initMap2D() {
      const container = document.getElementById('map2d');
      if (!container || map2d) return;

      map2d = L.map('map2d', {
        center: [46.603354, 1.888334],
        zoom: 6,
        zoomControl: true,
        attributionControl: false
      });

      // Tuiles OpenStreetMap Officielles (100% Gratuites, Zéro Clé d'API Requise, Claires & Lisibles)
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        subdomains: 'abc'
      }).addTo(map2d);

      markersLayer2D = L.layerGroup().addTo(map2d);
    }

    function getPlaneSvg(heading, isCorporate, onGround, vario, isFocused = false) {
      let color = isCorporate ? '#D99B43' : (onGround ? '#64748B' : '#06B6D4');
      if (vario > 300) color = '#10B981';
      else if (vario < -300) color = '#EF4444';
      const baseSize = isCorporate ? 26 : 20;
      const size = isFocused ? baseSize + 8 : baseSize;

      const focusRing = isFocused ? `
        <div class="absolute -inset-2.5 rounded-full border-2 border-cyan-400 animate-ping opacity-75 pointer-events-none"></div>
        <div class="absolute -inset-1.5 rounded-full border-2 border-cyan-300 pointer-events-none shadow-[0_0_12px_#06B6D4]"></div>
      ` : '';

      return `
        <div class="relative flex items-center justify-center" style="width:${size}px; height:${size}px;">
          ${focusRing}
          <div class="plane-icon-wrapper" style="transform: rotate(${heading || 0}deg); width:${size}px; height:${size}px;">
            <svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="${color}" style="filter: drop-shadow(0 0 ${isFocused ? '8px #38BDF8' : '4px ' + color});">
              <path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/>
            </svg>
          </div>
        </div>
      `;
    }

    function renderMarkers2D() {
      if (!markersLayer2D) return;
      markersLayer2D.clearLayers();

      // Conserver TOUS les vols sur la carte tactique pour garder la vue globale
      filteredFlights.value.forEach(f => {
        if (f.lat === undefined || f.lon === undefined) return;

        const isFocused = focusedFlight.value && focusedFlight.value.icao24 === f.icao24;
        const iconSize = isFocused ? 38 : (f.is_corporate ? 28 : 22);

        const icon = L.divIcon({
          html: getPlaneSvg(f.heading_deg, f.is_corporate, f.on_ground, f.baro_rate_fpm, isFocused),
          className: 'custom-plane-icon' + (isFocused ? ' focused-marker' : ''),
          iconSize: [iconSize, iconSize],
          iconAnchor: [iconSize / 2, iconSize / 2]
        });

        const marker = L.marker([f.lat, f.lon], { 
          icon,
          zIndexOffset: isFocused ? 1000 : (f.is_corporate ? 500 : 0)
        }).addTo(markersLayer2D);

        // Clic sur l'aéronef -> sélection et inspection télémétrique (reste en 2D)
        marker.on('click', () => {
          activerFocus(f, false);
        });
      });
    }

    // ----------------------------------------------------
    // INITIALISATION & CHARGEMENT DYNAMIQUE DE CESIUM 3D
    // ----------------------------------------------------
    function loadCesiumLibrary() {
      return new Promise((resolve, reject) => {
        if (window.Cesium) {
          cesiumStatus.value = 'ready';
          return resolve(window.Cesium);
        }
        cesiumStatus.value = 'loading';
        let attempts = 0;
        const interval = setInterval(() => {
          if (window.Cesium) {
            clearInterval(interval);
            cesiumStatus.value = 'ready';
            resolve(window.Cesium);
          } else if (++attempts > 40) { // 8 secondes max d'attente du script defer
            clearInterval(interval);
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/cesium@1.119.0/Build/Cesium/Cesium.js';
            script.onload = () => {
              cesiumStatus.value = 'ready';
              resolve(window.Cesium);
            };
            script.onerror = (err) => {
              console.error("Échec du chargement de CesiumJS :", err);
              cesiumStatus.value = 'error';
              reject(err);
            };
            document.head.appendChild(script);
          }
        }, 200);
      });
    }

    async function initCesiumViewer() {
      if (cesiumViewer) return cesiumViewer;
      try {
        const Cesium = await loadCesiumLibrary();
        Cesium.Ion.defaultAccessToken = '';

        let baseLayer = undefined;
        try {
          if (Cesium.OpenStreetMapImageryProvider) {
            baseLayer = new Cesium.ImageryLayer(
              new Cesium.OpenStreetMapImageryProvider({
                url: 'https://tile.openstreetmap.org/'
              })
            );
          } else if (Cesium.UrlTemplateImageryProvider) {
            baseLayer = new Cesium.ImageryLayer(
              new Cesium.UrlTemplateImageryProvider({
                url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
              })
            );
          }
        } catch (errLayer) {
          console.warn("BaseLayer creation warning:", errLayer);
        }

        const viewerOptions = {
          baseLayerPicker: false,
          geocoder: false,
          homeButton: false,
          infoBox: false,
          navigationHelpButton: false,
          sceneModePicker: false,
          timeline: false,
          animation: false,
          selectionIndicator: false,
          skyBox: false,
          skyAtmosphere: false
        };
        if (baseLayer) {
          viewerOptions.baseLayer = baseLayer;
        }

        cesiumViewer = new Cesium.Viewer('map3d', viewerOptions);
        cesiumViewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#080C14');

        // Clic sur un aéronef sur le globe 3D
        const handler = new Cesium.ScreenSpaceEventHandler(cesiumViewer.scene.canvas);
        handler.setInputAction((movement) => {
          const pickedObject = cesiumViewer.scene.pick(movement.position);
          if (Cesium.defined(pickedObject) && pickedObject.id && pickedObject.id.id) {
            const icao = pickedObject.id.id;
            const target = flights.value.find(x => x.icao24 === icao);
            if (target) {
              activerFocus(target);
            }
          }
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

        cesiumStatus.value = 'ready';
        return cesiumViewer;
      } catch (e) {
        console.warn("Impossible d'initialiser le viewer Cesium :", e);
        cesiumStatus.value = 'error';
        return null;
      }
    }

    function getCesiumPlaneIcon(isCorporate, heading) {
      const color = isCorporate ? '#D99B43' : '#06B6D4';
      const shadow = isCorporate ? 'rgba(217,155,67,0.9)' : 'rgba(6,182,212,0.9)';
      const svg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">
          <g transform="translate(48,48) rotate(${heading || 0}) translate(-48,-48)">
            <!-- Anneaux radar tactiques -->
            <circle cx="48" cy="48" r="44" fill="none" stroke="${color}" stroke-width="2" stroke-dasharray="6,4" opacity="0.9"/>
            <circle cx="48" cy="48" r="34" fill="${color}" fill-opacity="0.2" stroke="${color}" stroke-width="1.5"/>
            <!-- Silhouette d'Avion Aéronautique Supersonique / Jet d'Affaires -->
            <path d="M48 14 L53 34 L78 47 L78 53 L53 45 L53 66 L62 74 L62 78 L48 74 L34 78 L34 74 L43 66 L43 45 L18 53 L18 47 L43 34 Z" 
                  fill="${color}" 
                  stroke="#FFFFFF" 
                  stroke-width="2" 
                  style="filter: drop-shadow(0 0 8px ${shadow});"/>
          </g>
        </svg>
      `;
      return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg.trim());
    }

    // ----------------------------------------------------
    // BASCULE DE VUE & FOCUS TACTIQUE
    // ----------------------------------------------------
    async function basculerVue(mode) {
      viewMode.value = mode;

      if (mode === '3d') {
        const viewer = await initCesiumViewer();
        if (viewer) {
          nextTick(() => {
            viewer.resize();
            if (focusedFlight.value) {
              renderFocus3D(focusedFlight.value, true);
            } else {
              renderGlobe3D();
              if (window.Cesium) {
                viewer.camera.flyTo({
                  destination: Cesium.Cartesian3.fromDegrees(2.5, 46.5, 2500000),
                  duration: 0.8
                });
              }
            }
          });
        }
      } else {
        nextTick(() => {
          if (map2d) {
            map2d.invalidateSize();
            renderMarkers2D();
            if (focusedFlight.value && focusedFlight.value.lat !== undefined && focusedFlight.value.lon !== undefined) {
              map2d.panTo([focusedFlight.value.lat, focusedFlight.value.lon], { animate: true, duration: 0.5 });
            }
          }
        });
      }
    }

    async function activerFocus(flight, force3d = false) {
      focusedFlight.value = flight;
      
      // Ouvrir les accordéons télémétriques clés
      openSections.value.ident = true;
      openSections.value.kinematics = true;
      openSections.value.dynamics = true;

      if (force3d && viewMode.value !== '3d') {
        await basculerVue('3d');
      }

      if (viewMode.value === '3d') {
        const viewer = await initCesiumViewer();
        if (viewer) {
          renderFocus3D(flight, true); // true = recentrer et animer la caméra
        }
      } else {
        // En vue 2D : recentrer la carte sur la cible sans changer de mode
        if (map2d && flight.lat !== undefined && flight.lon !== undefined) {
          map2d.panTo([flight.lat, flight.lon], { animate: true, duration: 0.5 });
        }
        renderMarkers2D();
      }
    }

    function quitterFocus() {
      focusedFlight.value = null;
      if (viewMode.value === '2d') {
        renderMarkers2D();
      } else {
        renderGlobe3D();
      }
    }

    // ----------------------------------------------------
    // MOTEUR D'AFFICHAGE 3D CESIUM (DROP-LINE & VECTEUR)
    // ----------------------------------------------------
    function renderFocus3D(f, animateCamera = false) {
      if (!cesiumViewer || !window.Cesium) return;
      const Cesium = window.Cesium;
      cesiumViewer.entities.removeAll();

      const alt = Math.max(100, f.altitude_m || 2000);
      const posAircraft = Cesium.Cartesian3.fromDegrees(f.lon, f.lat, alt);
      const posGround = Cesium.Cartesian3.fromDegrees(f.lon, f.lat, 0);

      // 1. Drop-line verticale sol -> aéronef
      cesiumViewer.entities.add({
        polyline: {
          positions: [posGround, posAircraft],
          width: 3,
          material: new Cesium.PolylineDashMaterialProperty({
            color: f.is_corporate ? Cesium.Color.fromCssColorString('#D99B43') : Cesium.Color.fromCssColorString('#06B6D4'),
            dashLength: 16.0
          })
        }
      });

      // 2. Empreinte radar / Ombre portée au sol
      cesiumViewer.entities.add({
        position: posGround,
        ellipse: {
          semiMinorAxis: 350.0,
          semiMajorAxis: 350.0,
          material: (f.is_corporate ? Cesium.Color.fromCssColorString('#D99B43') : Cesium.Color.fromCssColorString('#06B6D4')).withAlpha(0.35),
          outline: true,
          outlineColor: f.is_corporate ? Cesium.Color.fromCssColorString('#D99B43') : Cesium.Color.fromCssColorString('#06B6D4'),
          outlineWidth: 2
        }
      });

      // 3. Vecteur de projection cinématique (+3 min)
      const radHeading = (f.heading_deg || 0) * (Math.PI / 180.0);
      const speedKmh = f.velocity_kmh || 500;
      const distKm = (speedKmh * 3.0) / 60.0;
      const dLat = (distKm / 111.0) * Math.cos(radHeading);
      const dLon = (distKm / (111.0 * Math.cos(f.lat * Math.PI / 180.0))) * Math.sin(radHeading);
      const posFuture = Cesium.Cartesian3.fromDegrees(f.lon + dLon, f.lat + dLat, alt);

      cesiumViewer.entities.add({
        polyline: {
          positions: [posAircraft, posFuture],
          width: 4,
          material: new Cesium.PolylineArrowMaterialProperty(
            f.is_corporate ? Cesium.Color.fromCssColorString('#D99B43') : Cesium.Color.fromCssColorString('#10B981')
          )
        }
      });

      // 4. Marqueur 3D Visuel Haut-Contraste de l'aéronef (Silhouette Avion + Coeur + Label)
      cesiumViewer.entities.add({
        id: f.icao24,
        name: f.registration || f.callsign,
        position: posAircraft,
        billboard: {
          image: getCesiumPlaneIcon(f.is_corporate, f.heading_deg),
          width: 72,
          height: 72,
          verticalOrigin: Cesium.VerticalOrigin.CENTER,
          horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
          disableDepthTestDistance: Number.POSITIVE_INFINITY
        },
        point: {
          pixelSize: 8,
          color: Cesium.Color.WHITE,
          outlineColor: f.is_corporate ? Cesium.Color.fromCssColorString('#D99B43') : Cesium.Color.fromCssColorString('#06B6D4'),
          outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY
        },
        label: {
          text: `✈️ ${f.registration || f.callsign || 'INCONNU'}\n${f.model || 'Aéronef'} • FL${Math.round(alt * 3.28084 / 100)} • ${f.velocity_kmh || 0} km/h`,
          font: 'bold 12px "IBM Plex Mono", monospace',
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.fromCssColorString('#080C14'),
          outlineWidth: 3,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          pixelOffset: new Cesium.Cartesian2(0, -42),
          disableDepthTestDistance: Number.POSITIVE_INFINITY
        }
      });

      // 5. Caméra orbitale tactique (Recentrage uniquement au clic initial)
      if (animateCamera) {
        const camDistDeg = 0.015; // ~1.5 km de distance
        cesiumViewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(
            f.lon - camDistDeg * Math.sin(radHeading),
            f.lat - camDistDeg * Math.cos(radHeading),
            alt + 600
          ),
          orientation: {
            heading: Cesium.Math.toRadians(f.heading_deg || 0),
            pitch: Cesium.Math.toRadians(-20.0),
            roll: 0.0
          },
          duration: 1.0
        });
      }
    }

    function renderGlobe3D() {
      if (!cesiumViewer || !window.Cesium) return;
      const Cesium = window.Cesium;
      cesiumViewer.entities.removeAll();

      filteredFlights.value.slice(0, 150).forEach(f => {
        if (f.lat === undefined || f.lon === undefined) return;
        const alt = Math.max(50, f.altitude_m || 2000);
        cesiumViewer.entities.add({
          id: f.icao24,
          name: f.registration || f.callsign,
          position: Cesium.Cartesian3.fromDegrees(f.lon, f.lat, alt),
          point: {
            pixelSize: f.is_corporate ? 10 : 7,
            color: f.is_corporate ? Cesium.Color.fromCssColorString('#D99B43') : Cesium.Color.fromCssColorString('#06B6D4'),
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: 1.5,
            disableDepthTestDistance: Number.POSITIVE_INFINITY
          },
          label: f.is_corporate ? {
            text: f.registration || f.callsign,
            font: '10px "IBM Plex Mono", monospace',
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            fillColor: Cesium.Color.fromCssColorString('#F3BA63'),
            outlineColor: Cesium.Color.fromCssColorString('#080C14'),
            outlineWidth: 2,
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            pixelOffset: new Cesium.Cartesian2(0, -12),
            disableDepthTestDistance: Number.POSITIVE_INFINITY
          } : undefined
        });
      });
    }

    // ----------------------------------------------------
    // CHARGEMENT DE LA TÉLÉMÉTRIE LIVE DEPUIS L'API
    // ----------------------------------------------------
    async function chargerDonnees(force = false) {
      if (isLoading.value && !force) return;
      isLoading.value = true;

      try {
        const qParam = searchQuery.value.trim() ? `&q=${encodeURIComponent(searchQuery.value.trim())}` : '';
        const corpParam = corporateOnly.value ? '&corporate_only=true' : '';
        const res = await fetch(`/api/v1/flights?limit=250${qParam}${corpParam}`);
        const data = await res.json();

        if (data && data.result) {
          flights.value = data.result.flights || [];
          feedSource.value = (data.result.source || 'ADS-B Live Feed').replace(/_/g, ' ');

          // Si un vol est verrouillé en focus, synchroniser ses métriques SANS re-voler la caméra
          if (focusedFlight.value) {
            const up = flights.value.find(x => x.icao24 === focusedFlight.value.icao24);
            if (up) {
              focusedFlight.value = up;
              if (viewMode.value === '3d') {
                renderFocus3D(up, false); // false = PAS d'animation de caméra lors du polling
              }
            }
          }

          // Mise à jour de la vue active
          if (viewMode.value === '2d') {
            renderMarkers2D();
          } else if (!focusedFlight.value) {
            renderGlobe3D();
          }
        }
      } catch (err) {
        console.error("Erreur de rafraîchissement des données télémétriques :", err);
      } finally {
        isLoading.value = false;
      }
    }

    function setCorporateOnly(val) {
      corporateOnly.value = val;
      chargerDonnees(true);
    }

    function onSearchChange() {
      clearTimeout(searchDebounce);
      renderMarkers2D();
      searchDebounce = setTimeout(() => {
        chargerDonnees(true);
      }, 400);
    }

    function toggleSection(sec) {
      openSections.value[sec] = !openSections.value[sec];
    }

    // ----------------------------------------------------
    // FORMATTEURS DE TÉLÉMÉTRIE
    // ----------------------------------------------------
    function formatVario(fpm) {
      if (fpm === undefined || fpm === null) return '0 fpm';
      const sign = fpm > 0 ? '+' : '';
      return `${sign}${fpm} fpm`;
    }

    function getVarioClass(fpm) {
      if (!fpm) return 'text-cyan-300';
      if (fpm > 300) return 'text-emerald-400 font-bold';
      if (fpm < -300) return 'text-rose-400 font-bold';
      return 'text-cyan-300';
    }

    function formatNavModes(modes) {
      if (!modes || !modes.length) return 'Manuel / Aucun';
      return modes.join(' • ');
    }

    function formatPositionProjection(f) {
      if (!f || f.lat === undefined) return 'N/A';
      const rad = (f.heading_deg || 0) * (Math.PI / 180.0);
      const speed = f.velocity_kmh || 500;
      const dist = (speed * 3.0) / 60.0;
      const dLat = (dist / 111.0) * Math.cos(rad);
      const dLon = (dist / (111.0 * Math.cos(f.lat * Math.PI / 180.0))) * Math.sin(rad);
      return `${(f.lat + dLat).toFixed(3)}°N, ${(f.lon + dLon).toFixed(3)}°E (~${Math.round(dist)} km)`;
    }

    function onCompanyChange() {
      if (selectedCompany.value) {
        // Active automatiquement le mode corporate
        corporateOnly.value = true;
      }
      renderMarkers2D();
      // Si la sélection renvoie des cibles, centrer la carte dessus
      const targets = filteredFlights.value;
      if (targets.length === 1 && map2d) {
        const t = targets[0];
        if (t.lat !== undefined && t.lon !== undefined) {
          map2d.setView([t.lat, t.lon], 9, { animate: true });
        }
      } else if (targets.length > 1 && map2d) {
        const validCoords = targets.filter(t => t.lat !== undefined && t.lon !== undefined);
        if (validCoords.length > 0) {
          const bounds = L.latLngBounds(validCoords.map(t => [t.lat, t.lon]));
          map2d.fitBounds(bounds, { padding: [50, 50], maxZoom: 10 });
        }
      }
    }

    function resetCompanyFilter() {
      selectedCompany.value = '';
      renderMarkers2D();
    }

    // ----------------------------------------------------
    // RACCOURCIS CLAVIER & LIFECYCLE HOOKS
    // ----------------------------------------------------
    function handleKeyDown(e) {
      if (e.key === 'Escape' && focusedFlight.value) {
        quitterFocus();
      }
    }

    onMounted(() => {
      // 1. Initialiser la carte 2D Leaflet immédiatement
      initMap2D();

      // 2. Charger les premiers vols télémétriques
      chargerDonnees(true);

      // 3. Boucle de rafraîchissement temps réel toutes les 8 secondes
      refreshInterval = setInterval(() => chargerDonnees(false), 8000);

      // 4. Écouter la touche Échap
      window.addEventListener('keydown', handleKeyDown);
    });

    onUnmounted(() => {
      if (refreshInterval) clearInterval(refreshInterval);
      window.removeEventListener('keydown', handleKeyDown);
    });

    return {
      flights,
      focusedFlight,
      viewMode,
      corporateOnly,
      selectedCompany,
      activeCompanies,
      searchQuery,
      isLoading,
      feedSource,
      cesiumStatus,
      openSections,
      totalFlightsCount,
      corporateCount,
      filteredFlights,
      isSquawkEmergency,
      squawkAlertLabel,
      basculerVue,
      activerFocus,
      quitterFocus,
      setCorporateOnly,
      onCompanyChange,
      resetCompanyFilter,
      onSearchChange,
      chargerDonnees,
      toggleSection,
      formatVario,
      getVarioClass,
      formatNavModes,
      formatPositionProjection
    };
  }
}).mount('#app');
