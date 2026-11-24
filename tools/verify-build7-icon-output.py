"""Verify the exact Build 7 Pages output with only the owner-approved icon overlay."""
import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASE_SHA256 = "ee9d089e4708e9ddb74aca99ab84f380b7ef7eaba5cc93560142bb6b7535ce74"
OVERLAY_SHA256 = "3cabb1200ab411da92c2741961473f4931cc625bae1d4bd539db040c74656e67"
CROP_SHA256 = "411b6fb841e2198157b5ba789d5585109ad6c01800afe871c525058ee49f18e2"
ICONS = {
    "icons/gugu-seoul-favicon-411b6fb841e2.ico",
    "icons/gugu-seoul-favicon-411b6fb841e2-32.png",
    "icons/gugu-seoul-apple-touch-411b6fb841e2.png",
}
ORIGINAL = b'    <link rel="icon" type="image/svg+xml" href="./pigeon.svg" />'
REPLACEMENT = b'''    <link rel="icon" href="./icons/gugu-seoul-favicon-411b6fb841e2.ico" sizes="16x16 32x32 48x48" />
    <link rel="icon" type="image/png" href="./icons/gugu-seoul-favicon-411b6fb841e2-32.png" sizes="32x32" />
    <link rel="apple-touch-icon" href="./icons/gugu-seoul-apple-touch-411b6fb841e2.png" sizes="180x180" />'''


def check(condition, reason):
    if not condition:
        raise SystemExit(reason)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def pinned_json(path, sha, label):
    check(path.is_file() and not path.is_symlink(), "Missing or unsafe " + label)
    data = path.read_bytes()
    check(digest(data) == sha, label + " SHA-256 mismatch")
    return json.loads(data)


def verify(directory, release):
    base = pinned_json(release / "build7-manifest.json", BASE_SHA256, "Build 7 base manifest")
    overlay = pinned_json(release / "build7-icon-output.json", OVERLAY_SHA256, "Build 7 icon overlay")
    check(set(overlay) == {"baseManifestSha256", "source", "files"}
          and overlay["baseManifestSha256"] == BASE_SHA256
          and overlay["source"] == {"kind": "owner-approved-ai-crop", "sha256": CROP_SHA256, "pixels": [670, 670]},
          "Wrong base or crop provenance")
    files = base["files"]
    replacements = overlay["files"]
    check(len(files) == 34 and not (set(files) & ICONS) and set(replacements) == ICONS | {"index.html"},
          "Only the approved icon links and three exact output icons are allowed")
    expected = files | replacements
    check(directory.is_dir() and not directory.is_symlink(), "Missing or unsafe output directory")
    members = list(directory.rglob("*"))
    check(not any(path.is_symlink() for path in members), "Linked output is not permitted")
    check(all(path.is_file() or path.is_dir() for path in members), "Output contains a non-regular entry")
    actual = {path.relative_to(directory).as_posix() for path in members if path.is_file()}
    check(actual == set(expected) and len(actual) == 37, "Fresh build adds or omits a published file")
    for name, pin in expected.items():
        data = (directory / name).read_bytes()
        check(len(data) == pin["bytes"] and digest(data) == pin["sha256"], "Fresh build changed " + name)
    index = (directory / "index.html").read_bytes()
    check(index.count(REPLACEMENT) == 1
          and digest(index.replace(REPLACEMENT, ORIGINAL, 1)) == files["index.html"]["sha256"],
          "Only the favicon and web shortcut links may change in index.html")
    print("Verified all 37 exact output files: 33 unchanged, one favicon-link-only index change, three approved icon assets.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("dist", type=Path)
    verify(parser.parse_args().dist, ROOT / "release")
