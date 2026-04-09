package com.github.zaegan.burnerpad

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.Promise
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.IvParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec
import android.util.Base64

/**
 * CryptoModule
 *
 * Full crypto stack for BurnerPad using Android's javax.crypto exclusively.
 * No third-party crypto libraries. No SpongyCastle. No BouncyCastle.
 *
 * Exposed to React Native JavaScript as NativeModules.CryptoModule:
 *
 *   deriveKey(password, saltHex, iterations, keyLengthBits) → hexKey
 *   randomHex(byteCount) → hexString
 *   encrypt(plaintext, keyHex, ivHex) → base64Ciphertext
 *   decrypt(base64Ciphertext, keyHex, ivHex) → plaintext
 *   hmac256(base64Data, keyHex) → hexHmac
 *   randomIv() → hexIv (16 bytes)
 *
 * Key format: hex string (64 chars for 256-bit key)
 * IV format:  hex string (32 chars for 128-bit IV)
 * Ciphertext: base64 encoded
 */
class CryptoModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "CryptoModule"

    // ── Key derivation ────────────────────────────────────────────────────────

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
            val spec = PBEKeySpec(password.toCharArray(), salt, iterations, keyLengthBits)
            val factory = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
            val key = factory.generateSecret(spec).encoded
            spec.clearPassword()
            promise.resolve(bytesToHex(key))
        } catch (e: Exception) {
            promise.reject("DERIVE_KEY_ERROR", e.message ?: "Key derivation failed", e)
        }
    }

    // ── Random bytes ──────────────────────────────────────────────────────────

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

    @ReactMethod
    fun randomIv(promise: Promise) {
        try {
            val bytes = ByteArray(16)
            SecureRandom().nextBytes(bytes)
            promise.resolve(bytesToHex(bytes))
        } catch (e: Exception) {
            promise.reject("RANDOM_ERROR", e.message ?: "IV generation failed", e)
        }
    }

    // ── AES-256-CBC encryption ────────────────────────────────────────────────

    /**
     * Encrypt plaintext with AES-256-CBC/PKCS5Padding.
     *
     * @param plaintext  UTF-8 plaintext string
     * @param keyHex     256-bit key as hex string (64 chars)
     * @param ivHex      128-bit IV as hex string (32 chars)
     * @param promise    Resolves with base64-encoded ciphertext
     */
    @ReactMethod
    fun encrypt(plaintext: String, keyHex: String, ivHex: String, promise: Promise) {
        try {
            val keyBytes = hexToBytes(keyHex)
            val ivBytes  = hexToBytes(ivHex)
            val cipher   = Cipher.getInstance("AES/CBC/PKCS5Padding")
            cipher.init(
                Cipher.ENCRYPT_MODE,
                SecretKeySpec(keyBytes, "AES"),
                IvParameterSpec(ivBytes)
            )
            val encrypted = cipher.doFinal(plaintext.toByteArray(Charsets.UTF_8))
            promise.resolve(Base64.encodeToString(encrypted, Base64.NO_WRAP))
        } catch (e: Exception) {
            promise.reject("ENCRYPT_ERROR", e.message ?: "Encryption failed", e)
        }
    }

    /**
     * Decrypt AES-256-CBC/PKCS5Padding ciphertext.
     *
     * @param base64Ciphertext  Base64-encoded ciphertext
     * @param keyHex            256-bit key as hex string (64 chars)
     * @param ivHex             128-bit IV as hex string (32 chars)
     * @param promise           Resolves with UTF-8 plaintext string
     */
    @ReactMethod
    fun decrypt(base64Ciphertext: String, keyHex: String, ivHex: String, promise: Promise) {
        try {
            val keyBytes   = hexToBytes(keyHex)
            val ivBytes    = hexToBytes(ivHex)
            val ciphertext = Base64.decode(base64Ciphertext, Base64.NO_WRAP)
            val cipher     = Cipher.getInstance("AES/CBC/PKCS5Padding")
            cipher.init(
                Cipher.DECRYPT_MODE,
                SecretKeySpec(keyBytes, "AES"),
                IvParameterSpec(ivBytes)
            )
            val decrypted = cipher.doFinal(ciphertext)
            promise.resolve(String(decrypted, Charsets.UTF_8))
        } catch (e: Exception) {
            promise.reject("DECRYPT_ERROR", e.message ?: "Decryption failed", e)
        }
    }

    // ── HMAC-SHA256 ───────────────────────────────────────────────────────────

    /**
     * Compute HMAC-SHA256 of base64-encoded data.
     *
     * @param base64Data  Base64-encoded data to authenticate
     * @param keyHex      Key as hex string
     * @param promise     Resolves with hex-encoded HMAC
     */
    @ReactMethod
    fun hmac256(base64Data: String, keyHex: String, promise: Promise) {
        try {
            val keyBytes = hexToBytes(keyHex)
            val data     = Base64.decode(base64Data, Base64.NO_WRAP)
            val mac      = Mac.getInstance("HmacSHA256")
            mac.init(SecretKeySpec(keyBytes, "HmacSHA256"))
            promise.resolve(bytesToHex(mac.doFinal(data)))
        } catch (e: Exception) {
            promise.reject("HMAC_ERROR", e.message ?: "HMAC failed", e)
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private fun hexToBytes(hex: String): ByteArray {
        val len  = hex.length
        val data = ByteArray(len / 2)
        var i    = 0
        while (i < len) {
            data[i / 2] = ((Character.digit(hex[i], 16) shl 4) +
                    Character.digit(hex[i + 1], 16)).toByte()
            i += 2
        }
        return data
    }

    private fun bytesToHex(bytes: ByteArray): String {
        val sb = StringBuilder()
        for (b in bytes) sb.append(String.format("%02x", b))
        return sb.toString()
    }
}
