package com.familyexpense.tracker.capture

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import com.familyexpense.tracker.backend.Category
import com.familyexpense.tracker.backend.Expense
import com.familyexpense.tracker.update.LatestBuild
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * The banner is the whole update mechanism as far as the family is concerned.
 * If it does not appear, or cannot be dismissed, or leaves them stuck mid
 * download, there is no update mechanism.
 */
class UpdateBannerTest {

    @get:Rule val compose = createComposeRule()

    private val build = LatestBuild(
        versionCode = 3, versionName = "1.2",
        url = "https://example.test/app.apk",
        notes = "You can now move between your expenses and the review list."
    )

    private fun ready(update: LatestBuild?, stage: UpdateStage = UpdateStage.OFFERED) = UiState(
        stage = Stage.READY,
        update = update,
        updateStage = stage,
        expenses = listOf(Expense("e1", "Petrol", 500.0, "2026-09-26", "p1", "c1", null)),
        categories = listOf(Category("c1", "Travel", "EXPENSE", "#000000"))
    )

    @Test fun theNotesAreWhatTheFamilyReads() {
        compose.setContent { CaptureScaffold(ready(build), CaptureActions()) }

        compose.onNodeWithText("A newer version is ready").assertIsDisplayed()
        compose.onNodeWithText(build.notes).assertIsDisplayed()
    }

    @Test fun thereIsNoBannerWhenThereIsNoUpdate() {
        compose.setContent { CaptureScaffold(ready(null), CaptureActions()) }

        compose.onNodeWithText("A newer version is ready").assertDoesNotExist()
        compose.onNodeWithText("Recent expenses").assertIsDisplayed()
    }

    @Test fun updateStartsTheDownload() {
        var started = false
        compose.setContent {
            CaptureScaffold(ready(build), CaptureActions(startUpdate = { started = true }))
        }
        compose.onNodeWithText("Update").performClick()
        assertTrue(started)
    }

    /** Nobody should be nagged. "Not now" has to actually mean not now. */
    @Test fun notNowDismissesIt() {
        var dismissed = false
        compose.setContent {
            CaptureScaffold(ready(build), CaptureActions(dismissUpdate = { dismissed = true }))
        }
        compose.onNodeWithText("Not now").performClick()
        assertTrue(dismissed)
    }

    @Test fun aDownloadInFlightCannotBeStartedTwice() {
        compose.setContent {
            CaptureScaffold(ready(build, UpdateStage.DOWNLOADING), CaptureActions())
        }
        compose.onNodeWithText("Downloading…").assertIsNotEnabled()
    }

    /**
     * Android 8 put installing behind a Settings switch. The banner has to say so,
     * and stay tappable, or the person is simply stuck.
     */
    @Test fun theSettingsDetourIsExplainedAndRecoverable() {
        compose.setContent {
            CaptureScaffold(ready(build, UpdateStage.NEEDS_PERMISSION), CaptureActions())
        }
        compose.onNodeWithText("Android needs your permission first", substring = true).assertIsDisplayed()
        compose.onNodeWithText("Update").assertIsEnabled()
    }

    @Test fun aFailedDownloadSaysSoAndCanBeRetried() {
        compose.setContent {
            CaptureScaffold(ready(build, UpdateStage.FAILED), CaptureActions())
        }
        compose.onNodeWithText("That download did not finish. Tap Update to try again.").assertIsDisplayed()
        compose.onNodeWithText("Update").assertIsEnabled()
    }
}
