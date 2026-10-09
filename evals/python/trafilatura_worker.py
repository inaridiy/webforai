# /// script
# requires-python = ">=3.10"
# dependencies = ["trafilatura==2.3.1"]
# ///
"""Converts HTML with Trafilatura for the evals harness (`src/cli/trafilatura.ts` starts it).

Reads one JSON object per line on stdin, {"html", "url", "rounds"}, and writes one per line on
stdout, {"ok", "markdown", "error", "ms"}. Trafilatura runs with its defaults and Markdown output,
as its documentation shows: `extract(html, url=url, output_format="markdown")`. `ms` is the median
of `rounds` timed calls after one untimed warm-up call when `rounds` > 1, else the single call.
The first line written is {"version": ...}.
"""

import json
import signal
import statistics
import sys
import time

import trafilatura


class Timeout(Exception):
    pass


def on_alarm(_signum, _frame):
    raise Timeout("timed out after 60 s")


signal.signal(signal.SIGALRM, on_alarm)


def convert(html: str, url: str) -> str:
    return trafilatura.extract(html, url=url, output_format="markdown") or ""


def main() -> None:
    print(json.dumps({"version": trafilatura.__version__}), flush=True)
    for line in sys.stdin:
        request = json.loads(line)
        html, url, rounds = request["html"], request.get("url"), max(1, int(request.get("rounds", 1)))
        signal.alarm(60 * (rounds + 1))
        try:
            if rounds > 1:
                convert(html, url)
            times = []
            markdown = ""
            for _ in range(rounds):
                start = time.perf_counter()
                markdown = convert(html, url)
                times.append((time.perf_counter() - start) * 1000)
            reply = {"ok": True, "markdown": markdown, "ms": statistics.median(times)}
        except Exception as error:  # a crash is a result, not a harness failure
            reply = {"ok": False, "markdown": "", "error": f"{type(error).__name__}: {error}", "ms": 0}
        finally:
            signal.alarm(0)
        print(json.dumps(reply), flush=True)


main()
