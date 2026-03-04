package com.familyexpense.tracker.data

import android.util.Base64
import java.security.MessageDigest
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

class ExpenseCrypto {

    fun encrypt(secret: String?, plainText: String): String {
        if (plainText.isBlank() || secret.isNullOrBlank()) return plainText

        return runCatching {
            val cipher = Cipher.getInstance(TRANSFORMATION)
            val key = deriveKey(secret)
            cipher.init(Cipher.ENCRYPT_MODE, key)
            val iv = cipher.iv
            val encrypted = cipher.doFinal(plainText.toByteArray(Charsets.UTF_8))
            val ivBase64 = Base64.encodeToString(iv, Base64.NO_WRAP)
            val dataBase64 = Base64.encodeToString(encrypted, Base64.NO_WRAP)
            "$PREFIX$ivBase64:$dataBase64"
        }.getOrElse { plainText }
    }

    fun decryptIfEncrypted(secret: String?, value: String?): String? {
        if (value == null || !value.startsWith(PREFIX) || secret.isNullOrBlank()) return value

        return runCatching {
            val payload = value.removePrefix(PREFIX)
            val parts = payload.split(":")
            if (parts.size != 2) return@runCatching value
            val iv = Base64.decode(parts[0], Base64.NO_WRAP)
            val encrypted = Base64.decode(parts[1], Base64.NO_WRAP)

            val cipher = Cipher.getInstance(TRANSFORMATION)
            val key = deriveKey(secret)
            cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, iv))
            String(cipher.doFinal(encrypted), Charsets.UTF_8)
        }.getOrElse { value }
    }

    private fun deriveKey(secret: String): SecretKeySpec {
        val digest = MessageDigest.getInstance("SHA-256").digest(secret.toByteArray(Charsets.UTF_8))
        return SecretKeySpec(digest, "AES")
    }

    companion object {
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
        private const val PREFIX = "enc:v2:"
    }
}
