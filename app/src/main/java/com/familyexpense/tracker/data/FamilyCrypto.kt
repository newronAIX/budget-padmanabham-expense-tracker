package com.familyexpense.tracker.data

import javax.crypto.Cipher
import javax.crypto.SecretKey
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64

/**
 * The family encryption scheme, byte-compatible with the web app.
 *
 * This REPLACES ExpenseCrypto, which derived its key as a bare SHA-256 of the
 * password with no salt and no iterations, and wrapped output as
 * "enc:v2:<iv>:<data>". The web app derives via PBKDF2 and writes
 * "v1.<iv>.<data>". Same password, completely different key -- so the old
 * Android app could not read a single row the web app wrote, despite pointing at
 * the same database. Every parameter below is therefore fixed by the web app and
 * must not be "improved" independently:
 *
 *   PBKDF2WithHmacSHA256, 250_000 iterations, 256-bit key
 *   AES/GCM/NoPadding, 12-byte IV, 128-bit tag
 *   format: v1.<base64 iv>.<base64 ciphertext||tag>   (NO_WRAP base64)
 *
 * Java's GCM ciphertext already carries the tag appended, which is what
 * WebCrypto produces too, so the two line up without extra handling.
 */
object FamilyCrypto {

    private const val ITERATIONS = 250_000
    private const val KEY_BITS = 256
    private const val IV_BYTES = 12
    private const val TAG_BITS = 128
    private const val PREFIX = "v1"

    /** Must match KEY_CHECK_TEXT in the web app. */
    private const val KEY_CHECK_TEXT = "budget-padmanabham-family-key-v1"
    /** Must match KEY_FINGERPRINT_CONTEXT in the web app. */
    private const val FINGERPRINT_CONTEXT = "budget-join-v1"

    private val random = SecureRandom()

    // java.util.Base64, not android.util.Base64: it exists from API 26 (our
    // minSdk) and, unlike the Android one, is real on the JVM -- so this class
    // is unit-testable without Robolectric. It never line-wraps, matching the
    // web app's NO_WRAP output.
    private val encoder: Base64.Encoder = Base64.getEncoder()
    private val decoder: Base64.Decoder = Base64.getDecoder()

    fun deriveKey(passphrase: String, saltBase64: String): SecretKey {
        val salt = decoder.decode(saltBase64)
        val spec = PBEKeySpec(passphrase.toCharArray(), salt, ITERATIONS, KEY_BITS)
        val factory = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
        return SecretKeySpec(factory.generateSecret(spec).encoded, "AES")
    }

    fun encrypt(key: SecretKey, plaintext: String): String {
        val iv = ByteArray(IV_BYTES).also(random::nextBytes)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key, GCMParameterSpec(TAG_BITS, iv))
        val ct = cipher.doFinal(plaintext.toByteArray(Charsets.UTF_8))
        return "$PREFIX.${b64(iv)}.${b64(ct)}"
    }

    /** @throws IllegalArgumentException on a malformed envelope, or AEADBadTagException on a wrong key. */
    fun decrypt(key: SecretKey, envelope: String): String {
        val parts = envelope.split(".")
        require(parts.size == 3 && parts[0] == PREFIX) { "Unsupported encrypted format" }
        val iv = decoder.decode(parts[1])
        val ct = decoder.decode(parts[2])
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(TAG_BITS, iv))
        return String(cipher.doFinal(ct), Charsets.UTF_8)
    }

    fun decryptOrNull(key: SecretKey?, envelope: String?): String? {
        if (key == null || envelope.isNullOrBlank()) return null
        return runCatching { decrypt(key, envelope) }.getOrNull()
    }

    /**
     * Confirms the password is right before anything is written, by decrypting
     * the sentinel the web app stores in budget_families.encryption_check.
     */
    fun verify(passphrase: String, saltBase64: String, encryptionCheck: String): SecretKey? {
        val key = runCatching { deriveKey(passphrase, saltBase64) }.getOrNull() ?: return null
        val plain = decryptOrNull(key, encryptionCheck) ?: return null
        // The web app stores {"check": "<KEY_CHECK_TEXT>"}; compare on the value
        // rather than parsing JSON, so key order or spacing cannot matter.
        return if (plain.contains(KEY_CHECK_TEXT)) key else null
    }

    /**
     * SHA-256("budget-join-v1" || rawKey), base64. Proves knowledge of the
     * password to join_budget_family without the server ever seeing it.
     */
    fun fingerprint(key: SecretKey): String {
        val context = FINGERPRINT_CONTEXT.toByteArray(Charsets.UTF_8)
        val raw = key.encoded
        val input = ByteArray(context.size + raw.size)
        System.arraycopy(context, 0, input, 0, context.size)
        System.arraycopy(raw, 0, input, context.size, raw.size)
        return b64(MessageDigest.getInstance("SHA-256").digest(input))
    }

    fun newSaltBase64(): String = b64(ByteArray(16).also(random::nextBytes))

    /** The sentinel a newly created family stores, so other devices can verify. */
    fun newEncryptionCheck(key: SecretKey): String =
        encrypt(key, """{"check":"$KEY_CHECK_TEXT"}""")

    private fun b64(bytes: ByteArray): String = encoder.encodeToString(bytes)
}
