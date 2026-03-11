# Platform Signing Key

The platform signing key is an **ECDSA P-256** key pair used to seal Trust Envelope evidence packs. When present, the `platformSignature` section of every exported pack contains a signature over the `envelopeHash`, proving the pack was produced by this platform instance and hasn't been modified since.

---

## How It Works

1. On startup, `NodeCryptoService` checks for the `PLATFORM_SIGNING_KEY` env var
2. If found → loads the private key from the base64-encoded PKCS8 DER value
3. If missing → auto-generates a new ephemeral key pair (lost on restart — dev only)
4. When `buildEvidencePack()` runs, it calls `crypto.signWithPlatformKey(envelopeHash)`
5. The signature + public key are embedded in `platformSignature` section of the pack
6. The standalone verifier (`verify-evidence-pack.mjs`) verifies this signature

---

## Generate a New Key

### Option A: Using Node.js (recommended)

```bash
node -e "
const { generateKeyPairSync } = require('crypto');
const kp = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const privDer = kp.privateKey.export({ format: 'der', type: 'pkcs8' });
console.log(privDer.toString('base64'));
"
```

Copy the single base64 line into your `.env`:

```
PLATFORM_SIGNING_KEY=MIGHAgEAMBMGByqGSM49AgEG...
```

### Option B: Using OpenSSL

```bash
# Generate private key (PEM)
openssl ecparam -genkey -name prime256v1 -noout -out platform-key.pem

# Convert to PKCS8 DER, then base64
openssl pkcs8 -topk8 -nocrypt -in platform-key.pem -outform DER | base64 | tr -d '\n'
```

Copy the output into your `.env`.

### Option C: Extract the public key (for auditors)

If you need to share the public key with a bank or auditor so they can verify packs offline:

```bash
# From the private PEM
openssl ec -in platform-key.pem -pubout -outform PEM -out platform-pub.pem

# Or from Node.js
node -e "
const { createPrivateKey } = require('crypto');
const privDer = Buffer.from(process.env.PLATFORM_SIGNING_KEY, 'base64');
const priv = createPrivateKey({ key: privDer, format: 'der', type: 'pkcs8' });
console.log(priv.export({ format: 'pem', type: 'pkcs8' }).toString());
"
```

> **Note:** You don't need to distribute the public key separately — it's embedded in every Trust Envelope inside `platformSignature.publicKey` (base64 SPKI DER). Auditors can verify packs using only the pack file itself.

---

## Environment Variable

| Variable | Format | Required |
|---|---|---|
| `PLATFORM_SIGNING_KEY` | Base64-encoded PKCS8 DER (ECDSA P-256 private key) | No (auto-generates if missing) |

Add to `backend/.env` and/or root `.env`:

```dotenv
PLATFORM_SIGNING_KEY=MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg...
```

---

## Production Considerations

| Concern | Recommendation |
|---|---|
| **Key storage** | Use a KMS (AWS KMS, Azure Key Vault, GCP Cloud KMS) — never commit to git |
| **Key rotation** | Generate a new key periodically; old packs remain verifiable via their embedded public key |
| **Backup** | Store the private key in a secure vault; losing it means new packs get a new key (old packs unaffected) |
| **`.env` in `.gitignore`** | Ensure `.env` is gitignored (it already is in this project) |
| **Ephemeral keys** | Without `PLATFORM_SIGNING_KEY`, a new key is generated on each restart — packs signed with the old key can't be verified against the new key. Acceptable for dev, not production |

---

## Verification

The `verify-evidence-pack.mjs` script automatically checks the platform signature (Section 13):

```bash
node scripts/verify-evidence-pack.mjs evidence-pack.json
```

Output when valid:
```
── Platform Signature & Notarization ───────────────────────
  ℹ Algorithm: ECDSA-P256-SHA256
  ℹ Signed at: 2026-03-09T17:30:00.000Z
  ℹ Signed fields: envelopeHash
  ✓ Platform signature VALID — envelope sealed by issuing platform
```
