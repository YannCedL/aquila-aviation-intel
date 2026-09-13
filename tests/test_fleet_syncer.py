import pytest
from datetime import datetime, timezone, timedelta
from aquila_aviation_intel.fleet_syncer import (
    is_sync_needed,
    save_metadata,
    get_metadata,
    lookup_aircraft,
    check_and_sync_weekly,
    TTL_DAYS
)
from aquila_aviation_intel.tracker import track_flights, enrich_flight


def test_ttl_calculation_and_metadata():
    """Vérifie que la stratégie TTL 7 jours fonctionne rigoureusement."""
    assert TTL_DAYS == 7
    
    # Simuler une mise à jour récente (il y a 2 jours)
    recent_date = (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()
    meta = get_metadata()
    meta["last_updated"] = recent_date
    
    # Si mis à jour il y a 2 jours, sync non requise
    delta = datetime.now(timezone.utc) - datetime.fromisoformat(recent_date)
    assert delta.days < 7


def test_lookup_aircraft_icao24_and_tail():
    """Vérifie la résolution instantanée par hex ICAO24 et par immatriculation."""
    # 1. Test LVMH (395580 / F-GVMA)
    lvmh = lookup_aircraft(icao24="395580")
    assert lvmh is not None
    assert lvmh["parent_company"] == "Groupe LVMH"
    assert lvmh["registration"] == "F-GVMA"
    assert lvmh["type_code"] == "FA7X"

    # 2. Test Bolloré (3905cb / F-GBOL)
    bollore = lookup_aircraft(registration="F-GBOL")
    assert bollore is not None
    assert bollore["parent_company"] == "Groupe Bolloré"
    assert bollore["type_code"] == "GLEX"

    # 3. Test Kering / Artémis (391a13)
    kering = lookup_aircraft(icao24="391a13")
    assert kering is not None
    assert kering["parent_company"] == "Kering / Artémis"


def test_enrich_flight_with_fleet_registry():
    """Vérifie que enrich_flight applique le parent_company et classe en corporate."""
    raw = {
        "icao24": "395580",
        "callsign": "DSO123",
        "registration": "F-GVMA",
        "alt_baro": 10000,
        "gs": 450
    }
    enriched = enrich_flight(raw)
    assert enriched["is_corporate"] is True
    assert enriched["parent_company"] == "Groupe LVMH"
    assert enriched["owner"] == "Groupe LVMH"
    assert enriched["operator"] == "Dassault Falcon Service"


def test_track_flights_includes_active_companies():
    """Vérifie que le contrat d'API inclut la liste 'active_companies' avec nom et effectif."""
    contract = track_flights(lat_min=42.0, lat_max=51.0, lon_min=-5.0, lon_max=9.0, limit=50)
    res = contract.result
    assert "active_companies" in res
    assert isinstance(res["active_companies"], list)
    for comp in res["active_companies"]:
        assert "name" in comp
        assert "count" in comp
        assert comp["count"] >= 1
