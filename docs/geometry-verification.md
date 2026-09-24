# Keyboard geometry verification

The selectable templates are explicit visual-to-source maps. Their row order
and key tokens were compared with KMonad's published templates at commit
[`30b9705`](https://github.com/kmonad/kmonad/tree/30b9705fb56059483969624d58cad077d5c62300):

- [US ANSI 60%](https://github.com/kmonad/kmonad/blob/30b9705fb56059483969624d58cad077d5c62300/keymap/template/us_ansi_60.kbd)
- [US ANSI TKL](https://github.com/kmonad/kmonad/blob/30b9705fb56059483969624d58cad077d5c62300/keymap/template/us_ansi_tkl.kbd)
- [Split 94 source order](https://github.com/kmonad/kmonad/blob/30b9705fb56059483969624d58cad077d5c62300/keymap/template/freestyle2.kbd) (Kinesis Freestyle 2 convention)
- [ISO 60%](https://github.com/kmonad/kmonad/blob/30b9705fb56059483969624d58cad077d5c62300/keymap/template/iso_60.kbd)
- [ISO TKL](https://github.com/kmonad/kmonad/blob/30b9705fb56059483969624d58cad077d5c62300/keymap/template/iso_tkl.kbd)
- [US ANSI 100%](https://github.com/kmonad/kmonad/blob/30b9705fb56059483969624d58cad077d5c62300/keymap/template/us_ansi_100.kbd)
- [ISO 100%](https://github.com/kmonad/kmonad/blob/30b9705fb56059483969624d58cad077d5c62300/keymap/template/iso_100.kbd)
- [ISO Laptop 93](https://github.com/kmonad/kmonad/blob/30b9705fb56059483969624d58cad077d5c62300/keymap/template/thinkpad_x220_iso.kbd) (US `defsrc`)
- [ISO Laptop 87](https://github.com/kmonad/kmonad/blob/30b9705fb56059483969624d58cad077d5c62300/keymap/template/thinkpad_T430_iso.kbd) (US `defsrc`)

Both laptop templates are layout conventions, not model bindings. The X220
source produces a 93-key US `defsrc` carrying the 102nd key, an ESC/media row,
and the SysRq-cluster; the T430 source is 87 keys and — despite its "ISO"
filename — has **no 102nd key**. The editor never infers either from a device
name.

`internal/geometry/catalog_test.go` checks the ANSI 60% source sequence and the
TKL/Freestyle/ISO/full-size/laptop source rows against those references. It also
checks every selectable template for complete key IDs, labels and source tokens,
unique visual IDs, nondecreasing visual rows, and exact positional agreement
between drawn keys and the profile's `geometry.source_keys`.

`internal/geometry/kmonad_vocabulary.go` is the verified token vocabulary: a
table generated from
[`src/KMonad/Keyboard/Keycode.hs`](https://github.com/kmonad/kmonad/blob/30b9705fb56059483969624d58cad077d5c62300/src/KMonad/Keyboard/Keycode.hs)
at the pinned commit, covering every `Key*` constructor and its alias spellings.
It resolves tokens such as `lsgt`, `102d`, `ssrq`, `slck`, `pause`, the `kp*`
numpad cluster, and the laptop tokens `mute`, `vold`, `volu`, `wkup`, `cmps`,
and `sys`, and it backs the compiler: every defsrc token and emitted
single-key behavior must be one of its spellings.

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
