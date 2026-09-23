#!/usr/bin/env python3
"""
build_vault.py — Generate an Obsidian vault that visualizes a code repo's
file structure AND import/dependency graph in 3D (via the "3D Graph" plugin).

USAGE:
    python build_vault.py /path/to/vettan-ai /path/to/output-vault

Then:
  1. Open Obsidian -> "Open folder as vault" -> select the output-vault dir
  2. Settings -> Community plugins -> turn off Restricted Mode -> Browse
  3. Install "3D Graph" (by AlexW00) or "Graph 3D" plugin -> Enable it
  4. Open via Command Palette ("3D Graph: Open") to see the 3D view

WHAT IT DOES:
  - Creates one Markdown note per source file in the repo
  - Each note links to its parent folder's note (hierarchy edges)
  - Each note links to other files it imports/requires (dependency edges),
    resolved for Python, JS/TS, and basic relative imports
  - Adds YAML frontmatter with file type / folder tags for graph coloring
    (color groups can be set in Obsidian's Graph View settings by tag)
"""

import os
import re
import sys
import json
from pathlib import Path

CODE_EXTENSIONS = {".py", ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"}
SKIP_DIRS = {".git", "node_modules", "__pycache__", ".next", "dist", "build",
             "venv", ".venv", "env", ".pytest_cache", ".idea", ".vscode"}

# Files that should never be turned into notes or have their contents read —
# these commonly hold secrets / credentials.
SKIP_FILE_NAMES_EXACT = {
    ".env", ".env.local", ".env.production", ".env.development",
    ".env.test", ".env.staging",
}
SKIP_FILE_PREFIXES = (".env.",)  # catches .env.anything not listed above
SKIP_FILE_SUFFIXES = (".pem", ".key", ".p12", ".pfx")


def is_secret_file(filename):
    if filename in SKIP_FILE_NAMES_EXACT:
        return True
    if filename.startswith(SKIP_FILE_PREFIXES):
        return True
    if filename.lower().endswith(SKIP_FILE_SUFFIXES):
        return True
    return False


def load_ts_path_aliases(repo_root):
    """
    Read tsconfig.json (or jsconfig.json) compilerOptions.paths and return a
    dict mapping alias prefix -> list of resolved base dirs, e.g.
        {"@": [repo_root / "src"]}
    Falls back gracefully if the file is missing or unparsable (tsconfig
    allows comments/trailing commas which strict json.load rejects, so we
    strip those first).
    """
    aliases = {}
    for cfg_name in ("tsconfig.json", "jsconfig.json"):
        candidates = [repo_root / cfg_name] + list(repo_root.glob(f"*/{cfg_name}"))
        for cfg_path in candidates:
            if not cfg_path.exists():
                continue
            try:
                raw = cfg_path.read_text(encoding="utf-8", errors="ignore")
                raw = re.sub(r'//.*', '', raw)
                raw = re.sub(r'/\*.*?\*/', '', raw, flags=re.DOTALL)
                raw = re.sub(r',(\s*[}\]])', r'\1', raw)
                data = json.loads(raw)
            except Exception:
                continue

            compiler_opts = data.get("compilerOptions", {})
            base_url = compiler_opts.get("baseUrl", ".")
            paths = compiler_opts.get("paths", {})
            base_dir = (cfg_path.parent / base_url).resolve()

            for alias, targets in paths.items():
                alias_clean = alias.replace("/*", "")
                resolved_targets = []
                for t in targets:
                    t_clean = t.replace("/*", "")
                    resolved_targets.append((base_dir / t_clean).resolve())
                aliases[alias_clean] = resolved_targets

    return aliases


def resolve_alias_import(mod, aliases, all_files_set):
    """Try to resolve a non-relative import using tsconfig path aliases."""
    for alias_prefix, target_dirs in aliases.items():
        if mod == alias_prefix or mod.startswith(alias_prefix + "/"):
            remainder = mod[len(alias_prefix):].lstrip("/")
            for target_dir in target_dirs:
                base = (target_dir / remainder) if remainder else target_dir
                candidates = [base]
                for ext in (".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"):
                    candidates.append(base.with_suffix(ext))
                    candidates.append(base / f"index{ext}")
                for c in candidates:
                    if c in all_files_set:
                        return c
    return None

IMPORT_PATTERNS = [
    # Python: import x.y.z / from x.y import z
    re.compile(r'^\s*from\s+([.\w]+)\s+import\b', re.MULTILINE),
    re.compile(r'^\s*import\s+([.\w]+)', re.MULTILINE),
    # JS/TS: import ... from './x' or '@/x'; require('./x') or require('@/x')
    re.compile(r'''import\s+.*?from\s+['"]([^'"]+)['"]'''),
    re.compile(r'''require\(\s*['"]([^'"]+)['"]\s*\)'''),
    re.compile(r'''import\s+['"]([^'"]+)['"]'''),
]


def safe_note_name(rel_path: Path) -> str:
    """Turn a file path into a unique, Obsidian-safe note name."""
    s = str(rel_path).replace(os.sep, "__")
    return s


def collect_files(root: Path):
    files = []
    skipped_secrets = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS and not d.startswith(".")]
        for fn in filenames:
            if is_secret_file(fn):
                skipped_secrets.append(str(Path(dirpath) / fn))
                continue
            p = Path(dirpath) / fn
            files.append(p)
    return files, skipped_secrets


def resolve_python_import(root: Path, current_file: Path, module: str, all_py_files):
    """Best-effort resolution of a python module path to an actual file in repo."""
    module = module.lstrip(".")
    parts = module.split(".")
    candidate = root
    for p in parts:
        candidate = candidate / p
    for ext in (".py",):
        f = candidate.with_suffix(ext)
        if f in all_py_files:
            return f
    init_f = candidate / "__init__.py"
    if init_f in all_py_files:
        return init_f
    # try matching just by filename anywhere (loose fallback)
    target_name = parts[-1] + ".py"
    for f in all_py_files:
        if f.name == target_name:
            return f
    return None


def resolve_relative_import(current_file: Path, rel: str, all_files_set):
    """Resolve JS/TS relative imports like './foo' or '../bar/baz'."""
    base = (current_file.parent / rel).resolve()
    candidates = [base]
    for ext in (".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"):
        candidates.append(base.with_suffix(ext))
        candidates.append(base / f"index{ext}")
    for c in candidates:
        if c in all_files_set:
            return c
    return None


def main():
    if len(sys.argv) != 3:
        print("Usage: python build_vault.py <repo_path> <output_vault_path>")
        sys.exit(1)

    repo_root = Path(sys.argv[1]).resolve()
    vault_root = Path(sys.argv[2]).resolve()
    vault_root.mkdir(parents=True, exist_ok=True)

    all_files, skipped_secrets = collect_files(repo_root)
    all_files_set = set(f.resolve() for f in all_files)
    py_files = set(f for f in all_files if f.suffix == ".py")
    ts_aliases = load_ts_path_aliases(repo_root)

    if skipped_secrets:
        print(f"Skipped {len(skipped_secrets)} secret/credential file(s) (not included in vault):")
        for s in skipped_secrets:
            print(f"  - {s}")
        print()

    notes_dir = vault_root / "notes"
    notes_dir.mkdir(exist_ok=True)

    folder_notes = {}  # folder path -> note name
    file_note_names = {}  # file path -> note name

    # First pass: create folder notes
    folders = set()
    for f in all_files:
        rel_parent = f.parent.relative_to(repo_root)
        parts = rel_parent.parts
        for i in range(len(parts) + 1):
            folders.add(Path(*parts[:i]) if i > 0 else Path("."))

    for folder in folders:
        name = "ROOT" if str(folder) == "." else "folder__" + str(folder).replace(os.sep, "__")
        folder_notes[folder] = name

    for folder, name in folder_notes.items():
        parent = folder.parent if str(folder) != "." else None
        content_lines = ["---", "type: folder", f"tags: [folder]", "---", ""]
        content_lines.append(f"# 📁 {folder if str(folder) != '.' else 'ROOT'}")
        content_lines.append("")
        if parent is not None and parent in folder_notes:
            content_lines.append(f"Parent: [[{folder_notes[parent]}]]")
            content_lines.append("")
        children_folders = [f2 for f2 in folder_notes if f2.parent == folder and f2 != folder]
        if children_folders:
            content_lines.append("## Subfolders")
            for c in sorted(children_folders, key=str):
                content_lines.append(f"- [[{folder_notes[c]}]]")
            content_lines.append("")
        (notes_dir / f"{name}.md").write_text("\n".join(content_lines), encoding="utf-8")

    # Second pass: create file notes with hierarchy link
    for f in all_files:
        rel = f.relative_to(repo_root)
        name = safe_note_name(rel)
        file_note_names[f.resolve()] = name

    for f in all_files:
        rel = f.relative_to(repo_root)
        name = file_note_names[f.resolve()]
        ext = f.suffix
        is_code = ext in CODE_EXTENSIONS

        try:
            text = f.read_text(encoding="utf-8", errors="ignore") if is_code else ""
        except Exception:
            text = ""

        deps = set()
        if is_code and text:
            for pat in IMPORT_PATTERNS:
                for m in pat.finditer(text):
                    mod = m.group(1)
                    resolved = None
                    if ext == ".py":
                        resolved = resolve_python_import(repo_root, f, mod, py_files)
                    elif mod.startswith("."):
                        resolved = resolve_relative_import(f, mod, all_files_set)
                    elif ts_aliases:
                        resolved = resolve_alias_import(mod, ts_aliases, all_files_set)
                    if resolved and resolved.resolve() in file_note_names:
                        deps.add(file_note_names[resolved.resolve()])

        parent_folder = f.parent.relative_to(repo_root)
        parent_folder = parent_folder if str(parent_folder) != "." else Path(".")
        tag = ext.lstrip(".") or "file"

        lines = ["---", "type: file", f"tags: [{tag}]", "---", ""]
        lines.append(f"# {rel.name}")
        lines.append("")
        lines.append(f"Path: `{rel}`")
        lines.append("")
        if parent_folder in folder_notes:
            lines.append(f"Folder: [[{folder_notes[parent_folder]}]]")
            lines.append("")
        if deps:
            lines.append("## Imports / Depends on")
            for d in sorted(deps):
                lines.append(f"- [[{d}]]")
            lines.append("")

        (notes_dir / f"{name}.md").write_text("\n".join(lines), encoding="utf-8")

    print(f"Vault generated at: {vault_root}")
    print(f"Total notes created: {len(list(notes_dir.glob('*.md')))}")
    print("\nNext steps:")
    print("1. Open Obsidian -> 'Open folder as vault' -> select:", vault_root)
    print("2. Settings -> Community plugins -> disable Restricted Mode -> Browse")
    print("3. Search and install '3D Graph' (by AlexW00), then enable it")
    print("4. Command Palette -> '3D Graph: Open' for the 3D view")
    print("   (Regular 2D Graph View is built-in: click the graph icon in the left sidebar)")


if __name__ == "__main__":
    main()
