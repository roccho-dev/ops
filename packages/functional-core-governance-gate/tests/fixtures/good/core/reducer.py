def decide(state, event):
    next_state = dict(state)
    next_state["count"] = next_state.get("count", 0) + event.get("delta", 0)
    effects = [{"type": "audit", "payload": {"count": next_state["count"]}}]
    return {"state": next_state, "effects": effects}
