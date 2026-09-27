package com.familyexpense.tracker

import android.content.Intent
import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.fragment.app.FragmentActivity
import com.familyexpense.tracker.capture.CaptureApp
import com.familyexpense.tracker.capture.CaptureViewModel
import com.familyexpense.tracker.ui.theme.FamilyExpenseTheme

/**
 * A FragmentActivity rather than a ComponentActivity: BiometricPrompt hosts
 * itself in a fragment, and that is what stands between a saved family key and
 * whoever is holding the phone.
 */
class MainActivity : FragmentActivity() {

    private val vm: CaptureViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Cold start via the OAuth redirect.
        vm.onRedirect(intent?.data)
        setContent {
            FamilyExpenseTheme { CaptureApp(vm, this) }
        }
    }

    /**
     * The activity is singleTask, so returning from the sign-in browser tab
     * delivers the redirect here rather than through onCreate.
     */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        vm.onRedirect(intent.data)
    }
}
