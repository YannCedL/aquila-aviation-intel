# test du tracker de vols ADS-B OpenSky
from aquila_aviation_intel.tracker import track_flights

def test_suivi_vols_france():
    contract = track_flights()
    assert contract is not None
    assert contract.result["total_flights"] >= 1
    assert len(contract.evidence) >= 1
