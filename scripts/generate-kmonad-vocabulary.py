#!/usr/bin/env python3
"""Derive the KMonad key-token vocabulary from the pinned Keycode.hs."""

import json
import re
import sys

PIN = "30b9705fb56059483969624d58cad077d5c62300"

with open("Keycode.hs", encoding="utf-8") as handle:
    source = handle.read()

# --- Parse the Keycode ADT ---------------------------------------------------
# data Keycode
#   = KeyReserved
#   | KeyEsc
#   ...
constructors = []
for line in source.splitlines():
    match = re.match(r"^\s*(?:=\s*|\|\s*)([A-Za-z][A-Za-z0-9]*)\s*$", line)
    if match:
        constructors.append(match.group(1))
# The `data Keycode` line itself is followed by `= KeyReserved`; ensure no
# `data Keycode` name was captured (it would not match the regex because of
# the "data" prefix on the same line). Guard: drop anything that also appears
# as a leading token of "data Keycode".
constructors = [c for c in constructors if c != "Keycode"]

# Only mappable keyboard keycodes: the kcNotMissing set in Keycode.hs filters
# to constructors whose name starts with "Key".
key_constructors = [c for c in constructors if c.startswith("Key")]

# --- Parse the aliases block -------------------------------------------------
#   , (KeyEnter,            ["ret", "return", "ent"])
alias_entries = {}
for raw_line in source.splitlines():
    # Strip a Haskell line comment (lines such as
    # `-- , (KeyHomepage, ["home"]) -- conflict with KeyHome` must not count).
    line = raw_line.split("--", 1)[0]
    match = re.search(r"\(\s*(Key[A-Za-z0-9]+)\s*,\s*\[", line)
    if not match:
        continue
    constructor = match.group(1)
    start = match.end() - 1  # position of the opening '['
    in_string = False
    index = start
    while index < len(line):
        character = line[index]
        if in_string:
            if character == "\\":
                index += 2
                continue
            if character == '"':
                in_string = False
        else:
            if character == '"':
                in_string = True
            elif character == "]":
                break
        index += 1
    content = line[start + 1 : index]
    aliases = []
    for item in re.findall(r'"((?:[^"\\]|\\.)*)"', content):
        # Minimal Haskell string unescaping; only `\\` occurs in this file.
        aliases.append(item.replace("\\\\", "\\"))
    alias_entries.setdefault(constructor, []).extend(aliases)

ordered = sorted(key_constructors)

# --- Emit the Go table -------------------------------------------------------
out = []
out.append("// Package geometry provides explicitly selectable, source-key-verified editor")
out.append("// layouts. A device's display name is never used to choose a layout.")
out.append("")
out.append("// Code generated from kmonad's src/KMonad/Keyboard/Keycode.hs at commit")
out.append(f"// {PIN} by scripts/generate-kmonad-vocabulary.py. DO NOT EDIT.")
out.append("// Regenerate from the repository root:")
out.append("//   python3 scripts/generate-kmonad-vocabulary.py internal/geometry/kmonad_vocabulary.go")
out.append("// The vocabulary tests pin this table to that commit's source counts.")
out.append("//")
out.append("// The table is the verified KMonad keyboard-token vocabulary: every Key*")
out.append("// keycode constructor that exists at the pinned commit, with the alias")
out.append("// spellings KMonad accepts. Btn*, Missing*, and VK* ranges are excluded")
out.append("// because they are not mappable keyboard keys. KMonad accepts, for each")
out.append("// constructor: the constructor name, its lowercased form, the name with the")
out.append("// \"Key\" prefix dropped, that lowercased, and the aliases listed below.")
out.append("")
out.append("package geometry")
out.append("")
out.append('import "strings"')
out.append("")
out.append("// kmonadKeycode is one mappable KMonad keycode at the pinned commit with the")
out.append("// additional alias spellings KMonad accepts for it.")
out.append("type kmonadKeycode struct {")
out.append("\tConstructor string")
out.append("\tAliases     []string")
out.append("}")
out.append("")
out.append("// kmonadKeycodes lists every mappable keyboard keycode at the pinned commit.")
out.append("var kmonadKeycodes = []kmonadKeycode{")
for constructor in ordered:
    aliases = alias_entries.get(constructor, [])
    alias_literal = ", ".join(json.dumps(a) for a in aliases)
    out.append(f'\t{{Constructor: "{constructor}", Aliases: []string{{{alias_literal}}}}},')
out.append("}")
out.append("")
out.append("// kmonadKeycodeTokens maps every accepted spelling to its Keycode constructor.")
out.append("var kmonadKeycodeTokens = buildKMonadKeycodeTokens()")
out.append("")
out.append("func buildKMonadKeycodeTokens() map[string]string {")
out.append("\ttokens := make(map[string]string)")
out.append("\tfor _, keycode := range kmonadKeycodes {")
out.append("\t\tshort := strings.TrimPrefix(keycode.Constructor, \"Key\")")
out.append("\t\tfor _, token := range []string{")
out.append("\t\t\tkeycode.Constructor, strings.ToLower(keycode.Constructor),")
out.append("\t\t\tshort, strings.ToLower(short),")
out.append("\t\t} {")
out.append("\t\t\ttokens[token] = keycode.Constructor")
out.append("\t\t}")
out.append("\t\tfor _, alias := range keycode.Aliases {")
out.append("\t\t\ttokens[alias] = keycode.Constructor")
out.append("\t\t}")
out.append("\t}")
out.append("\treturn tokens")
out.append("}")
out.append("")
out.append("// KnownKMonadKeys returns the accepted keyboard-token vocabulary at the pinned")
out.append("// KMonad commit. The compiler requires every defsrc token and every emitted")
out.append("// single-key behavior to be one of these spellings.")
out.append("func KnownKMonadKeys() map[string]bool {")
out.append("\tkeys := make(map[string]bool, len(kmonadKeycodeTokens))")
out.append("\tfor token := range kmonadKeycodeTokens {")
out.append("\t\tkeys[token] = true")
out.append("\t}")
out.append("\treturn keys")
out.append("}")

with open(sys.argv[1], "w", encoding="utf-8") as handle:
    handle.write("\n".join(out) + "\n")

print(f"Key* constructors: {len(key_constructors)}")
print(f"Aliased constructors: {len(alias_entries)}")
print(f"Alias spellings total: {sum(len(a) for a in alias_entries.values())}")