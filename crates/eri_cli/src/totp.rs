//! TOTP (RFC 6238) code generation for the credential vault's `Totp` field.
//!
//! The 2FA **seed** lives in the keystore exactly like a password; eri derives
//! the current 6-digit code **locally** and fills it. The model never sees the
//! seed OR the generated code — same invariant as [`crate::credential_vault`].
//!
//! **No hand-rolled crypto:** the primitive is HMAC-SHA1 from RustCrypto
//! ([`hmac`] + [`sha1`]); base32 decoding is [`data_encoding`]. Only the RFC 4226
//! dynamic-truncation arithmetic (byte selection, not cryptography) lives here.

use anyhow::{Context, Result};
use hmac::{Hmac, Mac};
use sha1::Sha1;

type HmacSha1 = Hmac<Sha1>;

/// The standard authenticator time step (seconds).
pub const DEFAULT_STEP: u64 = 30;
/// The standard authenticator code length.
pub const DEFAULT_DIGITS: u32 = 6;

/// The current TOTP code for a base32 seed (30s step, 6 digits) — what the vault
/// fills for [`CredentialField::Totp`](crate::credential_vault::CredentialField).
pub fn totp_now(seed_base32: &str) -> Result<String> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .context("system clock is before the unix epoch")?
        .as_secs();
    totp_at(seed_base32, now, DEFAULT_STEP, DEFAULT_DIGITS)
}

/// The TOTP code for a base32 seed at a specific unix time. Pure + deterministic
/// so it can be checked against the RFC 6238 test vectors.
pub fn totp_at(seed_base32: &str, unix_seconds: u64, step: u64, digits: u32) -> Result<String> {
    if step == 0 {
        anyhow::bail!("TOTP step must be non-zero");
    }
    let key = decode_seed(seed_base32)?;
    hotp(&key, unix_seconds / step, digits)
}

/// HOTP (RFC 4226 §5.3): HMAC-SHA1 of the big-endian counter, dynamically
/// truncated to `digits` decimal digits (zero-padded).
fn hotp(key: &[u8], counter: u64, digits: u32) -> Result<String> {
    if !(1..=10).contains(&digits) {
        anyhow::bail!("TOTP digits must be 1..=10, got {digits}");
    }
    let mut mac = HmacSha1::new_from_slice(key).context("invalid TOTP key")?;
    mac.update(&counter.to_be_bytes());
    let hs = mac.finalize().into_bytes(); // 20 bytes (SHA-1)
    // Offset = low nibble of the last byte; take 4 bytes there, mask the sign bit.
    let offset = (hs[19] & 0x0f) as usize;
    let bin = (u32::from(hs[offset] & 0x7f) << 24)
        | (u32::from(hs[offset + 1]) << 16)
        | (u32::from(hs[offset + 2]) << 8)
        | u32::from(hs[offset + 3]);
    let modulo = 10u32.pow(digits);
    Ok(format!("{:0width$}", bin % modulo, width = digits as usize))
}

/// Decode a base32 TOTP seed (RFC 4648). Tolerant of how issuers present seeds:
/// lowercase, spaces, and `=` padding are all accepted.
fn decode_seed(seed: &str) -> Result<Vec<u8>> {
    let cleaned: String = seed
        .chars()
        .filter(|c| !c.is_whitespace() && *c != '=')
        .collect::<String>()
        .to_uppercase();
    if cleaned.is_empty() {
        anyhow::bail!("the TOTP seed is empty");
    }
    data_encoding::BASE32_NOPAD
        .decode(cleaned.as_bytes())
        .context("the TOTP seed is not valid base32")
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The RFC 6238 Appendix B reference seed (ASCII "12345678901234567890"),
    /// base32-encoded the way an authenticator app would store it.
    fn rfc_seed() -> String {
        data_encoding::BASE32_NOPAD.encode(b"12345678901234567890")
    }

    #[test]
    fn matches_rfc6238_sha1_test_vectors() {
        let seed = rfc_seed();
        // (unix time, expected 8-digit code) straight from RFC 6238 Appendix B.
        for (t, expected) in [
            (59u64, "94287082"),
            (1111111109, "07081804"),
            (1111111111, "14050471"),
            (1234567890, "89005924"),
            (2000000000, "69279037"),
            (20000000000, "65353130"),
        ] {
            assert_eq!(totp_at(&seed, t, 30, 8).unwrap(), expected, "t={t}");
        }
    }

    #[test]
    fn default_is_six_digits() {
        let code = totp_at(&rfc_seed(), 59, DEFAULT_STEP, DEFAULT_DIGITS).unwrap();
        assert_eq!(code.len(), 6);
        assert!(code.chars().all(|c| c.is_ascii_digit()));
        // The 6-digit code is the last 6 of the 8-digit RFC vector (94287082).
        assert_eq!(code, "287082");
    }

    #[test]
    fn seed_decoding_tolerates_lowercase_spaces_and_padding() {
        // Same seed, presented three sloppy ways → identical code.
        let canonical = totp_at(&rfc_seed(), 59, 30, 8).unwrap();
        let lower = rfc_seed().to_lowercase();
        let spaced = {
            let s = rfc_seed();
            s.as_bytes()
                .chunks(4)
                .map(|c| std::str::from_utf8(c).unwrap())
                .collect::<Vec<_>>()
                .join(" ")
        };
        let padded = format!("{}===", rfc_seed());
        assert_eq!(totp_at(&lower, 59, 30, 8).unwrap(), canonical);
        assert_eq!(totp_at(&spaced, 59, 30, 8).unwrap(), canonical);
        assert_eq!(totp_at(&padded, 59, 30, 8).unwrap(), canonical);
    }

    #[test]
    fn rejects_a_bad_seed() {
        assert!(totp_at("not base32 @#$", 59, 30, 6).is_err());
        assert!(totp_at("   ", 59, 30, 6).is_err());
    }

    #[test]
    fn now_returns_a_six_digit_code() {
        let code = totp_now(&rfc_seed()).unwrap();
        assert_eq!(code.len(), 6);
        assert!(code.chars().all(|c| c.is_ascii_digit()));
    }
}
