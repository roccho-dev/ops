from adapter.runtime import execute

def decide(state, event):
    return execute({"type": "audit", "payload": event})
