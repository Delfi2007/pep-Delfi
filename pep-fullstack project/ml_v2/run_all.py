"""Unattended runner: download -> convert -> train -> evaluate -> report -> shutdown.

Runs each stage as its own process (logs in results_v2/), retries a failed stage
once, always writes the report, writes RUN_REPORT.md, then schedules a Windows
shutdown with a 10-minute warning (cancel with:  shutdown /a).

    ..\\.venv\\Scripts\\python run_all.py            # full run, shuts down at the end
    ..\\.venv\\Scripts\\python run_all.py --no-shutdown
"""
import os
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
RES = ROOT / "results_v2"
PY = str(ROOT / ".venv" / "Scripts" / "python.exe")
ENV = {**os.environ, "PYTHONIOENCODING": "utf-8", "PYTHONUNBUFFERED": "1"}
ENV.pop("SMOKE", None)

STAGES = [
    ("download", ["s1_download.py"]),
    ("convert", ["s3_convert.py", "training"]),        # only what training needs
    ("train", ["s4_train.py"]),
    ("convert_eval", ["s3_convert.py", "eval"]),       # speech/OCR/hash accuracy measurements
    ("evaluate", ["s5_evaluate.py"]),
    ("report", ["s6_report.py"]),
]

REPORT = RES / "RUN_REPORT.md"
lines = [f"# Run report", "", f"Started {datetime.now():%d-%m-%Y %H:%M}", "",
         "| Stage | Attempt | Result | Minutes |", "|---|---|---|---|"]


def note(text):
    with open(RES / "run_all.log", "a", encoding="utf-8") as f:
        f.write(f"{datetime.now():%H:%M:%S} {text}\n")


def write_report(extra=()):
    REPORT.write_text("\n".join(lines + list(extra)) + "\n", encoding="utf-8")


def other_downloader_running():
    # Only count python processes — the PowerShell process running this query also
    # has "s1_download.py" in its own command line and must not count itself.
    out = subprocess.run(["powershell", "-NoProfile", "-Command",
                          "Get-CimInstance Win32_Process -Filter \"Name like 'python%'\" | "
                          "Where-Object { $_.CommandLine -like '*s1_download.py*' } "
                          "| Measure-Object | Select-Object -ExpandProperty Count"],
                         capture_output=True, text=True).stdout.strip()
    return int(out or 0) > 0


def script_running(script):
    out = subprocess.run(["powershell", "-NoProfile", "-Command",
                          "Get-CimInstance Win32_Process -Filter \"Name like 'python%'\" | "
                          f"Where-Object {{ $_.CommandLine -like '*{script}*' }} "
                          "| Measure-Object | Select-Object -ExpandProperty Count"],
                         capture_output=True, text=True).stdout.strip()
    return int(out or 0) > 0


def run_stage(name, args):
    while script_running(args[0]):          # a copy left running by an earlier runner — let it finish
        time.sleep(30)
    for attempt in (1, 2):
        t0 = time.time()
        note(f"start {name} attempt {attempt}")
        with open(RES / f"{name}.log", "a", encoding="utf-8") as out, open(RES / f"{name}.err.log", "a", encoding="utf-8") as err:
            code = subprocess.run([PY, *args], cwd=HERE, env=ENV, stdout=out, stderr=err).returncode
        mins = (time.time() - t0) / 60
        ok = code == 0
        lines.append(f"| {name} | {attempt} | {'ok' if ok else f'failed (exit {code})'} | {mins:.1f} |")
        write_report()
        note(f"end {name} attempt {attempt}: exit {code} after {mins:.1f} min")
        if ok:
            return True
    return False


def main():
    shutdown = "--no-shutdown" not in sys.argv
    waited = 0
    while other_downloader_running() and waited < 60 * 60:      # an earlier downloader may still be running
        time.sleep(30)
        waited += 30
    note(f"waited {waited / 60:.1f} min for the earlier downloader")
    results = {}
    for name, args in STAGES:
        results[name] = run_stage(name, args)
    failed = [k for k, v in results.items() if not v]
    extra = ["", f"Finished {datetime.now():%d-%m-%Y %H:%M}", "",
             "All stages succeeded." if not failed else f"Stages that failed after a retry: {', '.join(failed)}. "
             f"See results_v2/<stage>.err.log.", "",
             "Results: results_v2/RESULTS_v2.md · Models: models_v2/ · Data: data_v2/",
             "The application was not modified and nothing was pushed."]
    if shutdown:
        extra.append(f"Laptop shutdown scheduled at {datetime.now():%H:%M} (+10 min).")
    write_report(extra)
    if shutdown:
        subprocess.run(["shutdown", "/a"], capture_output=True)
        subprocess.run(["shutdown", "/s", "/t", "600", "/c",
                        "ACPIA ML v2 run finished - shutting down in 10 minutes. Cancel with: shutdown /a"])


if __name__ == "__main__":
    main()
