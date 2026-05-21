from aquila_aviation_intel import track_flights

def test_track_flights():
    c = track_flights(43.0, 51.0, -5.0, 10.0)
    assert "flights" in c.result
    assert c.confidence > 0.9
