"""
The decomposition prompt uses the current year, never a hard-coded one. No network needed:
the OpenAI client is faked and only the prompt it receives is checked.

    python tests/test_decomposition_year.py

Whether the model follows the year rules can't be checked offline; these tests cover
what the code controls: the year in the prompt and the user's question passed through intact.
"""
import os
import sys

os.environ.setdefault("OPENAI_API_KEY", "test")
os.environ.setdefault("TAVILY_API_KEY", "test")

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import asyncio  # noqa: E402
import json  # noqa: E402
from datetime import datetime, timezone  # noqa: E402
from types import SimpleNamespace as NS  # noqa: E402

from agent import research_pipeline as rp  # noqa: E402

failures = []


def check(label, cond, detail=""):
    print(f"  {'PASS' if cond else 'FAIL'}  {label}{'  ' + detail if detail and not cond else ''}")
    if not cond:
        failures.append(label)


prompts = []


class FakeCompletions:
    async def create(self, **kw):
        prompts.append(kw["messages"][-1]["content"])
        content = json.dumps(["a b c", "d e f", "g h i"])
        return NS(choices=[NS(message=NS(content=content))], usage=NS(prompt_tokens=1, completion_tokens=1))


rp.openai_client = NS(chat=NS(completions=FakeCompletions()))


def prompt_for(query):
    prompts.clear()
    asyncio.run(rp.decompose_query(query))
    return prompts[-1]


print("\n[1] Year in the prompt")

check("the template no longer contains 2025", "2025" not in rp.DECOMPOSITION_PROMPT)

real_year = rp._current_year
rp._current_year = lambda: 2031
p = prompt_for("latest heat pump subsidies")
check("prompt uses the current year it is given (2031)", "2031" in p, p[:200])
check("  ...and no stale year", "2025" not in p)
rp._current_year = real_year

check("default is the current UTC year", real_year() == datetime.now(timezone.utc).year, str(real_year()))
check("  ...and that is what a real call puts in the prompt",
      str(datetime.now(timezone.utc).year) in prompt_for("latest heat pump subsidies"))


print("\n[2] The user's question and the year rules")

question = 'What did the EU decide on AI regulation in 2019?'
p = prompt_for(question)
check("a year the user asked about reaches the model verbatim", json.dumps(question) in p, p[-200:])
check("prompt tells the model to keep a year the question names", "If the question names a year, use that year" in p)
check("prompt tells the model not to add a year to timeless questions",
      "Do not add a year to questions about concepts or how something works" in p)
check("the timeless example no longer adds a year", '"RAG vs fine tuning LLM comparison"]' in p)
check("still recognisable as the decomposition prompt", "search query optimizer" in p)


print("\n" + "=" * 60)
if failures:
    print(f"FAILED ({len(failures)}):")
    for f in failures:
        print("  -", f)
    sys.exit(1)
print("All decomposition year checks passed.")
