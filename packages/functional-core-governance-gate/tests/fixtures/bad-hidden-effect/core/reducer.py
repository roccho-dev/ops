from datetime import datetime

def decide(state, event):
    return {"state": state, "observedAt": datetime.now().isoformat()}
