# API FastAPI pour le moteur Aquila Aviation Intel
import os
from fastapi import FastAPI, Query
from fastapi.responses import HTMLResponse
from genesis_core import ResultContract
from .tracker import track_flights

app = FastAPI(
    title="Aquila Aviation Intel API",
    description="Moteur de Suivi ADS-B & Tracking Aviation Live",
    version="1.0.0"
)

TEMPLATE_PATH = os.path.join(os.path.dirname(__file__), "templates", "index.html")

@app.get("/", response_class=HTMLResponse)
def index():
    # sert directement l'interface carte leaflet
    if os.path.exists(TEMPLATE_PATH):
        with open(TEMPLATE_PATH, "r", encoding="utf-8") as f:
            return f.read()
    return "<h1>Aquila API - Interface non trouvee</h1>"

@app.get("/health")
def health():
    return {"status": "ok", "engine": "Aquila", "version": "1.0.0"}

@app.get("/api/v1/flights", response_model=ResultContract)
def get_flights(
    lat_min: float = Query(42.0),
    lat_max: float = Query(51.0),
    lon_min: float = Query(-5.0),
    lon_max: float = Query(9.0)
):
    return track_flights(lat_min, lat_max, lon_min, lon_max)
