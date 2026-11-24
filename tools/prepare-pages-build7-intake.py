"""Read the exact owner-approved private Build 7 intake; never publish it."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
REPO = "samie1634/gugu-pages-intake"
B6 = "GuguSeoul-Build6-Pages-Runtime-Only.zip"
B7 = "GuguSeoul-Build7-Pages-Runtime-Only.zip"
RETAINED = {
    B6 + ".part1": "97315559953b69c544ac91afb2bfaf2943b40809",
    B6 + ".part2": "0d9813c221a18fb2827b50803a366b602d8416ca",
}
PARTS = (
    (B7 + ".part1", 19158853, "3f3d71abfb4212eba4bb3ea7622578d9cf25b794cc40cbd2b264d09cf38ce726", "cc10ead36b3cc60870fe4c14bb61f8ffc3d9b01c"),
    (B7 + ".part2", 19158853, "a6d99ab5f4d70e654622c07318bbc8c73a9dc87348a111846ea9ab49be15d906", "1a894b5b73d272ba68a3c9b19a4cc3e0478489c4"),
)
APPROVED = {
    "name": B7, "bytes": 38317706,
    "sha256": "f729c34d01f23d7b2d2d0e311c411cf9be0f9f7e975de306f37727baafe4531d",
}
MANIFEST_SHA256 = "ee9d089e4708e9ddb74aca99ab84f380b7ef7eaba5cc93560142bb6b7535ce74"


class IntakeError(Exception):
    pass


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def check(condition, reason):
    if not condition:
        raise IntakeError(reason)


def require_pin(commit):
    check(re.fullmatch("[a-f0-9]{40}", commit) and commit != "0" * 40,
          "Protected Build 7 intake commit is missing or malformed.")


def verify_manifest(path):
    manifest = path.read_bytes()
    check(hashlib.sha256(manifest).hexdigest() == MANIFEST_SHA256,
          "Reviewed Build 7 manifest changed.")
    check(json.loads(manifest).get("artifact") == APPROVED,
          "Reviewed Build 7 manifest does not pin the approved ZIP.")


def verify_private(open_request, commit, token):
    require_pin(commit)
    check(bool(token) and not any(c.isspace() for c in token),
          "Protected intake read token is missing or malformed.")
    req = urllib.request.Request("https://api.github.com/repos/" + REPO,
        headers={"Authorization": "Bearer " + token, "Accept": "application/vnd.github+json"})
    try:
        with open_request(req, timeout=45) as response:
            check(response.status == 200, "GitHub did not return private intake repository metadata.")
            meta = json.loads(response.read(128 * 1024))
    except urllib.error.HTTPError as exc:
        raise IntakeError(f"GitHub private intake metadata was refused (HTTP {exc.code}).") from None
    check(meta.get("full_name") == REPO and meta.get("private") is True and meta.get("visibility") == "private",
          "Intake repository is missing, has the wrong owner, or is not private.")


def read_git(repo, *args):
    return subprocess.run(["git", "-C", str(repo), *args], stdout=subprocess.PIPE,
                          stderr=subprocess.DEVNULL, check=True).stdout


def assemble(repo, commit, target):
    require_pin(commit)
    check(read_git(repo, "rev-parse", "--verify", "HEAD").decode("ascii").strip() == commit,
          "Checkout does not match the pinned private Build 7 commit.")
    pinned_files = RETAINED | {name: blob for name, _, _, blob in PARTS}
    expected_tree = {f"100644 blob {blob}\t{name}" for name, blob in pinned_files.items()}
    actual_tree = read_git(repo, "ls-tree", "-r", "-z", "HEAD").decode("ascii").rstrip("\0").split("\0")
    check(len(actual_tree) == len(expected_tree) and set(actual_tree) == expected_tree,
          "Intake tree must contain exactly the two original Build 6 blobs and two approved Build 7 blobs.")
    pieces = []
    for name, size, digest, blob in PARTS:
        part = repo / name
        check(not part.is_symlink() and part.is_file() and part.stat().st_size == size,
              "Intake slice size or type mismatch.")
        data = part.read_bytes()
        actual_blob = hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()
        check(hashlib.sha256(data).hexdigest() == digest and actual_blob == blob,
              "Unsafe or changed Build 7 intake slice; refusing.")
        pieces.append(data)
    joined = b"".join(pieces)
    check(len(joined) == APPROVED["bytes"] and hashlib.sha256(joined).hexdigest() == APPROVED["sha256"],
          "Joining Build 7 slices did not reproduce the approved ZIP.")
    with target.open("xb") as file:
        file.write(joined)


def entry():
    parser = argparse.ArgumentParser()
    parser.add_argument("phase", choices=("verify-private", "assemble"))
    phase = parser.parse_args().phase
    try:
        commit = os.environ.get("INTAKE_COMMIT", "")
        verify_manifest(ROOT / "release/build7-manifest.json")
        if phase == "verify-private":
            opener = urllib.request.build_opener(NoRedirect())
            verify_private(opener.open, commit, os.environ.get("INTAKE_TOKEN", ""))
            print("Verified the approved Build 7 manifest and private intake repository.")
        else:
            assemble(ROOT / ".cache/private-package-intake-build7", commit,
                     Path(os.environ["RUNNER_TEMP"]) / "gugu-build7-runtime.zip")
            print("Verified all four Git blobs and reconstructed only the exact approved Build 7 ZIP.")
    except IntakeError as exc:
        raise SystemExit(str(exc)) from None
    except Exception:
        raise SystemExit("Protected private Build 7 intake could not complete safely.") from None


if __name__ == "__main__":
    entry()
