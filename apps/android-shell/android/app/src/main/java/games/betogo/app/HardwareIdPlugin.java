package games.betogo.app;

import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 给 App 里的 WebView 提供一个「重装不变」的硬件标识（ANDROID_ID）。
 *
 * 背景：前端 FingerprintJS 在 Capacitor WebView 里出不了值，导致 App 用户 fp_visitor=NULL，
 * 出金审核的 same_device_fp 规则对 App 全盲（薅羊毛团伙只要转 App 就绕过设备关联识别）。
 * ANDROID_ID 与 App 签名密钥绑定、卸载重装不变（仅恢复出厂/换签名会变），足够作为设备关联键。
 * 注意：root/模拟器可伪造——那是二期 Play Integrity 的事，这里只补上「普通用户重装不变」这一层。
 */
@CapacitorPlugin(name = "HardwareId")
public class HardwareIdPlugin extends Plugin {

    @PluginMethod
    public void getId(PluginCall call) {
        String id = "";
        try {
            id = Settings.Secure.getString(getContext().getContentResolver(), Settings.Secure.ANDROID_ID);
        } catch (Exception ignored) {
            // 取不到就返回空串，前端回落 FingerprintJS，不影响登录
        }
        JSObject ret = new JSObject();
        ret.put("id", id == null ? "" : id);
        call.resolve(ret);
    }
}
