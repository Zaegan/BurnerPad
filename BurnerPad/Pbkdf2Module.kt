package com.burnerpadapp

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.Promise
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec
import java.security.SecureRandom

/**
 * Pbkdf2Module
 *
 * Exposes PBKDF2WithHmacSHA256 to React Native JavaScript.
 *
 * Uses Android's built-in javax.crypto — no third-party dependencies.
 *
 * Parameters used by BurnerPad:
 *   iterations: 100,000
 *   keyLength:  256 bits
 *   salt:       16 bytes random, stored in EncryptedStorage
 */
class Pbkdf2Module(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "Pbkdf2Module"

    /**
     * Derive a key using PBKDF2WithHmacSHA256.
     *
     * @param password      User PIN/password as plain string
     * @param saltHex       Salt as hex string
     * @param iterations    Number of iterations
     * @param keyLengthBits Output key length in bits
     * @param promise       Resolves with hex-encoded derived key
     */
    @ReactMethod
    fun deriveKey(
        password: String,
        saltHex: String,
        iterations: Int,
        keyLengthBits: Int,
        promise: Promise
    ) {
        try {
            val salt = hexToBytes(saltHex)
            val spec = PBEKeySpec(
                password.toCharArray(),
                salt,
                iterations,
                keyLengthBits
            )
            val factory = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
            val key = factory.generateSecret(spec).encoded
            spec.clearPassword()
            promise.resolve(bytesToHex(key))
        } catch (e: Exception) {
            promise.reject("PBKDF2_ERROR", e.message ?: "Key derivation failed", e)
        }
    }

    /**
     * Generate cryptographically secure random bytes.
     *
     * @param byteCount  Number of bytes to generate
     * @param promise    Resolves with hex-encoded random bytes
     */
    @ReactMethod
    fun randomHex(byteCount: Int, promise: Promise) {
        try {
            val bytes = ByteArray(byteCount)
            SecureRandom().nextBytes(bytes)
            promise.resolve(bytesToHex(bytes))
        } catch (e: Exception) {
            promise.reject("RANDOM_ERROR", e.message ?: "Random generation failed", e)
        }
    }

    private fun hexToBytes(hex: String): ByteArray {
        val len = hex.length
        val data = ByteArray(len / 2)
        var i = 0
        while (i < len) {
            data[i / 2] = ((Character.digit(hex[i], 16) shl 4) +
                    Character.digit(hex[i + 1], 16)).toByte()
            i += 2
        }
        return data
    }

    private fun bytesToHex(bytes: ByteArray): String {
        val sb = StringBuilder()
        for (b in bytes) {
            sb.append(String.format("%02x", b))
        }
        return sb.toString()
    }
}
