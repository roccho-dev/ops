def decide(command):
    return {
        "decision": {"accepted": command.get("kind") == "record"},
        "effects": [{"type": "append-ledger", "record": command}],
    }
