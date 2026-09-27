package com.familyexpense.tracker.data

import android.app.KeyguardManager
import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assume.assumeFalse
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import javax.crypto.spec.SecretKeySpec

/**
 * The parts of the vault that hold regardless of whether this device has a lock
 * screen. The authenticated round trip -- fingerprint, then the key comes back --
 * cannot be driven from a test, because the whole point of the key is that it
 * refuses to work without a person at the phone. That path is checked by hand.
 *
 * What is checked here is the half that fails silently if it ever breaks: that
 * an unprotected phone is never told its key is safe, that a key is never handed
 * to the wrong family, and that forgetting actually forgets.
 */
@RunWith(AndroidJUnit4::class)
class KeyVaultInstrumentedTest {

    private lateinit var context: Context
    private lateinit var vault: KeyVault

    private val key = SecretKeySpec(ByteArray(32) { it.toByte() }, "AES")

    private val deviceIsSecure: Boolean
        get() = (context.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager).isDeviceSecure

    @Before fun setUp() = runBlocking {
        context = ApplicationProvider.getApplicationContext()
        vault = KeyVault(context)
        vault.forget()
    }

    @Test fun aPhoneWithNoLockScreenIsNeverToldTheKeyIsSafe() = runBlocking {
        assumeFalse("needs a phone with no lock screen", deviceIsSecure)
        assertFalse("must not claim to have stored it", vault.remember("fam-1", key))
        assertNull("nothing may be left behind", vault.rememberedFor())
        assertNull(vault.recall("fam-1"))
    }

    @Test fun rememberingRecordsWhichFamilyItWasFor() = runBlocking {
        assumeTrue("needs a phone with a lock screen", deviceIsSecure)
        assertEquals(true, vault.remember("fam-1", key))
        assertEquals("fam-1", vault.rememberedFor())
    }

    @Test fun aKeyIsNeverHandedToADifferentFamily() = runBlocking {
        assumeTrue("needs a phone with a lock screen", deviceIsSecure)
        vault.remember("fam-1", key)
        assertNull("wrong family must get nothing", vault.recall("fam-2"))
        // ...and the mismatch clears the store rather than leaving it to be retried.
        assertNull(vault.rememberedFor())
    }

    @Test fun forgettingLeavesNothingBehind() = runBlocking {
        vault.remember("fam-1", key)
        vault.forget()
        assertNull(vault.rememberedFor())
        assertNull(vault.recall("fam-1"))
    }

    /**
     * The two halves of the guarantee, tested separately, because together they
     * need a finger on a sensor and no test has one.
     *
     * Half one: the wrapping is correct. A key put away comes back byte for byte
     * -- a key that decrypts to almost the right thing decrypts nothing at all.
     * Checked against a vault built without the authentication requirement, under
     * its own Keystore alias, so the real key is untouched.
     */
    @Test fun aWrappedKeyComesBackByteForByte() = runBlocking {
        val unprotected = KeyVault(context, requireAuthentication = false)
        unprotected.forget()

        assertEquals(true, unprotected.remember("fam-1", key))
        val recalled = unprotected.recall("fam-1")

        assertNotNull("the key did not survive being wrapped", recalled)
        assertArrayEquals(key.encoded, recalled!!.encoded)
        unprotected.forget()
    }

    /**
     * Half two: the lock is real. With the production settings the Keystore
     * refuses to unwrap until someone has just authenticated -- which is the
     * entire reason for storing the key at all. If this ever starts returning a
     * key, the family's entries are readable by anyone holding the phone.
     */
    @Test fun anUnauthenticatedRecallGetsNothing() = runBlocking {
        assumeTrue("needs a phone with a lock screen", deviceIsSecure)

        assertEquals(true, vault.remember("fam-1", key))
        // No authentication happens here. On a phone left alone past the
        // validity window, this is the state every cold start begins in.
        Thread.sleep(1_000)

        assertNull("the Keystore handed the key over unauthenticated", vault.recall("fam-1"))
    }
}
