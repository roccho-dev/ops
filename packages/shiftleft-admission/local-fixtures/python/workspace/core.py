def parse_pair(raw):
    if not isinstance(raw, dict) or set(raw) != {"left", "right"}:
        raise ValueError("pair must contain left and right")
    left = raw["left"]
    right = raw["right"]
    if not isinstance(left, int) or not isinstance(right, int):
        raise ValueError("pair values must be integers")
    return left, right


def add(pair):
    left, right = pair
    return left + right
