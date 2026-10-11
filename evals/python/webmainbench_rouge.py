# /// script
# requires-python = ">=3.10"
# dependencies = ["jieba==0.42.1", "rouge-score==0.1.2"]
# ///
"""WebMainBench's published metric: ROUGE-5 F1 over jieba tokens, per page, averaged.

Scores the Markdown that `gold:eval -- --sets=webmainbench --save-outputs` saved, against
`convert_main_content`, exactly as MinerU-HTML's `eval_baselines` does for an extractor that emits
Markdown itself ("MD" mode, like its `trafilatura-md` row): no html2text pass, no normalisation.

Usage:
  uv run --script python/webmainbench_rouge.py .reports/gold/current-webforai.outputs.jsonl ...
"""

import json
import statistics
import sys
from multiprocessing import Pool
from pathlib import Path

import jieba
from rouge_score.rouge_scorer import _create_ngrams, _score_ngrams

jieba.setLogLevel(jieba.logging.INFO)

TRUTH = Path(__file__).resolve().parent.parent / ".cache" / "gold" / "webmainbench" / "ground-truth.jsonl"


# Copied from MinerU-HTML eval_baselines/utils.py (commit 73cf266, Apache-2.0), unchanged in
# behaviour: the untrimmed text is tokenized, so whitespace and punctuation are tokens too.
def calc_rouge_n_score(target_input: str, prediction_input: str, n: int = 5) -> dict:
    target = target_input.strip()
    prediction = prediction_input.strip()
    if len(target) == 0 and len(prediction) == 0:
        return {"prec": 1.0, "rec": 1.0, "f1": 1.0}
    target_ngrams = _create_ngrams(jieba.lcut(target_input), n)
    prediction_ngrams = _create_ngrams(jieba.lcut(prediction_input), n)
    score = _score_ngrams(target_ngrams, prediction_ngrams)
    return {"prec": score.precision, "rec": score.recall, "f1": score.fmeasure}


def score(pair):
    return calc_rouge_n_score(*pair)


def main() -> None:
    truths = {}
    for line in TRUTH.read_text(encoding="utf-8").split("\n"):
        if line.strip():
            truth = json.loads(line)
            truths[f"webmainbench/{truth['id']}"] = truth
    print("| pipeline | pages | ROUGE-5 F1 | simple | mid | hard | P | R |")
    print("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |")
    with Pool() as pool:
        for path in sys.argv[1:]:
            outputs = [json.loads(line) for line in Path(path).read_text(encoding="utf-8").split("\n") if line.strip()]
            outputs = [output for output in outputs if output["id"] in truths]
            scores = pool.map(score, [(truths[o["id"]]["markdown"], o["markdown"]) for o in outputs], chunksize=16)
            levels = [truths[o["id"]]["level"] for o in outputs]

            def mean(key, level=None):
                values = [s[key] for s, lv in zip(scores, levels) if level in (None, lv)]
                return statistics.mean(values) if values else float("nan")

            name = Path(path).name.removesuffix(".outputs.jsonl")
            print(
                f"| {name} | {len(scores)} | {mean('f1'):.4f} | {mean('f1', 'simple'):.4f} | {mean('f1', 'mid'):.4f}"
                f" | {mean('f1', 'hard'):.4f} | {mean('prec'):.4f} | {mean('rec'):.4f} |",
                flush=True,
            )
            per_page = Path(path).with_name(f"{name}.rouge.jsonl")
            per_page.write_text("\n".join(json.dumps({"id": o["id"], **s}) for o, s in zip(outputs, scores)), encoding="utf-8")


if __name__ == "__main__":
    main()
