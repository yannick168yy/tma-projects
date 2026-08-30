package games.betogo.app;

import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

@CapacitorPlugin(name = "SessionVault")
public class SessionVaultPlugin extends Plugin {
    private static final String ALIAS = "betogo_session_vault";
    private static final String PREFS = "session_vault";
    private static final String TOKEN = "token";

    @PluginMethod
    public void getToken(PluginCall call) {
        JSObject result = new JSObject();
        try {
            String encrypted = preferences().getString(TOKEN, "");
            result.put("token", encrypted.isEmpty() ? "" : decrypt(encrypted));
        } catch (Exception ignored) {
            preferences().edit().remove(TOKEN).apply();
            result.put("token", "");
        }
        call.resolve(result);
    }

    @PluginMethod
    public void setToken(PluginCall call) {
        String token = call.getString("token", "");
        try {
            if (token.isEmpty()) preferences().edit().remove(TOKEN).apply();
            else preferences().edit().putString(TOKEN, encrypt(token)).apply();
            call.resolve();
        } catch (Exception error) {
            call.reject("无法保存会话", error);
        }
    }

    @PluginMethod
    public void clearToken(PluginCall call) {
        preferences().edit().remove(TOKEN).apply();
        call.resolve();
    }

    private SharedPreferences preferences() {
        return getContext().getSharedPreferences(PREFS, android.content.Context.MODE_PRIVATE);
    }

    private SecretKey secretKey() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (store.containsAlias(ALIAS)) return ((KeyStore.SecretKeyEntry) store.getEntry(ALIAS, null)).getSecretKey();
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(ALIAS,
            KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .build());
        return generator.generateKey();
    }

    private String encrypt(String value) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, secretKey());
        byte[] encrypted = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
        byte[] iv = cipher.getIV();
        ByteBuffer packed = ByteBuffer.allocate(4 + iv.length + encrypted.length);
        packed.putInt(iv.length).put(iv).put(encrypted);
        return Base64.encodeToString(packed.array(), Base64.NO_WRAP);
    }

    private String decrypt(String value) throws Exception {
        ByteBuffer packed = ByteBuffer.wrap(Base64.decode(value, Base64.NO_WRAP));
        int ivLength = packed.getInt();
        if (ivLength < 12 || ivLength > 16) throw new IllegalArgumentException("invalid iv");
        byte[] iv = new byte[ivLength];
        packed.get(iv);
        byte[] encrypted = new byte[packed.remaining()];
        packed.get(encrypted);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, secretKey(), new GCMParameterSpec(128, iv));
        return new String(cipher.doFinal(encrypted), StandardCharsets.UTF_8);
    }
}
