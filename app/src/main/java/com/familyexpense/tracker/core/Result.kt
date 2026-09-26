package com.familyexpense.tracker.core

/** A failure the user should see, separated from one only a developer cares about. */
sealed interface AppError {
    val message: String

    /** Shown verbatim. Written for a family member, not an engineer. */
    data class Message(override val message: String) : AppError
    data object Offline : AppError {
        override val message = "No internet connection. Your entries are safe; try again when you are back online."
    }
    data object SignedOut : AppError {
        override val message = "Please sign in again."
    }
    data object Locked : AppError {
        override val message = "Enter the family password to see your family's entries."
    }
}
