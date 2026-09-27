package com.familyexpense.tracker.update

import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.engine.mock.respondError
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import io.ktor.http.HttpHeaders
import io.ktor.serialization.kotlinx.json.json
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * A sideloaded app finds out about new builds by asking the website. The two
 * things that must hold: it offers an update only when there genuinely is one,
 * and a website that is down, slow or misconfigured is invisible to the family.
 */
class UpdateCheckerTest {

    private val site = "https://budget-padmanabham.vercel.app"

    private fun checkerReturning(
        body: String,
        status: HttpStatusCode = HttpStatusCode.OK,
        installed: Int = 2
    ): UpdateChecker {
        val engine = MockEngine {
            respond(
                content = body,
                status = status,
                headers = headersOf(HttpHeaders.ContentType, ContentType.Application.Json.toString())
            )
        }
        val http = HttpClient(engine) {
            install(ContentNegotiation) { json(Json { ignoreUnknownKeys = true }) }
        }
        return UpdateChecker(http, site, installed)
    }

    private fun manifest(code: Int, url: String = "/download/BudgetPadmanabham.apk") =
        """{"versionCode":$code,"versionName":"1.$code","url":"$url","notes":"Fixes"}"""

    @Test fun aNewerBuildIsOffered() = runTest {
        val latest = checkerReturning(manifest(3)).check()
        assertEquals(3, latest?.versionCode)
        assertEquals("Fixes", latest?.notes)
    }

    @Test fun theSameBuildIsNotOffered() = runTest {
        assertNull(checkerReturning(manifest(2)).check())
    }

    /** A rolled-back release must not push the family backwards. */
    @Test fun anOlderBuildIsNotOffered() = runTest {
        assertNull(checkerReturning(manifest(1)).check())
    }

    @Test fun aSiteRelativeUrlIsResolvedAgainstTheSite() = runTest {
        val latest = checkerReturning(manifest(3)).check()
        assertEquals("$site/download/BudgetPadmanabham.apk", latest?.url)
    }

    @Test fun anAbsoluteUrlIsLeftAlone() = runTest {
        val url = "https://github.com/x/y/releases/download/v3/app.apk"
        val latest = checkerReturning(manifest(3, url)).check()
        assertEquals(url, latest?.url)
    }

    @Test fun aBrokenSiteIsSilent() = runTest {
        val engine = MockEngine { respondError(HttpStatusCode.NotFound) }
        val http = HttpClient(engine) {
            install(ContentNegotiation) { json(Json { ignoreUnknownKeys = true }) }
        }
        assertNull(UpdateChecker(http, site, 2).check())
    }

    /** Someone edits the JSON by hand and breaks it. The family should not see a crash. */
    @Test fun nonsenseIsSilent() = runTest {
        assertNull(checkerReturning("not json at all").check())
        assertNull(checkerReturning("""{"versionName":"9.9"}""").check())
    }
}
