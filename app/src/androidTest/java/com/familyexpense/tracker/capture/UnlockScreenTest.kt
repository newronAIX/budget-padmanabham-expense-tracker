package com.familyexpense.tracker.capture

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsOn
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * What the family actually meets when they open the app.
 *
 * The offer to remember the password must never appear on a phone with no lock
 * screen -- there it would be a promise of protection that does not exist.
 */
class UnlockScreenTest {

    @get:Rule val compose = createComposeRule()

    @Test fun aPhoneWithALockScreenIsOfferedTheShortcut() {
        var got: Pair<String, Boolean>? = null
        compose.setContent {
            UnlockScreen(
                busy = false, canUseDeviceLock = false, canRememberKey = true,
                onUnlock = { p, r -> got = p to r },
                onUseDeviceLock = {}, onUsePasswordInstead = {}
            )
        }

        compose.onNodeWithText("Remember on this phone").assertIsDisplayed()
        compose.onNodeWithText("Family password").performTextInput("hunter2")
        compose.onNodeWithText("Unlock").performClick()

        assertEquals("hunter2" to true, got)
    }

    @Test fun aPhoneWithNoLockScreenIsNotOfferedIt() {
        var got: Pair<String, Boolean>? = null
        compose.setContent {
            UnlockScreen(
                busy = false, canUseDeviceLock = false, canRememberKey = false,
                onUnlock = { p, r -> got = p to r },
                onUseDeviceLock = {}, onUsePasswordInstead = {}
            )
        }

        compose.onNodeWithText("Remember on this phone").assertDoesNotExist()
        compose.onNodeWithText("Family password").performTextInput("hunter2")
        compose.onNodeWithText("Unlock").performClick()

        // ...and nothing is stored behind their back.
        assertEquals("hunter2" to false, got)
    }

    @Test fun aRememberedKeyReplacesTheKeyboardWithTheLockScreen() {
        var prompted = false
        compose.setContent {
            UnlockScreen(
                busy = false, canUseDeviceLock = true, canRememberKey = true,
                onUnlock = { _, _ -> }, onUseDeviceLock = { prompted = true },
                onUsePasswordInstead = {}
            )
        }

        compose.onNodeWithText("Welcome back").assertIsDisplayed()
        compose.onNodeWithText("Family password").assertDoesNotExist()
        compose.onNodeWithText("Unlock").performClick()
        assertTrue("the lock screen was never asked for", prompted)
    }

    /** A fingerprint that will not read must never be a locked door. */
    @Test fun thePasswordIsAlwaysStillAWayIn() {
        var fellBack = false
        compose.setContent {
            UnlockScreen(
                busy = false, canUseDeviceLock = true, canRememberKey = true,
                onUnlock = { _, _ -> }, onUseDeviceLock = {},
                onUsePasswordInstead = { fellBack = true }
            )
        }

        compose.onNodeWithText("Type the family password instead").performClick()
        assertTrue(fellBack)
    }
}
