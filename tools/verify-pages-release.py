"""Fail-closed exact-artifact and fresh-build verification for the existing Pages app."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import stat
import zipfile

ROOT = Path(__file__).resolve().parents[1]
PIN = json.loads((ROOT / "release/build6-manifest.json").read_text())
FILES = PIN["files"]

def check(condition, reason):
    if not condition:
        raise SystemExit(reason)

def matches(data, entry):
    return len(data) == entry["bytes"] and hashlib.sha256(data).hexdigest() == entry["sha256"]

def safe(name):
    return bool(name) and not name.startswith("/") and not any(x in ("", ".", "..") for x in name.split("/")) and "\\" not in name and name == PurePosixPath(name).as_posix()

def read_archive(path, materialize):
    check(path.stat().st_size == PIN["artifact"]["bytes"], "Archive size mismatch")
    check(matches(path.read_bytes(), PIN["artifact"]), "Archive SHA-256 mismatch")
    with zipfile.ZipFile(path) as archive:
        items = archive.infolist()
        check(len(items) == len(FILES) and set(FILES) == {i.filename for i in items}, "Archive members changed, missing, or duplicate")
        for item in items:
            check(safe(item.filename) and not item.is_dir() and not stat.S_ISLNK(item.external_attr >> 16), "Invalid member " + item.filename)
            entry = FILES[item.filename]
            check(item.file_size == entry["bytes"] and matches(archive.read(item), entry), "Wrong member bytes: " + item.filename)
            if not (materialize and "input" in entry):
                continue
            rel = entry["input"]
            check(rel == "public/" + item.filename and safe(rel), "Unexpected build input path")
            check(entry["rightsMode"] in ("integrated-game-only","cc0","owner-confirmed-game-release") and bool(entry["provenance"]), "No release rights classification")
            dest = ROOT / rel
            check(dest.resolve().is_relative_to((ROOT / "public").resolve()) and not dest.exists(), "Refusing to replace a source file")
            dest.parent.mkdir(parents=True, exist_ok=True)
            with dest.open("xb") as target:
                target.write(archive.read(item))
    print(f"Verified exact intake ZIP and all {len(FILES)} approved runtime members.")

def built(directory):
    actual = {path.relative_to(directory).as_posix() for path in directory.rglob("*") if path.is_file()}
    check(actual == set(FILES), "Fresh build adds or omits a published file")
    for name, entry in FILES.items():
        f = directory / name
        check(not f.is_symlink() and matches(f.read_bytes(), entry), "Fresh build changed " + name)
    print(f"Fresh build byte-matches the {len(FILES)} approved shipped files.")

cli = argparse.ArgumentParser()
cli.add_argument("step", choices=("verify","hydrate","dist"))
cli.add_argument("path", type=Path)
opts = cli.parse_args()
if opts.step == "dist":
    built(opts.path)
else:
    read_archive(opts.path, opts.step == "hydrate")
