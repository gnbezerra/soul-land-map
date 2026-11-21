"""Checks that the documentation's cross-references resolve, on the real repo (like the icons check in
test_make_icons.py): no made-up data is needed, because what is tested is the repo itself.

Run: python -m unittest discover -s tests

The documents cite each other by document and section (`docs/DATA.md` "Calibration", ROADMAP "Known gaps",
SPEC §4.5), and so do comments in the code. A section renamed or removed, a SPEC section renumbered, or a
link to a moved file would leave those references pointing nowhere; the Markdown lint does not see that.
README "Documentation" explains the convention.
"""
import re
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# The names a reference may use for each document, and the file it means.
DOCS = {
    "README": "README.md",
    "CLAUDE": "CLAUDE.md",
    "DATA": "docs/DATA.md",
    "SPEC": "docs/SPEC.md",
    "GAME-NOTES": "docs/GAME-NOTES.md",
    "ROADMAP": "docs/ROADMAP.md",
    "LICENSING": "docs/LICENSING.md",
}
# Where references are looked for: the docs and the code that cites them (vendored code excluded).
SCANNED = ("*.md", "*.py", "*.js", "*.mjs", "*.css", "*.yml", "*.html")

# `docs/DATA.md` "Calibration", DATA.md "Calibration", ROADMAP "Known gaps": a document name, then a
# quoted section name. The name may hold a line break, so that a split reference is reported, not missed.
SECTION_REF = re.compile(r'(?<![\w-])(?:docs/)?(' + "|".join(map(re.escape, DOCS)) + r')(?:\.md)?`?[ \t]+"([^"]+)"')
SPEC_REF = re.compile(r"SPEC\s+§\s*(\d+(?:\.\d+)?)")
BARE_SECTION_REF = re.compile(r"§\s*(\d+(?:\.\d+)?)")  # inside SPEC, its own sections
LINK = re.compile(r"\]\(([^)\s]+)\)")
FENCE = re.compile(r"^```.*?^```", re.MULTILINE | re.DOTALL)
HEADING = re.compile(r"^#{1,6}\s+(.+?)\s*$", re.MULTILINE)
SPEC_NUMBER = re.compile(r"^(\d+(?:\.\d+)?)\.?\s+(.*)$")


def tracked_files():
    out = subprocess.run(["git", "ls-files", "--", *SCANNED], cwd=ROOT, capture_output=True, text=True,
                         check=True, encoding="utf-8").stdout
    return [ROOT / p for p in out.splitlines() if not p.startswith(("vendor/", "node_modules/"))]


def read(path):
    return path.read_text(encoding="utf-8")


def line_of(text, index):
    return text.count("\n", 0, index) + 1


def headings(text):
    """The heading texts of a Markdown file, without SPEC's "4.5" numbers, outside code blocks."""
    names = set()
    for heading in HEADING.findall(FENCE.sub("", text)):
        numbered = SPEC_NUMBER.match(heading)
        names.add(numbered.group(2) if numbered else heading)
    return names


def spec_numbers():
    text = FENCE.sub("", read(ROOT / DOCS["SPEC"]))
    return {m.group(1) for h in HEADING.findall(text) if (m := SPEC_NUMBER.match(h))}


class DocsTest(unittest.TestCase):
    def setUp(self):
        self.files = tracked_files()
        self.assertTrue(self.files, "git ls-files found nothing to scan")

    def test_every_documented_file_exists(self):
        for name, path in DOCS.items():
            self.assertTrue((ROOT / path).is_file(), f"{name}: {path} is missing")

    def test_section_references_point_to_existing_headings(self):
        sections = {name: headings(read(ROOT / path)) for name, path in DOCS.items()}
        problems = []
        for path in self.files:
            text = read(path)
            for m in SECTION_REF.finditer(text):
                doc, section = m.group(1), m.group(2)
                where = f"{path.relative_to(ROOT).as_posix()}:{line_of(text, m.start())}"
                if "\n" in section:
                    problems.append(f'{where}: {doc} "{" ".join(section.split())}" is split across lines; '
                                    "keep a section name on one line so a search finds it")
                elif section not in sections[doc]:
                    problems.append(f'{where}: {doc} has no section "{section}"')
        self.assertEqual(problems, [], "\n" + "\n".join(problems))

    def test_spec_section_numbers_exist(self):
        numbers = spec_numbers()
        spec = ROOT / DOCS["SPEC"]
        problems = []
        for path in self.files:
            text = read(path)
            pattern = BARE_SECTION_REF if path == spec else SPEC_REF
            for m in pattern.finditer(text):
                if m.group(1) not in numbers:
                    problems.append(f"{path.relative_to(ROOT).as_posix()}:{line_of(text, m.start())}: "
                                    f"SPEC has no §{m.group(1)}")
        self.assertEqual(problems, [], "\n" + "\n".join(problems))

    def test_relative_links_point_to_existing_files(self):
        problems = []
        for path in self.files:
            if path.suffix != ".md":
                continue
            text = read(path)
            for m in LINK.finditer(FENCE.sub("", text)):
                target = m.group(1).split("#")[0]
                if not target or re.match(r"^[a-z]+:", target):  # an anchor, or http:, https:, mailto:
                    continue
                if not (path.parent / target).exists():
                    problems.append(f"{path.relative_to(ROOT).as_posix()}: link to {target}, which does not exist")
        self.assertEqual(problems, [], "\n" + "\n".join(problems))


if __name__ == "__main__":
    unittest.main()
