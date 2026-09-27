package com.familyexpense.tracker.data

import android.app.KeyguardManager
import android.content.Context
import android.util.Log
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.first
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PublicKey
import java.security.spec.MGF1ParameterSpec
import java.security.spec.X509EncodedKeySpec
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.SecretKey
import javax.crypto.spec.OAEPParameterSpec
import javax.crypto.spec.PSource
import javax.crypto.spec.SecretKeySpec

private val Context.vaultStore by preferencesDataStore("family_key_vault")

/**
 * Keeps the family key on the phone so it is typed once rather than every time
 * the app is opened, and puts the phone's own lock in front of it.
 *
 * The key never sits on disk in the clear. It is wrapped by an RSA key that
 * lives inside the Android Keystore -- in hardware where the device has a secure
 * element -- created with setUserAuthenticationRequired, so the private half
 * cannot be used until the person has just proved who they are with a
 * fingerprint or the phone's PIN.
 *
 * RSA rather than AES for one practical reason: with an auth-gated AES key,
 * *storing* the family key would prompt for a fingerprint too. With RSA the
 * public half wraps freely, so remembering is silent and only recall asks.
 *
 * Two failure modes are normal rather than exceptional, and both are handled by
 * forgetting and asking for the password again:
 *  - the person removes their screen lock, or adds a fingerprint. Android
 *    permanently invalidates the key, which is the whole point of the guarantee.
 *  - the phone has no lock screen at all. Then there is nothing to hide behind,
 *    so the app does not offer to remember.
 */
class KeyVault internal constructor(
    private val context: Context,
    /**
     * Always true in the app. Tests set it false to check that the wrapping
     * itself round trips byte for byte, which is otherwise hidden behind a
     * prompt no test can answer. The unprotected variant is generated under its
     * own alias, so it can never be mistaken for, or overwrite, the real key.
     */
    private val requireAuthentication: Boolean = true
) {

    private val alias = if (requireAuthentication) ALIAS else ALIAS_UNPROTECTED

    private val wrappedKey = stringPreferencesKey("wrapped_family_key")
    private val forFamily = stringPreferencesKey("family_id")

    /**
     * No lock screen means no protection to offer. Storing the key anyway would
     * be a worse deal than the web app, dressed up as a better one.
     */
    fun deviceHasLock(): Boolean =
        (context.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager).isDeviceSecure

    suspend fun rememberedFor(): String? = context.vaultStore.data.first()[forFamily]

    suspend fun remember(familyId: String, key: SecretKey): Boolean {
        if (requireAuthentication && !deviceHasLock()) return false
        return runCatching {
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.ENCRYPT_MODE, wrappingPublicKey(), oaep())
            val wrapped = cipher.doFinal(key.encoded)
            context.vaultStore.edit {
                it[wrappedKey] = Base64.getEncoder().encodeToString(wrapped)
                it[forFamily] = familyId
            }
            true
        }.getOrElse {
            forget()
            false
        }
    }

    /**
     * Call only after the person has authenticated. Returns null when there is
     * nothing stored, when it belongs to a different family, or when Android has
     * invalidated the wrapping key -- in every one of those the caller should
     * fall back to asking for the family password.
     */
    suspend fun recall(familyId: String): SecretKey? {
        val prefs = context.vaultStore.data.first()
        // Both of these are ordinary states, not faults: nothing saved yet, or
        // saved for a family this account no longer belongs to.
        val blob = prefs[wrappedKey] ?: return null
        if (prefs[forFamily] != familyId) { forget(); return null }

        val entry = runCatching { keyStore().getEntry(alias, null) }
            .getOrNull() as? KeyStore.PrivateKeyEntry ?: return null
        return runCatching {
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, entry.privateKey, oaep())
            SecretKeySpec(cipher.doFinal(Base64.getDecoder().decode(blob)), "AES") as SecretKey
        }.getOrElse { e ->
            // The type only -- never the blob, the key, or anything derived
            // from either. UserNotAuthenticatedException here is expected and
            // simply means the prompt has not been answered yet.
            Log.w(TAG, "recall failed: ${e.javaClass.simpleName}")
            // The lock screen changed under us. Nothing recoverable here -- the
            // stored bytes are permanently unreadable, so stop pretending we have them.
            if (e is KeyPermanentlyInvalidatedException) forget()
            null
        }
    }

    suspend fun forget() {
        runCatching { keyStore().deleteEntry(alias) }
        context.vaultStore.edit { it.clear() }
    }

    private fun keyStore() = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

    /**
     * Spelled out because the two sides disagree by default, silently.
     *
     * "RSA/ECB/OAEPWithSHA-256AndMGF1Padding" reads as though both the digest
     * and the mask use SHA-256, and the ordinary JCE provider does exactly that.
     * AndroidKeyStore does not: it uses SHA-256 for the digest and SHA-1 for the
     * mask. Wrapping happens outside the Keystore and unwrapping inside it, so
     * leaving this to the defaults produces a ciphertext the private key cannot
     * read -- and the failure surfaces as IllegalBlockSizeException, which says
     * nothing about padding at all. Passing the parameters on both calls is what
     * makes the two agree.
     */
    private fun oaep() = OAEPParameterSpec(
        "SHA-256", "MGF1", MGF1ParameterSpec.SHA1, PSource.PSpecified.DEFAULT
    )

    /**
     * The public key read back from the Keystore carries the same authentication
     * requirement as the private one, and Cipher.init honours it -- so wrapping
     * would prompt for a fingerprint. Rebuilding the key from its encoded form
     * strips the restriction, which is safe: a public key is public, and the
     * restriction that matters stays on the private half.
     */
    private fun wrappingPublicKey(): PublicKey {
        val ks = keyStore()
        val existing = ks.getCertificate(alias)?.publicKey ?: generateWrappingKey()
        return KeyFactory.getInstance(existing.algorithm)
            .generatePublic(X509EncodedKeySpec(existing.encoded))
    }

    private fun generateWrappingKey(): PublicKey {
        val spec = KeyGenParameterSpec.Builder(
            alias,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
        )
            .setDigests(KeyProperties.DIGEST_SHA256, KeyProperties.DIGEST_SHA1)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_RSA_OAEP)
            .setKeySize(2048)
            .apply {
                if (requireAuthentication) {
                    setUserAuthenticationRequired(true)
                    // A short window, refreshed by the unlock prompt immediately
                    // before recall. Long enough for a slow phone, too short to
                    // leave the key usable after the person puts it down.
                    setUserAuthenticationValidityDurationSeconds(AUTH_VALID_SECONDS)
                }
            }
            .build()
        val generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_RSA, "AndroidKeyStore")
        generator.initialize(spec)
        return generator.generateKeyPair().public
    }

    private companion object {
        const val TAG = "KeyVault"
        const val ALIAS = "budget-family-key-wrap-v1"
        const val ALIAS_UNPROTECTED = "budget-family-key-wrap-test-only"
        const val TRANSFORMATION = "RSA/ECB/OAEPWithSHA-256AndMGF1Padding"
        const val AUTH_VALID_SECONDS = 20
    }
}
