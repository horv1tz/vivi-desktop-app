# Code signing and antivirus/SmartScreen warnings

Vivi's release builds are unsigned by default. This page explains what that costs you (Windows
SmartScreen and macOS Gatekeeper warnings, a higher chance of an antivirus false positive), what
you can do about it, and exactly what's already wired up in CI versus what only you can supply —
signing requires a real, paid certificate and Apple account that nobody can generate on your
behalf, ours included.

## The honest version

There is no code change that makes an unsigned Windows `.exe` stop triggering SmartScreen, or an
unsigned macOS app stop triggering Gatekeeper. Both are identity checks: "who vouches for this
binary," not "does this binary look suspicious." The only real fix is signing with a certificate
tied to a verified identity (and, for macOS, Apple's notarization on top of that). Antivirus
heuristics are a separate, softer problem — signing helps there too, but Vivi's own nature (an
agent that moves the mouse, types, and reads the screen) resembles the behavior heuristics use to
flag remote-access tools, so some false-positive risk is structural and never fully goes away no
matter how the code is written. Submitting the specific build for analysis (see below) is the real
lever there, not a code trick.

## What's already wired up (needs only your credentials)

`.github/workflows/build.yml`'s `build` job already reads five repository secrets and configures
electron-builder from them — nothing further needs to change in this repo once you add them:

| Secret | Used for |
|---|---|
| `CSC_LINK` | Windows and macOS signing certificate (base64-encoded `.p12`/`.pfx`, or a URL/path to one) |
| `CSC_KEY_PASSWORD` | That certificate's password |
| `APPLE_ID` | Apple ID email, for macOS notarization |
| `APPLE_APP_SPECIFIC_PASSWORD` | An app-specific password for that Apple ID (not your normal password — generate one at [appleid.apple.com](https://appleid.apple.com), Sign-In and Security → App-Specific Passwords) |
| `APPLE_TEAM_ID` | Your Apple Developer Team ID (Apple Developer account → Membership) |

Add them at **GitHub → this repo → Settings → Secrets and variables → Actions → New repository
secret**. Leave any of them unset and that platform's build stays unsigned, exactly as today —
nothing breaks either way.

`electron-builder.yml`'s `mac.notarize` key is deliberately left **unset** (not `false`):
electron-builder auto-notarizes when `APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID` are
present in the environment and silently skips it when they aren't. An earlier version of this
file hardcoded `notarize: false`, which would have skipped notarization even after adding real
Apple credentials — that's fixed.

## Windows: what to buy

A code signing certificate from any recognized certificate authority (DigiCert, Sectigo, SSL.com,
GlobalSign, and others all sell one). Two kinds matter here:

- **OV (Organization Validation)** — cheaper, works as a plain `.pfx`/`.p12` file, drops straight
  into `CSC_LINK`/`CSC_KEY_PASSWORD` as described above. SmartScreen still shows a warning at
  first; the warning goes away only after the certificate builds up enough reputation (roughly:
  enough people have run the signed installer without reporting it, over some weeks).
- **EV (Extended Validation)** — pricier and requires stricter identity verification, and the
  private key legally can't leave a hardware token or cloud HSM, so it can't be dropped into a
  portable `.pfx` file the way OV can. An EV certificate gets *immediate* SmartScreen trust with
  no reputation-building period, but signing with one in CI needs a cloud signing service (e.g.
  Azure Trusted Signing, DigiCert KeyLocker, SSL.com eSigner) rather than the `CSC_LINK` flow
  above — that's a bigger CI change than this repo currently has wired up, and isn't something to
  set up speculatively before you've chosen a provider.

If you only do one thing here, an OV certificate through the existing `CSC_LINK` flow is the
practical starting point.

## macOS: what to buy

An [Apple Developer Program](https://developer.apple.com/programs/) membership ($99/year). From
it: a **Developer ID Application** certificate (export it as a `.p12` from Keychain Access, same
base64-into-`CSC_LINK` flow as Windows), your Team ID, and an app-specific password for
notarization (see the table above). Notarization is Apple actually scanning the signed app on
their end and stapling an approval ticket to it — Gatekeeper checks for that ticket, not just a
valid signature, so both signing *and* notarization are required to avoid the "can't be opened
because Apple cannot check it for malicious software" dialog.

## Linux

No SmartScreen/Gatekeeper equivalent exists for `.AppImage`/`.deb` — this is specifically a
Windows and macOS cost. GPG-signing a `.deb` repository is a separate, optional concern (only
relevant if you set up an actual apt repository rather than distributing the `.deb` directly) and
isn't wired up here.

## Reducing antivirus false positives directly

Independent of signing:

- **Submit each release build for analysis** at Microsoft's [file submission
  portal](https://www.microsoft.com/en-us/wdsi/filesubmission) if Windows Defender flags it, and
  check [VirusTotal](https://www.virustotal.com) to see the current detection landscape across
  engines before telling users "it's a false positive." This is free, doesn't require a
  certificate, and is the single most effective lever against a specific wrong Defender verdict —
  add it as a step after cutting a release in `docs/RELEASING.md` if Defender flags a build.
- **Signing still matters here too**: an unsigned binary is itself one of the heuristic signals
  antivirus engines weigh, on top of the SmartScreen/Gatekeeper identity check.
- **What won't help**: packing, obfuscating, or otherwise trying to make the binary "look less
  suspicious" to heuristics. That pattern is itself a much stronger malware signal than an
  unsigned Electron app with normal debug symbols and no packer — Vivi's build already avoids it
  (electron-builder's own NSIS/DMG packaging, no additional compression layer), and it should stay
  that way.
