def run(effect):
    with open("out.jsonl", "a", encoding="utf-8") as f:
        f.write(str(effect) + "\n")
