package com.familyexpense.tracker.core

import javax.crypto.SecretKey

/**
 * Everything the app needs to be "signed in and unlocked".
 *
 * [familyKey] is held in memory only. It is the key to every amount this family
 * has ever recorded, so it is deliberately NOT persisted anywhere on the device;
 * the user re-enters the family password after the process dies. The web app
 * caches it in localStorage for convenience -- that is the weakest point of its
 * threat model, and there is no reason to copy it here.
 */
data class Session(
    val accessToken: String,
    val refreshToken: String,
    val userId: String,
    val email: String?,
    val familyId: String? = null,
    val familyKey: SecretKey? = null,
    val isOwner: Boolean = false
) {
    val isUnlocked: Boolean get() = familyId != null && familyKey != null
}
