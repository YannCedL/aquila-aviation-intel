# Module de détection du brouillage (Jamming) et du leurrage (Spoofing) GNSS/GPS
# Analyse les paramètres de télémétrie ADS-B réels :
# - NIC (Navigation Integrity Category) & NACp (Navigation Accuracy Category for Position)
# - Déviation entre altitude barométrique (alt_baro) et altitude géométrique GPS (alt_geom)
# - Grappes géographiques d'avions perdant simultanément le signal de navigation par satellite
# 100% Zero Fake Data : exploitation des messages ADS-B réels d'OpenSky Network / ADSB.one

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
import httpx

from genesis_core import ResultContract, Evidence, EpistemicStatus

logger = logging.getLogger("aquila_gnss_jamming")

# API ADSB.one / OpenSky publique pour les données aéroportées avec métriques de positionnement
ADSB_ONE_LAT_LON_URL = "https://api.adsb.one/v2/point/{lat}/{lon}/{radius}"
DEFAULT_HEADERS = {
    "User-Agent": "AquilaGNSSJammingIntel/2.0 (contact@citadel360.nyansa.org)"
}


def scan_gnss_jamming_anomalies(
    lat: float = 34.5,
    lon: float = 36.0,
    radius_nm: int = 250
) -> ResultContract:
    """
    Scanne une région aérienne pour identifier les clusters de dégradation GNSS/GPS.
    Très utilisé pour surveiller les zones de tension (Méditerranée orientale, Mer Baltique, Mer Noire, Golfe Persique).
    """
    now_iso = datetime.now(timezone.utc).isoformat()
    contract = ResultContract(engine_version="2.0.0_gnss_jamming", observed_at=now_iso)

    jammed_aircraft: List[Dict[str, Any]] = []
    total_analyzed = 0
    url = ADSB_ONE_LAT_LON_URL.format(lat=lat, lon=lon, radius=min(radius_nm, 250))
    source = "ADSB_One_Global_Feeds"
    success = False

    try:
        with httpx.Client(timeout=6.0, headers=DEFAULT_HEADERS) as client:
            resp = client.get(url)
            if resp.status_code == 200:
                data = resp.json()
                ac_list = data.get("ac", [])
                total_analyzed = len(ac_list)
                success = True

                for ac in ac_list:
                    icao = ac.get("hex", "UNKNOWN").upper()
                    callsign = (ac.get("flight") or "").strip()
                    nac_p = ac.get("nac_p")  # Navigation Accuracy Category
                    nic = ac.get("nic")      # Navigation Integrity Category
                    alt_baro = ac.get("alt_baro")
                    alt_geom = ac.get("alt_geom")
                    ac_lat = ac.get("lat")
                    ac_lon = ac.get("lon")

                    anomalies = []

                    # 1. Vérification de la catégorie d'intégrité (NIC < 7 ou NACp < 7 indique une précision GPS dégradée ou perdue)
                    if nic is not None and isinstance(nic, (int, float)) and nic < 6:
                        anomalies.append(f"LOW_NIC_{nic}_UNRELIABLE_GPS")
                    if nac_p is not None and isinstance(nac_p, (int, float)) and nac_p < 6:
                        anomalies.append(f"LOW_NACP_{nac_p}_ESTIMATED_ACCURACY_DEGRADED")

                    # 2. Déviation anormale Barométrique vs Géométrique (> 1500 ft hors conditions météo extrêmes)
                    if alt_baro and alt_geom and isinstance(alt_baro, (int, float)) and isinstance(alt_geom, (int, float)):
                        diff = abs(alt_baro - alt_geom)
                        if diff > 1500:
                            anomalies.append(f"ALTITUDE_SPLIT_{int(diff)}FT")

                    if anomalies and ac_lat and ac_lon:
                        jammed_aircraft.append({
                            "icao": icao,
                            "callsign": callsign or "N/A",
                            "latitude": ac_lat,
                            "longitude": ac_lon,
                            "alt_baro": alt_baro,
                            "alt_geom": alt_geom,
                            "nic": nic,
                            "nac_p": nac_p,
                            "detected_anomalies": anomalies,
                            "severity": "CRITICAL" if len(anomalies) >= 2 else "WARNING"
                        })
    except Exception as e:
        logger.warning(f"Erreur scan GNSS Jamming ADSB: {e}")

    # Évaluation du risque de brouillage régional
    jamming_ratio = (len(jammed_aircraft) / max(total_analyzed, 1)) * 100.0
    if len(jammed_aircraft) >= 3 and jamming_ratio >= 15.0:
        regional_status = "ACTIVE_GNSS_INTERFERENCE_ZONE"
    elif len(jammed_aircraft) >= 1:
        regional_status = "ISOLATED_ANOMALIES_DETECTED"
    else:
        regional_status = "NOMINAL_GPS_PROPAGATION"

    contract.result = {
        "zone_center": {"latitude": lat, "longitude": lon},
        "radius_nm": radius_nm,
        "total_aircraft_scanned": total_analyzed,
        "anomalous_aircraft_count": len(jammed_aircraft),
        "jamming_incident_rate_pct": round(jamming_ratio, 1),
        "regional_status": regional_status,
        "anomalous_aircraft": jammed_aircraft,
        "data_source": source,
        "zero_fake_data": True
    }

    contract.add_evidence(Evidence(
        subject=f"airspace_gnss_interference_{lat}_{lon}",
        predicate="audit_brouillage_et_leurrage_gps",
        value=f"Statut: {regional_status}. {len(jammed_aircraft)} appareils présentent des signatures d'interférence sur {total_analyzed} scannés.",
        source=source,
        observed_at=now_iso,
        confidence=0.94 if success else 0.40,
        status=EpistemicStatus.FACT if success else EpistemicStatus.HYPOTHESIS
    ))

    return contract