# /// script
# requires-python = ">=3.10"
# dependencies = ["tiktoken==0.9.0"]
# ///
"""Counts o200k_base tokens of saved outputs: for each `<name>.outputs.jsonl` ({"id", "markdown"}
per line), writes `<name>.tokens.json` ({id: tokens}) next to it.

Usage: uv run --script python/count_tokens.py .reports/webwalker/*.outputs.jsonl
"""

import json
import sys
from pathlib import Path

import tiktoken

encoding = tiktoken.get_encoding("o200k_base")

for name in sys.argv[1:]:
    path = Path(name)
    counts = {}
    for line in path.read_text(encoding="utf-8").split("\n"):
        if line.strip():
            row = json.loads(line)
            counts[row["id"]] = len(encoding.encode(row["markdown"], disallowed_special=()))
    path.with_name(path.name.removesuffix(".outputs.jsonl") + ".tokens.json").write_text(json.dumps(counts))
