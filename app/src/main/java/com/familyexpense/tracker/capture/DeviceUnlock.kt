package com.familyexpense.tracker.capture

import android.content.Context
import android.os.Build
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG
import androidx.biometric.BiometricManager.Authenticators.DEVICE_CREDENTIAL
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity

/**
 * The phone's own lock, used as the gate in front of the remembered family key.
 *
 * Which authenticators may be offered is not a preference, it is a platform
 * constraint: combining a fingerprint with the PIN fallback in one prompt is
 * only supported from Android 11. Below that, asking for both throws, so the
 * prompt offers the fingerprint and sends everyone else back to the password.
 */
object DeviceUnlock {

    private val authenticators: Int
        get() = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            BIOMETRIC_STRONG or DEVICE_CREDENTIAL
        } else {
            BIOMETRIC_STRONG
        }

    fun isAvailable(context: Context): Boolean =
        BiometricManager.from(context).canAuthenticate(authenticators) ==
            BiometricManager.BIOMETRIC_SUCCESS

    fun prompt(
        activity: FragmentActivity,
        onSuccess: () -> Unit,
        onUsePassword: () -> Unit
    ) {
        val prompt = BiometricPrompt(
            activity,
            ContextCompat.getMainExecutor(activity),
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) =
                    onSuccess()

                /**
                 * A failed fingerprint is not an error -- the prompt handles its
                 * own retries. This fires when the person gives up or the sensor
                 * locks out, and either way the password is the way through.
                 */
                override fun onAuthenticationError(code: Int, message: CharSequence) = onUsePassword()
            }
        )

        val info = BiometricPrompt.PromptInfo.Builder()
            .setTitle("Unlock your family's entries")
            .setSubtitle("Use the same fingerprint or PIN that unlocks this phone")
            .setAllowedAuthenticators(authenticators)
            .apply {
                // A negative button is required when the PIN is not part of the
                // prompt, and forbidden when it is.
                if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
                    setNegativeButtonText("Use family password")
                }
            }
            .build()

        prompt.authenticate(info)
    }
}
