# API FastAPI pour le moteur Aquila Aviation Intel
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI, Query, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles
from typing import Optional
from genesis_core import ResultContract
from .tracker import track_flights, get_corporate_fleet
from .fleet_syncer import check_and_sync_weekly, get_metadata
from .gnss_jamming import scan_gnss_jamming_anomalies


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 1. Vérification automatique hebdomadaire au démarrage (TTL 7 jours)
    check_and_sync_weekly(force=False)
    yield

app = FastAPI(
    title="Aquila Aviation Intel API",
    description="Moteur de Suivi ADS-B & Tracking Aviation Live (Zero Fake Data)",
    version="3.1.0",
    lifespan=lifespan
)

TEMPLATES_DIR = os.path.join(os.path.dirname(__file__), "templates")
STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")

templates = Jinja2Templates(directory=TEMPLATES_DIR)
if os.path.exists(STATIC_DIR):
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="index.html",
        context={},
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "0"
        }
    )

@app.get("/health")
def health():
    meta = get_metadata()
    return {
        "status": "ok", 
        "engine": "Aquila", 
        "version": "3.1.0", 
        "data_policy": "REAL_TIME_ADSB_ONLY",
        "fleet_registry_status": meta.get("status"),
        "fleet_last_updated": meta.get("last_updated"),
        "fleet_count": meta.get("aircraft_count")
    }

@app.get("/api/v1/flights", response_model=ResultContract)
def get_flights(
    lat_min: float = Query(42.0, description="Latitude minimale"),
    lat_max: float = Query(51.0, description="Latitude maximale"),
    lon_min: float = Query(-5.0, description="Longitude minimale"),
    lon_max: float = Query(9.0, description="Longitude maximale"),
    q: Optional[str] = Query(None, description="Recherche dynamique : Nom d'entreprise, opérateur, immatriculation, ICAO ou indicatif"),
    corporate_only: bool = Query(False, description="Filtrer uniquement les jets d'affaires / flottes corporatives"),
    limit: int = Query(250, description="Nombre max d'aéronefs à renvoyer")
):
    return track_flights(lat_min, lat_max, lon_min, lon_max, query=q, corporate_only=corporate_only, limit=limit)

@app.get("/api/v1/companies/active")
def get_active_companies():
    """Renvoie strictement les entreprises ayant au moins 1 aéronef corporate actif sur la carte."""
    res = track_flights(corporate_only=True, limit=250)
    contract_data = res.result or {}
    active_companies = contract_data.get("active_companies", [])
    return {
        "total_active_companies": len(active_companies),
        "companies": active_companies
    }

@app.get("/api/v1/fleet/sync-status")
def get_fleet_sync_status():
    """Consulte le statut de la synchronisation hebdomadaire TTL 7 jours."""
    return check_and_sync_weekly(force=False)

@app.post("/api/v1/fleet/sync-now")
def force_fleet_sync():
    """Force un rafraîchissement immédiat de la base sans attendre les 7 jours."""
    return check_and_sync_weekly(force=True)

@app.get("/api/v1/fleet", response_model=ResultContract)
def get_fleet(
    group: Optional[str] = Query(None, description="Nom de l'entreprise, groupe ou opérateur (ex: Dassault, Air France, NetJets, Bolloré)"),
    q: Optional[str] = Query(None, description="Alias de recherche entreprise / flotte")
):
    search_term = q or group
    return get_corporate_fleet(group_name=search_term)

@app.get("/api/v1/gnss-jamming", response_model=ResultContract)
def get_gnss_jamming(
    lat: float = Query(34.5, description="Latitude du centre de la zone"),
    lon: float = Query(36.0, description="Longitude du centre de la zone"),
    radius_nm: int = Query(250, description="Rayon en milles nautiques")
):
    return scan_gnss_jamming_anomalies(lat=lat, lon=lon, radius_nm=radius_nm)

