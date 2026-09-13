import pytest
import aquila_aviation_intel.tracker as tracker_module
from aquila_aviation_intel.tracker import enrich_flight, get_corporate_fleet, track_flights

def test_zero_hardcoded_registry():
    """Vérifie l'absence absolue de tout registre statique en dur."""
    assert not hasattr(tracker_module, "CORPORATE_FLEET_REGISTRY"), "CORPORATE_FLEET_REGISTRY ne doit plus exister en dur !"

def test_dynamic_business_jet_icao_type_detection():
    """Test détection dynamique d'un jet d'affaires par code type ICAO (ex: Dassault Falcon 7X ou Bombardier Global 7500)."""
    falcon_raw = {"icao24": "39b66a", "callsign": "DSO026", "type_code": "FA7X", "registration": "F-HBLA", "lat": 48.5, "lon": 2.3}
    enriched = enrich_flight(falcon_raw)
    assert enriched["is_corporate"] is True
    assert "Falcon 7X" in enriched["model"]
    assert enriched["category"] == "Aviation d'Affaires / Corporate Jet"

    global_raw = {"icao24": "4400d6", "callsign": "EMO75", "type_code": "GL7T", "registration": "OE-LSS", "lat": 47.0, "lon": 3.0}
    enriched_gl = enrich_flight(global_raw)
    assert enriched_gl["is_corporate"] is True
    assert "Global 7500" in enriched_gl["model"]

def test_dynamic_business_operator_detection():
    """Test détection dynamique par indicatif opérateur d'affaires (Dassault Falcon Service, NetJets, VistaJet)."""
    nje_raw = {"icao24": "495123", "callsign": "NJE42K", "type_code": "C56X", "lat": 46.2, "lon": 5.1}
    enriched = enrich_flight(nje_raw)
    assert enriched["is_corporate"] is True
    assert enriched["operator"] == "NetJets Europe"

def test_commercial_flight_classification():
    """Test classification dynamique d'un vol commercial régulier (Air France)."""
    afr_raw = {"icao24": "39de4f", "callsign": "AFR1234", "lat": 48.8, "lon": 2.3}
    enriched = enrich_flight(afr_raw)
    assert enriched["is_corporate"] is False
    assert enriched["category"] == "Ligne Commerciale Régulière"
    assert enriched["operator"] == "Air France"

def test_cargo_flight_classification():
    """Test classification dynamique d'un vol cargo (FedEx)."""
    fdx_raw = {"icao24": "a1234b", "callsign": "FDX456", "lat": 49.0, "lon": 2.5}
    enriched = enrich_flight(fdx_raw)
    assert enriched["is_corporate"] is False
    assert enriched["category"] == "Fret & Cargo Aérien"
    assert enriched["operator"] == "FedEx Express"

def test_track_flights_contract():
    """Test du contrat global de résultat avec la télémétrie réelle."""
    c = track_flights(lat_min=45.0, lat_max=49.0, lon_min=1.0, lon_max=5.0, limit=10)
    assert c.engine_version == "2.0.0"
    assert "corporate_flights_detected" in c.result
    assert len(c.evidence) > 0

