# Keyboard geometry verification

The selectable templates are explicit visual-to-source maps. Their row order
and key tokens were compared with KMonad's published templates at commit
[`30b9705`](https://github.com/kmonad/kmonad/tree/30b9705fb56059483969624d58cad077d5c62300):

- [US ANSI 60%](https://github.com/kmonad/kmonad/blob/30b9705fb56059483969624d58cad077d5c62300/keymap/template/us_ansi_60.kbd)
- [US ANSI TKL](https://github.com/kmonad/kmonad/blob/30b9705fb56059483969624d58cad077d5c62300/keymap/template/us_ansi_tkl.kbd)
- [Kinesis Freestyle 2](https://github.com/kmonad/kmonad/blob/30b9705fb56059483969624d58cad077d5c62300/keymap/template/freestyle2.kbd)

`internal/geometry/catalog_test.go` checks the ANSI 60% source sequence and the
TKL/Freestyle source rows against those references. It also checks every
selectable template for complete key IDs, labels and source tokens, unique
visual IDs, nondecreasing visual rows, and exact positional agreement between
drawn keys and the profile's `geometry.source_keys`.

The ANSI 60% reference has `grv` at its first position and does not include an
Escape position. The original KeyboarDeer catalog incorrectly put `esc` there;
the catalog now uses `grv`, and profile-store migration 3 updates legacy source
references and assignments together. The geometry ID is versioned so portable
imports and new drafts use the corrected map.

The Kinesis template intentionally repeats source tokens (`spc`, `home`, and
`del`) where its published source does. Those physical positions therefore
share one editor assignment by KMonad source-key semantics. The GUI never
selects a template from a device name. This verification is against KMonad's
source templates; actual Linux device identification/hotplug and continued
runtime supervision are covered separately by TEST-04.
