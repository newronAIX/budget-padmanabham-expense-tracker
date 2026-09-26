package com.familyexpense.tracker.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Base64

/**
 * Cross-language vectors: these were produced in a real browser by WebCrypto,
 * using the exact parameters in budget/app.js. If Android and the web ever drift
 * apart, these fail -- which is the whole point, because the previous Android
 * crypto silently derived a different key and could not read a single row the
 * web app had written.
 */
class FamilyCryptoTest {

    private val salt = "AQIDBAUGBwgJCgsMDQ4PEA=="
    private val password = "మా ఇంటి password 42!"
    private val expectedRawKey = "W0APt6/Nu8xxWNPyOCNMzGh92NFy1nX5W02BmUbiACo="
    private val expectedFingerprint = "C9I7Y6g99QOJk1tatm2KLyVp5u2XT4GmctnLzpH11WI="
    private val envelopeFromWeb =
        "v1.4HyZNOijDfoxlMeP.uFPV712MKRJ0dX+QVsjQKDbqQImxGCc0KnJnLVhnnO33ggwm93AmOvBU3JGFaJN1wk3P54zOJQs43sNUsUN5dPdidrfVeW8m/bBbVM0BR6AQ7qPSC2jWNayhM8P/civJ"
    private val checkFromWeb =
        "v1.M+kupe/OkOQfqecx.GCdiquFH4csaFqHFmdxTu2fD3AENEkQrF+4qbEplyueD8Yrblrdn3x1ZF4ZxAiSP8QcK3VFGDI3VlA2c"
    private val expectedJson =
        """{"title":"Groceries ₹1,234","amount":1234.56,"note":"తెలుగు note"}"""

    /**
     * The strongest single assertion here. If PBKDF2 produces the same bytes,
     * everything downstream follows; if it does not, nothing can.
     */
    @Test fun derivesTheSameKeyAsTheWebApp() {
        val key = FamilyCrypto.deriveKey(password, salt)
        assertEquals(expectedRawKey, Base64.getEncoder().encodeToString(key.encoded))
    }

    @Test fun decryptsAPayloadWrittenByTheWebApp() {
        val key = FamilyCrypto.deriveKey(password, salt)
        assertEquals(expectedJson, FamilyCrypto.decrypt(key, envelopeFromWeb))
    }

    @Test fun computesTheSameJoinFingerprint() {
        val key = FamilyCrypto.deriveKey(password, salt)
        assertEquals(expectedFingerprint, FamilyCrypto.fingerprint(key))
    }

    /** The sentinel the web app stores in budget_families.encryption_check. */
    @Test fun verifiesAgainstTheWebAppsEncryptionCheck() {
        assertNotNull(FamilyCrypto.verify(password, salt, checkFromWeb))
    }

    @Test fun wrongPasswordFailsVerification() {
        assertNull(FamilyCrypto.verify("not the password", salt, checkFromWeb))
    }

    @Test fun wrongPasswordCannotDecrypt() {
        val wrong = FamilyCrypto.deriveKey("wrong", salt)
        assertNull(FamilyCrypto.decryptOrNull(wrong, envelopeFromWeb))
    }

    /** Our own output must be readable by us, and shaped like the web's. */
    @Test fun roundTripsAndEmitsTheWebEnvelopeFormat() {
        val key = FamilyCrypto.deriveKey(password, salt)
        val text = """{"title":"చాయ్","amount":15}"""
        val envelope = FamilyCrypto.encrypt(key, text)
        assertTrue("must be v1.<iv>.<data>", Regex("""^v1\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$""").matches(envelope))
        assertEquals(3, envelope.split(".").size)
        // 12-byte IV, base64 of 12 bytes is 16 chars.
        assertEquals(16, envelope.split(".")[1].length)
        assertEquals(text, FamilyCrypto.decrypt(key, envelope))
    }

    /** A fresh salt must not collide, or two families could share a key. */
    @Test fun saltsAreRandomAnd16Bytes() {
        val a = FamilyCrypto.newSaltBase64()
        val b = FamilyCrypto.newSaltBase64()
        assertTrue(a != b)
        assertEquals(16, Base64.getDecoder().decode(a).size)
    }

    @Test fun newFamilyCheckVerifiesWithItsOwnPassword() {
        val s = FamilyCrypto.newSaltBase64()
        val key = FamilyCrypto.deriveKey("a brand new family password", s)
        val check = FamilyCrypto.newEncryptionCheck(key)
        assertNotNull(FamilyCrypto.verify("a brand new family password", s, check))
        assertNull(FamilyCrypto.verify("different", s, check))
    }

    @Test fun malformedEnvelopesAreRejectedNotGuessed() {
        val key = FamilyCrypto.deriveKey(password, salt)
        assertNull(FamilyCrypto.decryptOrNull(key, "enc:v2:oldformat:data"))
        assertNull(FamilyCrypto.decryptOrNull(key, "v1.onlytwo"))
        assertNull(FamilyCrypto.decryptOrNull(key, ""))
        assertNull(FamilyCrypto.decryptOrNull(null, envelopeFromWeb))
    }
}
