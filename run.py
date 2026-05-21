# script simple pour lancer l'app aquila d'un coup
import uvicorn
import webbrowser
import threading
import time

def ouvrir_navigateur():
    # attend 1.5 seconde que le serveur demarre et ouvre la page web
    time.sleep(1.5)
    webbrowser.open("http://localhost:8010")

if __name__ == "__main__":
    print("------------------------------------------------------------------")
    print(" ✈️  Lancement de AQUILA Aviation Intel Live UI on port 8010")
    print(" Ouverture du navigateur sur http://localhost:8010")
    print("------------------------------------------------------------------")
    
    # ouvrir la page automatiquement
    threading.Thread(target=ouvrir_navigateur, daemon=True).start()
    
    # demarrage du serveur web fastapi
    uvicorn.run("aquila_aviation_intel.api:app", host="127.0.0.1", port=8010, reload=True)
