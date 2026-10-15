# TODO

Open items for Nova Helper. Check these off as they land; keep the list short and
honest — no wishlist items pretending to be planned work.

## Voice app

- [ ] **Verify device-following with a real headset/earphones.** The app re-binds
      the mic and speaker when the default audio device changes, but on the
      build machine only one capture and one render device were enumerated, so
      this path is code-verified only. Plug in a headset, watch
      `~/.nova/voice.log`, and confirm `Mic:` / `Speaker:` in the window update.
- [ ] **Real-world recognition pass.** Talk to the running app and check:
      does it understand normal speech, and does the spoken "Sorry, I didn't
      catch that" / error feedback feel right (not too chatty)?
- [ ] **Tune the noise floor if needed.** Currently `CONF_FLOOR = 0.55` plus a
      "2 words or a command word" rule. If genuine commands get dropped, lower
      the floor; if ambient audio still slips through, raise it.

## Packaging

- [ ] **Start-menu / desktop shortcut** for `voice\Start Nova Voice.cmd`
      (currently launched by hand or via `npm run voice`).
- [ ] **Decide on distribution** — nothing is published yet. No npm publish, no
      installer, and no remote configured (`git remote -v` is empty).
- [ ] **Push to a remote** once the user is happy with the local result.

## Known limitations

- Vision (`see_screen`) is **not** registered — the gateway rejects image
  data-URIs. Revisit if the gateway gains support.
- Voice mode **refuses high-risk tools** (delete/kill/sleep/...) by design
  (`approveUpTo: 'medium'`, `confirmTimeoutMs: 0`). Do destructive work in a text
  session where the confirm flow can ask properly.
- All `.ps1` / `.cmd` files must stay **pure ASCII** — PowerShell 5.1 reads
  no-BOM files as ANSI and turns non-ASCII bytes into mojibake in the UI.
