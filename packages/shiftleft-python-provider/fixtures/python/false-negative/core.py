import os as effect_adapter_alias

def environment() -> dict[str, str]:
    return dict(effect_adapter_alias.environ)
